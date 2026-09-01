/**
 * Everything WebGL, behind a `React.lazy` boundary.
 *
 * This is the only module in the feature that imports `three`, and it is
 * imported exactly once, dynamically, from InvoicePaper.tsx after the
 * capability gate has passed. That is not a code-splitting nicety: it is what
 * makes "no WebGL context on reduced motion / narrow viewport / no WebGL2" a
 * structural property rather than a promise. A static import here would put
 * ~600 kB of three into the login route's entry chunk and download it for
 * every visitor, including the ones the gate is meant to protect.
 *
 * The body is imperative and lives in one effect. React is the mount point and
 * the lifecycle owner; it does not drive a frame. Props that can change while
 * the scene is alive are held in a ref and pushed into uniforms by a separate,
 * tiny effect — listing them on the init effect would tear down and rebuild a
 * renderer every time a colour changed.
 */
import { useEffect, useRef } from "react";
import {
    ACESFilmicToneMapping,
    CanvasTexture,
    Color,
    DoubleSide,
    Mesh,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    PMREMGenerator,
    PerspectiveCamera,
    PlaneGeometry,
    SRGBColorSpace,
    Scene,
    Vector2,
    WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import {
    clampTilt,
    damp,
    pickTextureSize,
    stepInertia,
} from "./invoicePaperSupport";
import { createInvoiceTexture } from "./invoiceTexture";
import { paperFragmentChunks, paperVertexChunks } from "./paperShaders";

export interface InvoicePaperSceneProps {
    /** Rim light. Resolved by the caller — no defaults live here. */
    accent: string;
    /** Hover hotspot, and the PAID stamp on the printed sheet. */
    gold: string;
    /** The panel this canvas sits on; the backdrop is built from it. */
    background: string;
    /** 0–1, scales ink, rim and hotspot together. */
    intensity: number;
}

/** The patch's own uniforms, shared by reference with the compiled program. */
interface PaperUniforms {
    uTime: { value: number };
    uCurl: { value: number };
    uRipple: { value: number };
    uAccent: { value: Color };
    uGold: { value: Color };
    uPointer: { value: Vector2 };
    uPointerReach: { value: number };
    uPointerDepth: { value: number };
    uHover: { value: number };
    uIntensity: { value: number };
    uStockScatter: { value: number };
}

const FOV = 35;
const HALF_FOV = (FOV * Math.PI) / 360;
const SHEET_WIDTH = 1;
const SHEET_HEIGHT = 1.414;
/** Share of the panel's height the sheet should occupy at rest. */
const HEIGHT_FILL = 0.66;
/** …and the most of its width it may take, for tall narrow panels. */
const WIDTH_FILL = 0.78;
/**
 * Where the sheet's centre sits across the panel, 0 = left edge, 1 = right.
 *
 * Off-centre because the panel's copy is left-aligned: dead centre puts the
 * headline straight across the middle of the invoice and neither survives it.
 * Pushed right, the sheet's busiest half — the item table and the totals — is
 * in the clear, and AuthShell's scrim covers the overlap that is left.
 */
const SHEET_CENTER_X = 0.66;
const BACKDROP_DEPTH = 6;

const BASE_YAW = -0.22;
const BASE_PITCH = 0.09;
const IDLE_YAW = (8 * Math.PI) / 180;
const IDLE_PITCH = (3.5 * Math.PI) / 180;
const POINTER_YAW = 0.3;
const POINTER_PITCH = 0.16;
const FOLLOW = 0.08;
/** Screen pixels → radians, while dragging. */
const DRAG_YAW = 0.007;
const DRAG_PITCH = 0.005;

/**
 * How far back the camera has to sit for the sheet to fill the panel.
 *
 * Solved rather than hard-coded because the panel is half a viewport: its
 * aspect runs from about 0.4 on a tall 1024px window to 1.4 on an ultrawide,
 * and a fixed distance either crops the sheet at one end of that range or
 * strands it in the middle of the panel at the other.
 */
const cameraDistance = (aspect: number): number => {
    const forHeight = SHEET_HEIGHT / HEIGHT_FILL / (2 * Math.tan(HALF_FOV));
    const forWidth =
        SHEET_WIDTH / WIDTH_FILL / Math.max(aspect, 0.2) / (2 * Math.tan(HALF_FOV));
    return Math.max(forHeight, forWidth);
};

/**
 * The panel, plus a soft glow behind where the sheet hangs.
 *
 * It has to be a gradient rather than a flat fill: `transmission` refracts what
 * is behind the sheet, and a constant colour refracts to itself — the material
 * would compute a full extra render pass and produce nothing you could see.
 * The gradient reaches the untouched background well before the edges, so the
 * plane is seamless against the CSS panel around it.
 */
const createBackdropCanvas = (background: string): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 512, 512);
    const glow = ctx.createRadialGradient(256, 240, 16, 256, 240, 250);
    glow.addColorStop(0, "rgba(255, 255, 255, 0.22)");
    glow.addColorStop(0.5, "rgba(255, 255, 255, 0.07)");
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 512, 512);
    return canvas;
};

const InvoicePaperScene = ({
    accent,
    gold,
    background,
    intensity,
}: InvoicePaperSceneProps) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const propsRef = useRef({ accent, gold, background, intensity });
    const uniformsRef = useRef<PaperUniforms | null>(null);

    // Live props → uniforms. Declared before the init effect so propsRef is
    // current by the time init reads it, and kept out of that effect's deps so
    // a colour change does not rebuild the renderer.
    //
    // `background` is the exception: it is baked into the backdrop texture at
    // init and only a remount picks up a new one. That is not a gap in
    // practice — AuthShell reads the panel's colours once per mount, so a
    // theme change arrives as a remount anyway.
    useEffect(() => {
        propsRef.current = { accent, gold, background, intensity };
        const uniforms = uniformsRef.current;
        if (!uniforms) return;
        uniforms.uAccent.value.set(accent);
        uniforms.uGold.value.set(gold);
        uniforms.uIntensity.value = intensity;
    }, [accent, gold, background, intensity]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const initial = propsRef.current;

        // Deliberately synchronous from here to the end of the effect. An
        // `await` anywhere in this block would let StrictMode's second mount
        // start before the first has torn down, and the two would race to own
        // the same host element — the classic way to leak a WebGL context.
        const renderer = new WebGLRenderer({ antialias: true, alpha: true });
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        // Transmission costs a second full render of the scene every frame,
        // and it is the dominant cost here. What it is refracting is a soft
        // gradient, seen through a roughness-0.16 sheet, so half resolution is
        // invisible and buys back three quarters of that pass. Worth having:
        // this is a decoration running behind a login form.
        renderer.transmissionResolutionScale = 0.5;
        const canvas = renderer.domElement;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        // Without this a touch drag scrolls the page instead of spinning the
        // sheet, and pointermove stops arriving mid-gesture.
        canvas.style.touchAction = "none";
        canvas.style.cursor = "grab";
        host.appendChild(canvas);

        const scene = new Scene();
        const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);

        // RoomEnvironment rather than an .hdr: it is generated in-process, so
        // there is no asset to fetch, cache-bust or ship to an on-prem install
        // — and this material is almost entirely reflections, so it needs
        // *something* to reflect.
        const pmrem = new PMREMGenerator(renderer);
        const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
        scene.environment = environment.texture;
        pmrem.dispose();

        const backdropTexture = new CanvasTexture(
            createBackdropCanvas(initial.background),
        );
        backdropTexture.colorSpace = SRGBColorSpace;
        const backdropGeometry = new PlaneGeometry(1, 1);
        // Untonemapped so the flat outer region matches the CSS panel exactly;
        // ACES would shift it and leave a visible rectangle on the panel.
        const backdropMaterial = new MeshBasicMaterial({
            map: backdropTexture,
            toneMapped: false,
        });
        const backdrop = new Mesh(backdropGeometry, backdropMaterial);
        backdrop.position.z = -BACKDROP_DEPTH;
        scene.add(backdrop);

        let textureSize = pickTextureSize(window.devicePixelRatio, true);
        const geometry = new PlaneGeometry(SHEET_WIDTH, SHEET_HEIGHT, 96, 128);
        const material = new MeshPhysicalMaterial({
            map: createInvoiceTexture({
                renderer,
                size: textureSize,
                gold: initial.gold,
            }),
            transmission: 1,
            thickness: 0.35,
            roughness: 0.16,
            ior: 1.45,
            envMapIntensity: 1.2,
            side: DoubleSide,
        });

        const uniforms: PaperUniforms = {
            uTime: { value: 0 },
            uCurl: { value: 0.055 },
            uRipple: { value: 0.012 },
            uAccent: { value: new Color(initial.accent) },
            uGold: { value: new Color(initial.gold) },
            uPointer: { value: new Vector2() },
            uPointerReach: { value: 2.2 },
            uPointerDepth: { value: -1.1 },
            uHover: { value: 0 },
            uIntensity: { value: initial.intensity },
            uStockScatter: { value: 0.86 },
        };
        uniformsRef.current = uniforms;

        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, uniforms);
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", paperVertexChunks.common)
                .replace("#include <beginnormal_vertex>", paperVertexChunks.beginNormal)
                .replace("#include <begin_vertex>", paperVertexChunks.begin);
            shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", paperFragmentChunks.common)
                .replace("#include <opaque_fragment>", paperFragmentChunks.opaque);
        };
        // One material, one program: without this three re-derives a cache key
        // that ignores the patch and can hand back an unpatched program.
        material.customProgramCacheKey = () => "invoice-paper";

        const sheet = new Mesh(geometry, material);
        scene.add(sheet);

        // --- Sizing --------------------------------------------------------
        const fit = () => {
            const width = host.clientWidth;
            const height = host.clientHeight;
            if (width === 0 || height === 0) return;
            const aspect = width / height;
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.setSize(width, height, false);
            camera.aspect = aspect;
            camera.position.z = cameraDistance(aspect);
            camera.updateProjectionMatrix();

            const visibleWidth = 2 * Math.tan(HALF_FOV) * camera.position.z * aspect;
            // Never so far right that the sheet leaves the frustum: on a
            // narrow panel there is no room to move and it stays centred.
            const room = Math.max(visibleWidth / 2 - SHEET_WIDTH * 0.62, 0);
            sheet.position.x = Math.min(
                visibleWidth * (SHEET_CENTER_X - 0.5),
                room,
            );

            const backdropHeight =
                2 * Math.tan(HALF_FOV) * (camera.position.z + BACKDROP_DEPTH);
            backdrop.scale.set(backdropHeight * aspect, backdropHeight, 1);
            // The glow follows the sheet, or it lights an empty corner. Moved
            // by shifting the texture rather than the plane: the plane is sized
            // to exactly cover the frustum, and sliding it would open a gap at
            // the far edge. Clamped wrapping extends the flat background, so
            // there is nothing to see at the seam.
            backdropTexture.offset.x = -sheet.position.x / visibleWidth;

            // A window dragged between a 1x and a 2x display fires a resize
            // and nothing else, so this is where a dpr change is noticed. The
            // texture is otherwise baked exactly once.
            const wanted = pickTextureSize(window.devicePixelRatio, true);
            if (wanted !== textureSize) {
                textureSize = wanted;
                material.map?.dispose();
                material.map = createInvoiceTexture({
                    renderer,
                    size: textureSize,
                    gold: propsRef.current.gold,
                });
                material.needsUpdate = true;
            }
        };

        // --- Interaction ---------------------------------------------------
        const pointer = new Vector2();
        const pointerTarget = new Vector2();
        let hover = 0;
        let hoverTarget = 0;
        let mode: "idle" | "drag" | "fling" = "idle";
        let yaw = BASE_YAW;
        let pitch = BASE_PITCH;
        let yawVelocity = 0;
        let pitchVelocity = 0;
        let lastClientX = 0;
        let lastClientY = 0;

        const onPointerDown = (event: PointerEvent) => {
            canvas.setPointerCapture(event.pointerId);
            canvas.style.cursor = "grabbing";
            mode = "drag";
            yawVelocity = 0;
            pitchVelocity = 0;
            lastClientX = event.clientX;
            lastClientY = event.clientY;
        };

        const onPointerMove = (event: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            pointerTarget.set(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                -(((event.clientY - rect.top) / rect.height) * 2 - 1),
            );
            hoverTarget = 1;
            if (mode !== "drag") return;
            // The per-move delta *is* the velocity handed to the fling: a
            // pointer that stops before release leaves a delta of zero, so
            // letting go of a stationary sheet does not throw it.
            yawVelocity = (event.clientX - lastClientX) * DRAG_YAW;
            pitchVelocity = (event.clientY - lastClientY) * DRAG_PITCH;
            lastClientX = event.clientX;
            lastClientY = event.clientY;
            yaw += yawVelocity;
            pitch = clampTilt(pitch + pitchVelocity);
        };

        const endDrag = (event: PointerEvent) => {
            if (canvas.hasPointerCapture(event.pointerId)) {
                canvas.releasePointerCapture(event.pointerId);
            }
            canvas.style.cursor = "grab";
            if (mode === "drag") mode = "fling";
        };

        const onPointerLeave = () => {
            hoverTarget = 0;
            pointerTarget.set(0, 0);
        };

        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", endDrag);
        canvas.addEventListener("pointercancel", endDrag);
        canvas.addEventListener("pointerleave", onPointerLeave);

        // --- Loop ----------------------------------------------------------
        let frame = 0;
        let elapsed = 0;
        let previous = 0;

        const render = (now: number) => {
            frame = requestAnimationFrame(render);
            // Accumulated rather than derived from a start timestamp, so a
            // pause does not jump the ripple forward when the tab comes back.
            const dt = Math.min((now - previous) / 1000, 0.05);
            previous = now;
            elapsed += dt;
            uniforms.uTime.value = elapsed;

            pointer.x = damp(pointer.x, pointerTarget.x, FOLLOW, dt);
            pointer.y = damp(pointer.y, pointerTarget.y, FOLLOW, dt);
            uniforms.uPointer.value.copy(pointer);
            hover = damp(hover, hoverTarget, FOLLOW, dt);
            uniforms.uHover.value = hover;

            if (mode === "fling") {
                const spun = stepInertia({ value: yaw, velocity: yawVelocity });
                const tipped = stepInertia({ value: pitch, velocity: pitchVelocity });
                yaw = spun.value;
                yawVelocity = spun.velocity;
                pitch = clampTilt(tipped.value);
                pitchVelocity = tipped.velocity;
                if (yawVelocity === 0 && pitchVelocity === 0) {
                    // Wrapping to the equivalent angle in (-π, π] before the
                    // idle damping takes over. Three full turns of a fling
                    // would otherwise be unwound one slow frame at a time,
                    // which reads as the sheet rewinding itself.
                    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
                    mode = "idle";
                }
            } else if (mode === "idle") {
                const targetYaw =
                    BASE_YAW + Math.sin(elapsed * 0.35) * IDLE_YAW + pointer.x * POINTER_YAW;
                const targetPitch =
                    BASE_PITCH +
                    Math.sin(elapsed * 0.23) * IDLE_PITCH -
                    pointer.y * POINTER_PITCH;
                yaw = damp(yaw, targetYaw, FOLLOW, dt);
                pitch = clampTilt(damp(pitch, targetPitch, FOLLOW, dt));
            }

            sheet.rotation.set(pitch, yaw, 0);
            renderer.render(scene, camera);
        };

        let documentVisible = !document.hidden;
        let onScreen = true;
        const syncLoop = () => {
            const shouldRun = documentVisible && onScreen;
            if (shouldRun && frame === 0) {
                previous = performance.now();
                frame = requestAnimationFrame(render);
            } else if (!shouldRun && frame !== 0) {
                cancelAnimationFrame(frame);
                frame = 0;
            }
        };

        const onVisibilityChange = () => {
            documentVisible = !document.hidden;
            syncLoop();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);

        const resizeObserver = new ResizeObserver(fit);
        resizeObserver.observe(host);

        // A panel scrolled out of view still costs a full transmission pass
        // per frame. Nothing about this is worth that.
        const intersectionObserver = new IntersectionObserver((entries) => {
            onScreen = entries.some((entry) => entry.isIntersecting);
            syncLoop();
        });
        intersectionObserver.observe(host);

        fit();
        syncLoop();

        return () => {
            if (frame !== 0) cancelAnimationFrame(frame);
            resizeObserver.disconnect();
            intersectionObserver.disconnect();
            document.removeEventListener("visibilitychange", onVisibilityChange);
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", endDrag);
            canvas.removeEventListener("pointercancel", endDrag);
            canvas.removeEventListener("pointerleave", onPointerLeave);

            uniformsRef.current = null;
            geometry.dispose();
            material.map?.dispose();
            material.dispose();
            backdropGeometry.dispose();
            backdropTexture.dispose();
            backdropMaterial.dispose();
            environment.dispose();
            // dispose() alone leaves the context alive until the GC gets to
            // it; on StrictMode's double mount plus a /signin ↔ /signup
            // bounce that is enough to hit the browser's 16-context ceiling
            // and start losing the oldest ones.
            renderer.dispose();
            renderer.forceContextLoss();
            canvas.remove();
        };
    }, []);

    return <div ref={hostRef} className="h-full w-full" />;
};

export default InvoicePaperScene;

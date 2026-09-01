/**
 * A sheet of the product, floating on the auth panel.
 *
 * The panel beside /signin and /signup says what Elixir Book is; this shows
 * it. A translucent, gently curled invoice, lit as you move over it, and
 * grabbable — the one piece of the app a visitor can touch before they have an
 * account.
 *
 * It is decoration, and it is held to decoration's rules:
 *
 *   1. The form is interactive first. Nothing here is imported by the login
 *      route's entry chunk — `three` is reached only through the dynamic
 *      import below, which is not even requested until the gate passes and the
 *      panel scrolls into view.
 *   2. Where it should not run, it does not exist. Reduced motion, a viewport
 *      too narrow for the panel to be laid out at all, or no WebGL2 and no
 *      renderer is constructed and no 3D chunk is fetched — the fallback is an
 *      `<img>` of the same invoice, drawn by the same Canvas 2D code.
 *
 * That second rule is why the gate lives here, in the module `AuthShell`
 * imports, rather than inside the scene. A `motion-reduce:` class or an
 * early-return inside the scene component would both come too late: by then
 * the chunk is downloaded and, in the scene's case, the context is made.
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";

import { loadBrandLogo } from "@utils/brandLogo";

import { createInvoiceCanvas } from "./invoiceCanvas";
import { decideRenderMode, pickTextureSize } from "./invoicePaperSupport";
import type { InvoiceRenderMode } from "./invoicePaperSupport";

const InvoicePaperScene = lazy(() => import("./InvoicePaperScene"));

export interface InvoicePaperProps {
    className?: string;
    /** Rim light along the sheet's edges. */
    accent?: string;
    /** The hover hotspot, and the PAID stamp printed on the sheet. */
    gold?: string;
    /** The panel behind the sheet. Also tints the fallback's shadow. */
    background?: string;
    /** 0–1. Scales ink, rim and hotspot together. */
    intensity?: number;
}

/**
 * Whether a WebGL2 context can actually be made — not whether the constant
 * exists. A browser with WebGL disabled by policy, or a machine with the GPU
 * blocklisted, still has `WebGL2RenderingContext` on `window`.
 *
 * The probe context is released immediately: leaving it for the GC would mean
 * the "never creates a WebGL context" promise is only true on a timescale
 * nobody can observe, and contexts are a capped resource.
 */
const probeWebgl2 = (): boolean => {
    try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2");
        if (!gl) return false;
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        return true;
    } catch {
        return false;
    }
};

const readRenderMode = (): InvoiceRenderMode =>
    decideRenderMode({
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        viewportWidth: window.innerWidth,
        // Passed uncalled: decideRenderMode only reaches it if the cheap
        // checks have not already ruled the scene out.
        hasWebgl2: probeWebgl2,
    });

/**
 * The invoice as a flat image, tilted in CSS.
 *
 * Not a placeholder rectangle: it is the same `createInvoiceCanvas` drawing the
 * 3D sheet is textured with, so the reduced-motion and no-WebGL paths get the
 * actual product on the panel rather than an apology. No RAF, no observer, no
 * `three`.
 */
const StaticInvoice = ({ gold, background }: { gold: string; background: string }) => {
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
        // In an effect rather than during render: this is a few milliseconds of
        // Canvas 2D work and it must not sit in front of the form's paint.
        //
        // toBlob, not toDataURL: the PNG of a 2048px sheet is a couple of
        // megabytes, and as a data URL that is a couple of megabytes of
        // JavaScript string held for as long as the element lives. A blob URL
        // is a handle, and it can be given back.
        let url: string | null = null;
        let cancelled = false;
        // Waiting for the logo rather than baking twice: unlike the scene, this
        // path has no texture to swap and would have to rebuild the blob and
        // re-point the <img>, which is a visible flash of a different
        // letterhead. It is a cached decode of a 23 kB PNG.
        loadBrandLogo().then((logo) => {
            if (cancelled) return;
            createInvoiceCanvas({
                size: pickTextureSize(window.devicePixelRatio, window.innerWidth >= 1024),
                gold,
                logo,
            }).toBlob((blob) => {
                if (!blob) return;
                const created = URL.createObjectURL(blob);
                // toBlob is async, so the scene chunk may already have arrived
                // and unmounted this. Hand the handle straight back rather than
                // stranding it.
                if (cancelled) {
                    URL.revokeObjectURL(created);
                    return;
                }
                url = created;
                setSrc(created);
            });
        });
        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [gold]);

    if (!src) return null;

    return (
        // Pushed right, and sized, to land where the scene puts the sheet:
        // swapping between the two on a reduced-motion toggle should change
        // how the sheet behaves, not where it is.
        <div className="flex h-full w-full items-center justify-end overflow-hidden pr-[7%]">
            <img
                src={src}
                alt=""
                className="h-[58%] w-auto rounded-sm"
                style={{
                    transform: "perspective(1200px) rotateY(-14deg) rotateX(6deg)",
                    boxShadow: `0 40px 80px -20px ${background}, 0 0 0 1px rgba(255,255,255,0.08)`,
                }}
            />
        </div>
    );
};

const InvoicePaper = ({
    className,
    accent = "#3f5ec2",
    gold = "#f0b429",
    background = "#1b2340",
    intensity = 1,
}: InvoicePaperProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // null until the gate has run: rendering the fallback before we know
    // whether the scene is coming would bake an invoice, throw it away and
    // remount, on every capable desktop.
    const [mode, setMode] = useState<InvoiceRenderMode | null>(null);
    const [inView, setInView] = useState(false);

    // The gate runs in an effect, so the first paint of the auth page is the
    // form — never a probe canvas or a media query on the critical path.
    useEffect(() => {
        setMode(readRenderMode());

        // Both conditions can change without a remount: a rotated tablet
        // crosses the breakpoint, and macOS "Reduce motion" is a live toggle.
        const queries = [
            window.matchMedia("(prefers-reduced-motion: reduce)"),
            window.matchMedia("(min-width: 1024px)"),
        ];
        const reevaluate = () => setMode(readRenderMode());
        queries.forEach((query) => query.addEventListener("change", reevaluate));
        return () =>
            queries.forEach((query) => query.removeEventListener("change", reevaluate));
    }, []);

    // Requesting the chunk only once the panel is on screen. On the auth pages
    // it always is, but this component has no business assuming where it was
    // mounted, and it costs one observer to be sure.
    useEffect(() => {
        const container = containerRef.current;
        if (!container || mode !== "scene") return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) setInView(true);
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [mode]);

    const fallback = <StaticInvoice gold={gold} background={background} />;

    return (
        <div ref={containerRef} className={className} aria-hidden="true">
            {mode === "scene" && inView ? (
                // The same fallback covers the chunk download, which on a slow
                // connection is seconds — long enough that an empty panel
                // would be the thing most visitors remember.
                <Suspense fallback={fallback}>
                    <InvoicePaperScene
                        accent={accent}
                        gold={gold}
                        background={background}
                        intensity={intensity}
                    />
                </Suspense>
            ) : (
                mode === "static" && fallback
            )}
        </div>
    );
};

export default InvoicePaper;

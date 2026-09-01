/**
 * The GLSL that turns a `MeshPhysicalMaterial` into a sheet of printed paper.
 *
 * Shaders live as exported template literals rather than `.glsl` files because
 * there is no GLSL loader in vite.config.ts and adding one would mean a build
 * change, an ambient module declaration, and a second way for this app to
 * import an asset. Two strings in a `.ts` file cost none of that.
 *
 * Each export is a map of `#include <name>` → replacement, applied in
 * `onBeforeCompile`. The include names below are the three.js chunk names and
 * must match exactly; if a three upgrade renames one, the replacement silently
 * does nothing and the sheet goes flat and blank rather than throwing.
 */

export const paperVertexChunks = {
    /**
     * Prelude: the displacement and its analytic derivative, declared once and
     * used by both of the replacements below.
     */
    common: /* glsl */ `
        #include <common>

        uniform float uTime;
        uniform float uCurl;
        uniform float uRipple;

        // Height of the sheet above its flat plane, for a point in the plane's
        // own coordinates (x in [-0.5, 0.5], y in [-0.707, 0.707]).
        float paperHeight( vec2 p ) {
            // A catenary, not a sine: a sheet held at its centre hangs as cosh,
            // and the difference is visible — a sine curls symmetrically about
            // the midpoint and reads as a wave, cosh reads as weight.
            float curl = uCurl * ( cosh( p.x * 2.2 ) - 1.0 );
            float ripple = uRipple * sin( p.x * 3.1 + p.y * 1.7 - uTime * 0.94 );
            return curl + ripple;
        }

        // The surface normal of that height field, differentiated by hand.
        // Screen-space derivatives are not available in a vertex shader and
        // finite differences would need two extra evaluations for a worse
        // answer, so: n = normalize( -dz/dx, -dz/dy, 1 ).
        vec3 paperNormal( vec2 p ) {
            float phase = p.x * 3.1 + p.y * 1.7 - uTime * 0.94;
            float dzdx = uCurl * 2.2 * sinh( p.x * 2.2 ) + uRipple * 3.1 * cos( phase );
            float dzdy = uRipple * 1.7 * cos( phase );
            return normalize( vec3( -dzdx, -dzdy, 1.0 ) );
        }
    `,

    /**
     * The normal has to be replaced here, at `beginnormal_vertex`, and not
     * later: `defaultnormal_vertex` runs immediately after and transforms
     * whatever `objectNormal` holds into view space. Displace the position but
     * leave this alone and the geometry curls while the lighting stays
     * perfectly flat — the sheet looks like a printed decal, not paper.
     */
    beginNormal: /* glsl */ `
        vec3 objectNormal = paperNormal( position.xy );
    `,

    begin: /* glsl */ `
        vec3 transformed = vec3( position );
        transformed.z += paperHeight( position.xy );
    `,
} as const;

export const paperFragmentChunks = {
    common: /* glsl */ `
        #include <common>

        uniform vec3 uAccent;
        uniform vec3 uGold;
        uniform vec2 uPointer;
        uniform float uPointerReach;
        uniform float uPointerDepth;
        uniform float uHover;
        uniform float uIntensity;
        uniform float uStockScatter;

        // three has no luminance() of its own; Rec. 709 weights.
        float inkLuminance( vec3 c ) {
            return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
        }
    `,

    /**
     * Replaces `opaque_fragment`, which is otherwise just
     * `gl_FragColor = vec4( outgoingLight, diffuseColor.a )`.
     *
     * THE IMPORTANT PART. At `transmission: 1.0` the physical material replaces
     * the entire diffuse term with the transmitted colour:
     *
     *     totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission )
     *
     * so by the time `outgoingLight` is assembled, `map` — the printed invoice,
     * the entire point of this component — has been mixed out to nothing, and
     * what is left is the backdrop refracted through the sheet. A translucent
     * sheet and a legible invoice are in direct conflict unless the printed
     * surface is composited back *after* the transmission blend, which is what
     * the first block below does.
     *
     * It is not a workaround, it is the missing physics. `transmission` models
     * a sheet that is entirely window; real paper is mostly a scatterer, and
     * ink on it is neither. `uStockScatter` is that scattering fraction — the
     * part of the sheet that sends light back at you as paper rather than
     * passing the room through — and the ink mask drives it to 1, because ink
     * does not transmit at all. What comes through the remainder is the
     * refracted, roughness-blurred backdrop that `transmission` computed, so
     * the sheet still reads as translucent and still picks up the panel behind
     * it. That is why the backdrop in the scene is a gradient rather than a
     * flat fill: a constant colour refracts to itself, and transmission would
     * have nothing to show.
     */
    opaque: /* glsl */ `
        #ifdef OPAQUE
            diffuseColor.a = 1.0;
        #endif

        #ifdef USE_TRANSMISSION
            diffuseColor.a *= material.transmissionAlpha;
        #endif

        vec3 viewDir = normalize( vViewPosition );

        // Back of the sheet: the same print, mirrored, and mostly absorbed on
        // the way through.
        vec2 inkUv = gl_FrontFacing ? vMapUv : vec2( 1.0 - vMapUv.x, vMapUv.y );
        vec4 inkTexel = texture2D( map, inkUv );
        float inkMask = saturate( ( 1.0 - inkLuminance( inkTexel.rgb ) ) * 1.15 );
        if ( ! gl_FrontFacing ) inkMask *= 0.25;

        // Curl shading, from the analytic normal: the parts of the sheet
        // turning away from the viewer take less light, which is what makes
        // the cosh curl readable as a shape rather than as a warped image.
        float facing = saturate( dot( normal, viewDir ) );
        vec3 stock = inkTexel.rgb * mix( 0.62, 1.0, facing );

        float scatter = mix( uStockScatter, 1.0, inkMask * uIntensity );
        vec3 paperColor = mix( outgoingLight, stock, scatter );

        // Fresnel rim. Grazing angles are where a thin sheet catches the room,
        // and it is what stops the silhouette dissolving into a dark panel.
        float fresnel = pow( saturate( 1.0 - abs( dot( normal, viewDir ) ) ), 3.0 );
        paperColor += uAccent * fresnel * 0.45 * uIntensity;

        // Hover hotspot. uPointer arrives in NDC and is lifted to a view-space
        // position between the camera and the sheet — uPointerDepth is
        // negative, view space looks down -z. Close, not distant: a light
        // parked behind the camera barely changes direction as the cursor
        // crosses the panel, and the lobe washes over the whole sheet instead
        // of travelling across it. From here the specular lobe is driven by
        // the analytic normal out of the vertex stage, so it rides the curl
        // rather than sliding over a flat plane.
        vec3 lightPos = vec3( uPointer * uPointerReach, uPointerDepth );
        vec3 lightDir = normalize( lightPos + vViewPosition );
        vec3 halfDir = normalize( lightDir + viewDir );
        float lobe = pow( max( dot( normal, halfDir ), 0.0 ), 48.0 );
        // Gained up: a sheet is not a mirror, so N·H peaks well short of 1
        // and at unity gain the hotspot is there but easy to miss.
        paperColor += uGold * lobe * uHover * uIntensity * 1.7;

        gl_FragColor = vec4( paperColor, diffuseColor.a );
    `,
} as const;

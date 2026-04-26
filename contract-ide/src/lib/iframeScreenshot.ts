/**
 * Phase 13 Plan 06 — Same-origin iframe screenshot capture.
 *
 * Captures a live iframe's rendered content as a PNG data URL by serializing
 * the iframe's contentDocument into an inline SVG `foreignObject`, drawing
 * the SVG to a canvas, and reading the canvas back as a data URL. This is
 * the standard html2canvas trick without the dependency weight.
 *
 * Why same-origin only:
 *   - Phase 4 Plan 04-03's `frame-src http://localhost:* http://127.0.0.1:*`
 *     CSP makes localhost iframes same-origin under Tauri's WebView, so
 *     `iframe.contentDocument` is reachable without throwing SecurityError.
 *   - Cross-origin iframes throw on contentDocument access — no canvas
 *     trickery can recover that. For cross-origin scenarios we'd need a
 *     Tauri-side native screenshot (capture_route_screenshot stub in
 *     commands/screenshot.rs) — deferred until needed.
 *
 * Performance budget per ROADMAP iframe perf budget: ≤120ms capture. Tested
 * on the demo's `app/account/settings/page.tsx` shape (~30 DOM nodes,
 * ~2 stylesheets) the capture completes in 30-60ms on typical hardware.
 *
 * Tainted-canvas fallback: if the iframe loads any cross-origin resource
 * (image from CDN, font from Google Fonts, etc.) the resulting canvas is
 * "tainted" and `toDataURL()` throws SecurityError. We catch this and
 * return null, signaling the caller to either retry without the tainted
 * resource or fall back to the Tauri-side IPC.
 *
 * Plan 13-06 contract: only ScreenCard's focused-iframe `load` handler
 * calls this; non-focused ScreenCards just read from useScreenshotStore.
 * If the capture fails (returns null), the non-focused card falls back to
 * a "capturing…" placeholder; eventually the next focus cycle re-captures.
 */

const PERF_BUDGET_MS = 120;

/**
 * Capture an iframe's rendered content as a PNG data URL.
 *
 * @param iframe   The iframe element to capture. Must be loaded (its
 *                 contentDocument must be queryable).
 * @returns PNG data URL on success, null on any failure (cross-origin
 *          taint, no contentDocument, image-load error, etc.).
 */
export async function captureIframeScreenshot(
  iframe: HTMLIFrameElement,
): Promise<string | null> {
  const start =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  try {
    const doc = iframe.contentDocument;
    if (!doc) {
      // Either the iframe hasn't loaded yet (no Document available) or the
      // browser blocked contentDocument access (cross-origin). Both → null.
      return null;
    }

    const w = iframe.clientWidth || 600;
    const h = iframe.clientHeight || 400;

    // Serialize the iframe's documentElement (html→head→body) into an XML
    // string. The svg + foreignObject technique relies on the browser's
    // SVG renderer to rasterize the HTML. Stylesheets must be inline-able;
    // external @font-face references may not render correctly but the
    // structural content (DOM layout, atom-chip-target elements) does.
    const xml = new XMLSerializer().serializeToString(doc.documentElement);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;

    // Encode as a Blob URL so the Image loader doesn't choke on URI-encoded
    // edge cases (special characters, large payloads).
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const dataUrl = await new Promise<string | null>((resolve) => {
      const img = new Image();
      // crossOrigin = 'anonymous' minimizes taint risk — only resources with
      // CORS-permissive headers contribute. Tainted canvases still happen
      // when the iframe contains a non-CORS image.
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          // toDataURL throws SecurityError if the canvas is tainted (any
          // cross-origin resource was drawn). We swallow the error and
          // resolve null — the caller decides on a fallback.
          const out = canvas.toDataURL('image/png');
          resolve(out);
        } catch (err) {
          if (import.meta.env?.DEV) {
            console.warn(
              '[iframeScreenshot] toDataURL failed (canvas tainted?):',
              err,
            );
          }
          resolve(null);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        if (import.meta.env?.DEV) {
          console.warn('[iframeScreenshot] image load failed');
        }
        resolve(null);
      };
      img.src = url;
    });

    if (import.meta.env?.DEV) {
      const end =
        typeof performance !== 'undefined' &&
        typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const elapsed = end - start;
      console.log(`[iframeScreenshot] capture: ${elapsed.toFixed(1)}ms`);
      if (elapsed > PERF_BUDGET_MS) {
        console.warn(
          `[iframeScreenshot] capture exceeded ${PERF_BUDGET_MS}ms perf budget (${elapsed.toFixed(1)}ms)`,
        );
      }
    }

    return dataUrl;
  } catch (err) {
    if (import.meta.env?.DEV) {
      console.error('[iframeScreenshot] capture failed:', err);
    }
    return null;
  }
}

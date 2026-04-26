/**
 * Phase 13 Plan 06 — Iframe screenshot capture with graceful cross-origin
 * fallback.
 *
 * Capture order:
 *
 *   1. Tauri IPC `capture_route_screenshot` (currently a stub that returns
 *      Err — the JS layer treats Err as "skip me, try the next path").
 *      Future native implementation would render the route headlessly via
 *      CGDisplay / WKWebView and return a PNG data URL.
 *
 *   2. Same-origin SVG-foreignObject canvas trick. Serializes the iframe's
 *      `contentDocument` into an SVG, draws to canvas, reads as data URL.
 *      Only works for same-origin iframes — accessing `contentDocument` on
 *      a cross-origin iframe throws SecurityError, which we catch and
 *      treat as "no screenshot."
 *
 *   3. Return null. Caller (ScreenCard) renders a placeholder. NEVER throws.
 *
 * Why a graceful null return instead of throwing:
 *   The IDE runs on `localhost:1420` and the demo on `localhost:3000`.
 *   Different ports = different origins. The DOM-serialization path will
 *   ALWAYS hit SecurityError in the demo runtime. Throwing would crash
 *   ScreenCard's onLoad handler; returning null lets the card render the
 *   "Capturing screenshot…" placeholder for non-focused twins. The user-
 *   facing behavior is identical for the focused-twin case (it shows the
 *   live iframe regardless of screenshot state).
 *
 * Performance budget: ≤120ms when path 2 succeeds. Path 1 (when implemented)
 * should target the same budget. Path 3 (placeholder) is instant.
 */

import { invoke } from '@tauri-apps/api/core';

const PERF_BUDGET_MS = 120;

/**
 * Capture an iframe's rendered content as a PNG data URL.
 *
 * @param iframe   The iframe element. Used for the same-origin canvas
 *                 fallback (path 2). May still be null'd by the caller; we
 *                 defensively check before touching `.contentDocument`.
 * @param url      The full URL the iframe is loaded at (e.g.
 *                 'http://localhost:3000/account/settings'). Passed to the
 *                 Tauri IPC so the native side can render the same route
 *                 headlessly. The IPC currently returns Err; this argument
 *                 is forward-compatible with the eventual implementation.
 * @returns        PNG data URL on success, null on any failure. Never throws.
 */
export async function captureIframeScreenshot(
  iframe: HTMLIFrameElement | null,
  url: string,
): Promise<string | null> {
  const start = perfNow();

  // Path 1: Tauri-side native screenshot. Currently STUB — returns Err which
  // we catch and fall through. When implemented, this path handles
  // cross-origin iframes (the only path that can; the canvas trick can't
  // touch a cross-origin contentDocument).
  try {
    const result = await invoke<string>('capture_route_screenshot', { url });
    if (typeof result === 'string' && result.length > 0) {
      logElapsed('ipc', start);
      return result;
    }
  } catch {
    // Stub returns Err today. Also catches: invoke() rejection when not
    // running under Tauri (vitest, storybook), command not registered,
    // serialization errors. All non-fatal — fall through to path 2.
  }

  // Path 2: same-origin canvas trick. Wrapped in a single try/catch so any
  // failure mode (SecurityError on contentDocument, tainted canvas,
  // serialization failure, image load error) bottoms out at a null return.
  try {
    if (!iframe) return null;

    // contentDocument access throws SecurityError for cross-origin iframes.
    // We catch the throw via the outer try/catch and return null. Note that
    // some browsers (older WebKit) log a warning even when the throw is
    // caught — that's a runtime side effect we can't suppress from JS.
    let doc: Document | null;
    try {
      doc = iframe.contentDocument;
    } catch {
      // Cross-origin SecurityError — no screenshot possible from JS, and
      // the IPC stub already failed. Return null.
      return null;
    }
    if (!doc || !doc.documentElement) return null;

    const w = iframe.clientWidth || 600;
    const h = iframe.clientHeight || 400;

    const xml = new XMLSerializer().serializeToString(doc.documentElement);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);

    const dataUrl = await new Promise<string | null>((resolve) => {
      const img = new Image();
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
          // toDataURL throws SecurityError on tainted canvases (any
          // cross-origin image was drawn). Caught locally, resolves null.
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(null);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      };
      img.src = objectUrl;
    });

    logElapsed('canvas', start);
    return dataUrl;
  } catch {
    // Catches any unexpected throw from path 2 (XMLSerializer failures, Blob
    // construction failures, etc.). All non-fatal — caller renders placeholder.
    return null;
  }
}

function perfNow(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function logElapsed(path: 'ipc' | 'canvas', start: number): void {
  if (!import.meta.env?.DEV) return;
  const elapsed = perfNow() - start;
  // eslint-disable-next-line no-console
  console.log(`[iframeScreenshot] ${path}: ${elapsed.toFixed(1)}ms`);
  if (elapsed > PERF_BUDGET_MS) {
    // eslint-disable-next-line no-console
    console.warn(
      `[iframeScreenshot] ${path} exceeded ${PERF_BUDGET_MS}ms budget (${elapsed.toFixed(1)}ms)`,
    );
  }
}

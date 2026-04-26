// Phase 13 Plan 06 — Tauri-side screenshot fallback (currently STUB).
//
// This command exists so the JS layer has a stable command name to fall
// back on when the same-origin canvas approach fails (cross-origin iframe,
// tainted canvas, large pages that exceed the SVG foreignObject limits).
//
// **Demo scope simplification:** for Beat 4 we control what loads in the
// iframe (the seeded `contract-ide-demo` Next.js app on localhost), and the
// Phase 4 Plan 04-03 frame-src CSP makes localhost iframes same-origin under
// Tauri's WebView. The same-origin `iframeScreenshot.ts` path should suffice;
// this command is a placeholder for hardening or for a future cross-origin
// scenario (remote preview targets, prod deploys, etc.).
//
// **Future implementation paths** (any of these would satisfy CHAIN-04):
//   1. Native macOS `CGDisplayCreateImageForRect` of an offscreen WebView.
//   2. Headless WebKit via `webview2-com`-equivalent on macOS.
//   3. Pre-rendered PNG fixtures shipped with the demo seed and looked up
//      by route — simplest, no live capture needed.
//
// **JS contract:** when this returns Err, the JS caller MUST fall back to
// the same-origin captureIframeScreenshot() approach OR render a "no
// preview available" placeholder. The error message is informational only.

/// Render a route to a PNG and return the base64-encoded data URL.
///
/// Currently STUB: returns Err("not implemented") to signal the JS layer
/// should use the same-origin canvas approach (`captureIframeScreenshot`
/// in `src/lib/iframeScreenshot.ts`).
///
/// JS-side caller pattern:
/// ```ts
/// import { invoke } from '@tauri-apps/api/core';
/// const result = await invoke<string>('capture_route_screenshot', { url })
///   .catch(() => null);
/// if (result === null) {
///   // fall back to captureIframeScreenshot(iframe)
/// }
/// ```
#[tauri::command]
pub async fn capture_route_screenshot(_url: String) -> Result<String, String> {
    // TODO(plan 13-10b if needed): native macOS screenshot via CGDisplay or
    // headless WebKit. For demo scope we expect the same-origin canvas
    // approach in src/lib/iframeScreenshot.ts to work for localhost iframes.
    Err(
        "capture_route_screenshot not implemented; rely on JS-side same-origin canvas"
            .to_string(),
    )
}

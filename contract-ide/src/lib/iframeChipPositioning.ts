/**
 * Phase 13 Plan 05 — CHIP-01: postMessage protocol for parent ↔ iframe rect queries.
 *
 * The iframe (loaded from localhost — same origin per Plan 04-03 frame-src CSP
 * which allows `http://localhost:* http://127.0.0.1:*`) should respond to a
 * `request-chip-rects` message with positions of all `[data-contract-uuid]`
 * elements. The Babel/SWC plugin (Phase 9 BABEL-01) injects those attributes
 * onto JSX elements matching contract `code_ranges`.
 *
 * Two paths, in order:
 *
 *   1) Same-origin direct DOM access via `iframe.contentDocument`. This works
 *      today for localhost dev (Plan 04-03 CSP allows http://localhost:*) and
 *      doesn't require any iframe-side responder. This is the canonical path
 *      for the demo because the user's Next.js dev server runs on localhost.
 *
 *   2) `postMessage('request-chip-rects')` fallback for cross-origin iframes
 *      (e.g. a future scenario serves the preview from a CDN). The iframe-side
 *      responder must register a listener that posts back a `ChipRectMessage`.
 *      Plan 13-05 ships only the parent-side query; the iframe-side responder
 *      is out of scope (would be wired by a Phase 9 follow-up).
 *
 *   3) If both paths fail (cross-origin SecurityError + postMessage timeout),
 *      return an empty array. The caller (AtomChipOverlay) renders a
 *      chip-less iframe — still useful for layout, just no chip overlay.
 *
 * The returned rects are NORMALISED to iframe-local coordinates: the chip's
 * `top: rect.top` is its position relative to the iframe's top-left corner,
 * NOT the window's top-left. AtomChipOverlay positions chips inside an
 * absolutely-positioned div whose `inset-0` matches the iframe's bounding box,
 * so iframe-local coordinates are exactly what the chip needs.
 */

export interface ChipRect {
  uuid: string;
  rect: { top: number; left: number; width: number; height: number };
}

export interface ChipRectMessage {
  type: 'chip-rects';
  rects: ChipRect[];
}

/**
 * Query the iframe DOM for all elements with `data-contract-uuid` and return
 * their bounding rects in iframe-local coordinates.
 *
 * @param iframe     The iframe element to query.
 * @param timeoutMs  postMessage fallback timeout. Default 250ms — fast enough
 *                   that the user perceives the chip as "appearing with the
 *                   page," not "appearing after a delay."
 * @returns          Array of ChipRect; empty array on cross-origin failure
 *                   AND postMessage timeout (no exception thrown — caller
 *                   doesn't need to defend against rejection).
 */
export async function requestChipRects(
  iframe: HTMLIFrameElement,
  timeoutMs = 250,
): Promise<ChipRect[]> {
  // Path 1: same-origin direct DOM access.
  // This is the preferred path because (a) zero protocol coordination needed —
  // works today against any localhost dev server with no iframe-side script,
  // and (b) it returns synchronously rather than racing a postMessage timeout.
  try {
    const doc = iframe.contentDocument;
    if (doc) {
      const elems = doc.querySelectorAll<HTMLElement>('[data-contract-uuid]');
      const rects: ChipRect[] = [];
      const iframeRect = iframe.getBoundingClientRect();
      elems.forEach((el) => {
        const r = el.getBoundingClientRect();
        const uuid = el.getAttribute('data-contract-uuid');
        if (!uuid) return;
        rects.push({
          uuid,
          // Translate window-relative element rect into iframe-local
          // coordinates so the absolutely-positioned chip in the parent
          // overlay container (which itself is absolute-inset-0 over the
          // iframe) lands at the right spot.
          rect: {
            top: r.top - iframeRect.top,
            left: r.left - iframeRect.left,
            width: r.width,
            height: r.height,
          },
        });
      });
      return rects;
    }
  } catch {
    // SecurityError (cross-origin): fall through to the postMessage path.
    // We swallow rather than rethrow because the caller doesn't care WHY the
    // direct path failed — it just needs the postMessage attempt to run.
  }

  // Path 2: postMessage fallback. The iframe-side responder must register a
  // 'message' listener for `{ type: 'request-chip-rects' }` and post back a
  // `ChipRectMessage`. Plan 13-05 ships only the parent half; the iframe half
  // is out of scope (would be wired by a Phase 9 follow-up if cross-origin
  // previews ever ship).
  return new Promise<ChipRect[]>((resolve) => {
    const handle = setTimeout(() => {
      window.removeEventListener('message', listener);
      resolve([]);
    }, timeoutMs);
    const listener = (e: MessageEvent) => {
      // Only accept responses from THIS iframe — guards against unrelated
      // postMessage chatter (e.g. devtools, browser extensions).
      if (e.source !== iframe.contentWindow) return;
      const data = e.data as ChipRectMessage;
      if (data?.type === 'chip-rects' && Array.isArray(data.rects)) {
        clearTimeout(handle);
        window.removeEventListener('message', listener);
        resolve(data.rects);
      }
    };
    window.addEventListener('message', listener);
    iframe.contentWindow?.postMessage({ type: 'request-chip-rects' }, '*');
  });
}

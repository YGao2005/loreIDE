/**
 * Phase 13 Plan 05/06 — CHIP-01: postMessage protocol for parent ↔ iframe
 * rect queries.
 *
 * The previous implementation tried `iframe.contentDocument` direct DOM access
 * first and only used postMessage as a "fallback." That approach worked when
 * the IDE and the demo were both served from `tauri://localhost` (same origin),
 * but the actual demo runtime is:
 *
 *   IDE   → http://localhost:1420  (Vite dev server, the Tauri WebView host)
 *   demo  → http://localhost:3000  (Next.js dev server, loaded in iframe)
 *
 * Different ports = different origins under the same-origin policy. Reading
 * `iframe.contentDocument` (or even *catching* the SecurityError thrown by
 * the getter) trips DOMException logging in Chromium-based WebViews and
 * produces a flood of red console errors in the demo runbook. Worse, on
 * stricter WebKit builds the SecurityError is observable as an unhandled
 * exception even when wrapped in try/catch.
 *
 * Resolution: postMessage is the *only* path. The iframe-side responder lives
 * in the demo project (`contract-ide-demo/public/contract-chip-responder.js`,
 * loaded from the root layout) and answers `contract-ide:request-rects`
 * messages with `contract-ide:rects` replies.
 *
 * Protocol:
 *
 *   parent → iframe   { type: 'contract-ide:request-rects', uuids, requestId }
 *   iframe → parent   { type: 'contract-ide:rects',         requestId, rects }
 *
 *   - `requestId` is a per-call nonce so concurrent requests don't cross-talk.
 *     Late replies whose requestId no longer matches an outstanding request
 *     are ignored.
 *   - `uuids` is the set of atom uuids the parent wants positions for. The
 *     responder only measures elements matching `[data-contract-uuid="<uuid>"]`,
 *     skipping unrelated DOM nodes.
 *   - `event.source !== iframe.contentWindow` guards against unrelated
 *     postMessage chatter (devtools, browser extensions, other iframes).
 *
 * Failure modes (all return [] gracefully — UI degrades to "no chips"):
 *   - No contentWindow (iframe not loaded yet)            → []
 *   - 500ms timeout (responder script not loaded)         → []
 *   - requestId mismatch (stale reply)                    → ignored, eventual []
 *   - wrong source                                         → ignored, eventual []
 *
 * The returned rects are NORMALISED to iframe-local coordinates by the
 * iframe-side responder (it returns `getBoundingClientRect` values which ARE
 * already iframe-local because they're measured inside the iframe's own
 * window). The parent overlay container is `absolute inset-0` over the iframe
 * so iframe-local coordinates land at the right place.
 */

export interface ChipRect {
  uuid: string;
  rect: { top: number; left: number; width: number; height: number };
}

interface RectsMessage {
  type: 'contract-ide:rects';
  requestId: string;
  rects: Array<{
    uuid: string;
    rect: {
      x?: number;
      y?: number;
      top?: number;
      left?: number;
      width: number;
      height: number;
    };
  }>;
}

const REQUEST_TYPE = 'contract-ide:request-rects';
const RESPONSE_TYPE = 'contract-ide:rects';
const DEFAULT_TIMEOUT_MS = 500;

let requestCounter = 0;
function nextRequestId(): string {
  // Prefer crypto.randomUUID when available (Tauri WebView has it). Fall back
  // to a monotonic counter so node-environment tests that don't ship crypto
  // still get unique ids.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  requestCounter += 1;
  return `chip-req-${Date.now()}-${requestCounter}`;
}

/**
 * Ask the iframe for the bounding rects of the elements matching the given
 * atom uuids.
 *
 * @param iframe     The iframe element to query. Must have a `contentWindow`
 *                   (i.e. be attached to the document and loaded).
 * @param uuids      The atom uuids to request rects for. The responder only
 *                   measures elements whose `data-contract-uuid` is in this
 *                   set.
 * @param timeoutMs  How long to wait for a reply before resolving with [].
 *                   Default 500ms — long enough that the responder has a
 *                   reasonable chance to reply even on a slow first paint,
 *                   short enough that a missing responder doesn't block the
 *                   chip overlay rendering empty for visibly-long.
 * @returns          ChipRect[] on success; [] on any failure mode (no
 *                   contentWindow, timeout, mismatched requestId, etc.).
 *                   Never throws — caller doesn't need to defend against
 *                   rejection.
 */
export async function requestChipRects(
  iframe: HTMLIFrameElement,
  uuids: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ChipRect[]> {
  // Guard 1: no contentWindow → iframe not attached / not loaded. We can't
  // postMessage anywhere, so resolve [] immediately without registering a
  // listener (avoids leaking the listener across the eventual timeout).
  const target = iframe.contentWindow;
  if (!target) return [];

  const requestId = nextRequestId();

  return new Promise<ChipRect[]>((resolve) => {
    let settled = false;
    const finish = (value: ChipRect[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      window.removeEventListener('message', listener);
      resolve(value);
    };

    const listener = (e: MessageEvent) => {
      // Source guard: ignore messages from any window other than this
      // iframe's contentWindow. Without this guard, a sibling iframe (or a
      // browser extension) posting `contract-ide:rects` could spoof a reply.
      if (e.source !== target) return;
      const data = e.data as Partial<RectsMessage> | null | undefined;
      if (!data || data.type !== RESPONSE_TYPE) return;
      // requestId guard: a stale reply from a previous call (where the
      // iframe answered late, after this call's timeout fired or after a
      // newer call superseded it) must not resolve THIS promise. Falling
      // through means the eventual timeout triggers an empty resolve.
      if (data.requestId !== requestId) return;
      if (!Array.isArray(data.rects)) {
        finish([]);
        return;
      }
      const normalised: ChipRect[] = data.rects
        .filter((r) => r && typeof r.uuid === 'string' && r.rect)
        .map((r) => ({
          uuid: r.uuid,
          rect: {
            // Responder may serialize as either {x,y} (DOMRect.toJSON-style)
            // or {top,left}. Accept both; prefer top/left since that's what
            // CSS positioning consumes.
            top: r.rect.top ?? r.rect.y ?? 0,
            left: r.rect.left ?? r.rect.x ?? 0,
            width: r.rect.width,
            height: r.rect.height,
          },
        }));
      finish(normalised);
    };

    const timeoutHandle = setTimeout(() => {
      // Responder didn't reply (script not loaded? wrong message type
      // filter?). Resolve with [] so the overlay renders no chips rather
      // than hanging the caller forever.
      finish([]);
    }, timeoutMs);

    window.addEventListener('message', listener);

    // Use '*' as the targetOrigin because the iframe origin is whatever the
    // user's dev server runs on (localhost:3000 in the standard demo, but
    // could differ). The responder validates the message TYPE which is the
    // real authentication; the targetOrigin is just an extra layer that
    // would only matter for confidential payloads (atom uuids aren't secret).
    target.postMessage({ type: REQUEST_TYPE, uuids, requestId }, '*');
  });
}

// ---------------------------------------------------------------------------
// Phase 13 Plan 12 — Snapshot + Inspect-mode protocol
//
// Same postMessage transport as requestChipRects above, with three new
// message types: snapshot capture (synchronous request/reply with timeout)
// and inspect enable/disable + hover/click streaming (subscription model).
// ---------------------------------------------------------------------------

const SNAPSHOT_REQUEST_TYPE = 'contract-ide:capture-snapshot';
const SNAPSHOT_RESPONSE_TYPE = 'contract-ide:snapshot';
const INSPECT_ENABLE_TYPE = 'contract-ide:inspect-enable';
const INSPECT_DISABLE_TYPE = 'contract-ide:inspect-disable';
const INSPECT_HOVER_TYPE = 'contract-ide:inspect-hover';
const INSPECT_CLICK_TYPE = 'contract-ide:inspect-click';

const SNAPSHOT_TIMEOUT_MS = 3000;

export interface SnapshotResult {
  dataUrl: string;
  rects: ChipRect[];
}

interface SnapshotMessage {
  type: typeof SNAPSHOT_RESPONSE_TYPE;
  requestId: string;
  dataUrl?: string;
  rects?: Array<{
    uuid: string;
    rect: {
      x?: number;
      y?: number;
      top?: number;
      left?: number;
      width: number;
      height: number;
    };
  }>;
  error?: string;
}

function normaliseRects(
  raw: SnapshotMessage['rects'] | undefined,
): ChipRect[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r.uuid === 'string' && r.rect)
    .map((r) => ({
      uuid: r.uuid,
      rect: {
        top: r.rect.top ?? r.rect.y ?? 0,
        left: r.rect.left ?? r.rect.x ?? 0,
        width: r.rect.width,
        height: r.rect.height,
      },
    }));
}

/**
 * Ask the iframe to capture a PNG snapshot of its current viewport plus the
 * rects of every `[data-contract-uuid]` element. Pairs screenshot + rects in
 * a single frame so they're temporally consistent.
 *
 * The capture runs INSIDE the iframe (same-origin to its own document) using
 * the SVG-foreignObject + canvas trick. Cross-origin from the parent's POV
 * (IDE on :1420, demo on :3000) is sidestepped because the responder lives
 * in the iframe.
 *
 * @returns SnapshotResult on success; null on any failure (timeout,
 *          serialization error, tainted canvas, missing responder).
 *          Never throws.
 */
export async function requestSnapshot(
  iframe: HTMLIFrameElement,
  timeoutMs: number = SNAPSHOT_TIMEOUT_MS,
): Promise<SnapshotResult | null> {
  const target = iframe.contentWindow;
  if (!target) return null;

  const requestId = nextRequestId();

  return new Promise<SnapshotResult | null>((resolve) => {
    let settled = false;
    const finish = (value: SnapshotResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      window.removeEventListener('message', listener);
      resolve(value);
    };

    const listener = (e: MessageEvent) => {
      if (e.source !== target) return;
      const data = e.data as Partial<SnapshotMessage> | null | undefined;
      if (!data || data.type !== SNAPSHOT_RESPONSE_TYPE) return;
      if (data.requestId !== requestId) return;
      if (data.error || !data.dataUrl) {
        finish(null);
        return;
      }
      finish({ dataUrl: data.dataUrl, rects: normaliseRects(data.rects) });
    };

    const timeoutHandle = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener('message', listener);
    target.postMessage({ type: SNAPSHOT_REQUEST_TYPE, requestId }, '*');
  });
}

/** Tell the iframe to enable inspect-mode listeners (mousemove/click). */
export function enableInspect(iframe: HTMLIFrameElement): void {
  iframe.contentWindow?.postMessage({ type: INSPECT_ENABLE_TYPE }, '*');
}

/** Tell the iframe to disable inspect-mode listeners. */
export function disableInspect(iframe: HTMLIFrameElement): void {
  iframe.contentWindow?.postMessage({ type: INSPECT_DISABLE_TYPE }, '*');
}

export type InspectHoverPayload =
  | { uuid: string; rect: { top: number; left: number; width: number; height: number } }
  | { uuid: null };

export type InspectClickPayload = InspectHoverPayload;

interface InspectEventMessage {
  type: typeof INSPECT_HOVER_TYPE | typeof INSPECT_CLICK_TYPE;
  uuid: string | null;
  rect?: {
    x?: number;
    y?: number;
    top?: number;
    left?: number;
    width: number;
    height: number;
  };
}

function normaliseInspectPayload(
  msg: InspectEventMessage,
): InspectHoverPayload {
  if (msg.uuid === null || !msg.rect) return { uuid: null };
  return {
    uuid: msg.uuid,
    rect: {
      top: msg.rect.top ?? msg.rect.y ?? 0,
      left: msg.rect.left ?? msg.rect.x ?? 0,
      width: msg.rect.width,
      height: msg.rect.height,
    },
  };
}

/**
 * Subscribe to inspect-mode hover and click events from the iframe. Returns
 * an unsubscribe function. Caller is responsible for first calling
 * `enableInspect(iframe)` to start the iframe-side listeners; this function
 * only sets up the parent-side message listener.
 */
export function subscribeInspect(
  iframe: HTMLIFrameElement,
  onHover: (p: InspectHoverPayload) => void,
  onClick: (p: InspectClickPayload) => void,
): () => void {
  const target = iframe.contentWindow;
  if (!target) return () => {};

  const handler = (e: MessageEvent) => {
    if (e.source !== target) return;
    const data = e.data as Partial<InspectEventMessage> | null | undefined;
    if (!data || typeof data.type !== 'string') return;
    if (data.type === INSPECT_HOVER_TYPE) {
      onHover(normaliseInspectPayload(data as InspectEventMessage));
    } else if (data.type === INSPECT_CLICK_TYPE) {
      onClick(normaliseInspectPayload(data as InspectEventMessage));
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

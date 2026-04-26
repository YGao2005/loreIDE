/**
 * Vitest unit tests for `requestChipRects` (Phase 13 Plan 05/06 — CHIP-01).
 *
 * The helper is now postMessage-only (cross-origin localhost:1420 ↔ localhost:3000
 * makes the previous direct-DOM path produce SecurityError noise). These tests
 * exercise the round-trip protocol:
 *
 *   parent → iframe   { type: 'contract-ide:request-rects', uuids, requestId }
 *   iframe → parent   { type: 'contract-ide:rects',         requestId, rects }
 *
 * Project test infrastructure (per plan 13-04 SUMMARY):
 *   - vitest.config.ts uses `environment: 'node'` (NO jsdom)
 *   - test glob is `*.test.ts` only
 *   - `@testing-library/react` is NOT installed
 *
 * Therefore we install a minimal `window` stub with addEventListener /
 * removeEventListener and a controllable message-dispatch helper, plus a
 * minimal MessageEvent shape. Real browser semantics (event bubbling, capture
 * phase) are not modelled — the helper only uses `e.source` and `e.data`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requestChipRects } from '../iframeChipPositioning';

// --- Minimal window stub --------------------------------------------------

type Listener = (e: MessageEvent) => void;
interface WindowStub {
  listeners: Set<Listener>;
  addEventListener: (type: string, l: Listener) => void;
  removeEventListener: (type: string, l: Listener) => void;
  dispatch: (e: MessageEvent) => void;
}

function installWindowStub(): WindowStub {
  const listeners = new Set<Listener>();
  const stub: WindowStub = {
    listeners,
    addEventListener: (type: string, l: Listener) => {
      if (type === 'message') listeners.add(l);
    },
    removeEventListener: (type: string, l: Listener) => {
      if (type === 'message') listeners.delete(l);
    },
    dispatch: (e: MessageEvent) => {
      // Copy first so a listener that removes itself during dispatch doesn't
      // mutate the iteration set.
      [...listeners].forEach((l) => l(e));
    },
  };
  (globalThis as unknown as { window: WindowStub }).window = stub;
  return stub;
}

function removeWindowStub() {
  delete (globalThis as unknown as { window?: WindowStub }).window;
}

// --- Iframe + contentWindow mocks ----------------------------------------

interface PostedMessage {
  type: string;
  uuids?: string[];
  requestId?: string;
}

interface ContentWindowMock {
  postMessage: (msg: PostedMessage, targetOrigin: string) => void;
  posted: PostedMessage[];
}

function makeContentWindow(): ContentWindowMock {
  const posted: PostedMessage[] = [];
  return {
    posted,
    postMessage: (msg: PostedMessage) => {
      posted.push(msg);
    },
  };
}

function makeIframe(contentWindow: ContentWindowMock | null): HTMLIFrameElement {
  return { contentWindow } as unknown as HTMLIFrameElement;
}

function makeMessageEvent(
  data: unknown,
  source: unknown,
): MessageEvent {
  return { data, source } as MessageEvent;
}

describe('requestChipRects (postMessage protocol)', () => {
  beforeEach(() => {
    installWindowStub();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    removeWindowStub();
  });

  it('happy path: matching requestId and uuids resolve with rects', async () => {
    const cw = makeContentWindow();
    const iframe = makeIframe(cw);
    const win = (globalThis as unknown as { window: WindowStub }).window;

    const promise = requestChipRects(iframe, ['atom-1', 'atom-2'], 500);

    // The helper should have posted exactly one request to the iframe.
    expect(cw.posted).toHaveLength(1);
    const sent = cw.posted[0]!;
    expect(sent.type).toBe('contract-ide:request-rects');
    expect(sent.uuids).toEqual(['atom-1', 'atom-2']);
    expect(typeof sent.requestId).toBe('string');

    // Simulate the iframe responding with rects for both uuids.
    win.dispatch(
      makeMessageEvent(
        {
          type: 'contract-ide:rects',
          requestId: sent.requestId,
          rects: [
            { uuid: 'atom-1', rect: { x: 10, y: 20, width: 100, height: 30 } },
            { uuid: 'atom-2', rect: { top: 60, left: 200, width: 80, height: 24 } },
          ],
        },
        cw,
      ),
    );

    const rects = await promise;
    expect(rects).toHaveLength(2);
    // Accepts both {x,y} and {top,left} shapes — first element used x,y.
    expect(rects[0]).toEqual({
      uuid: 'atom-1',
      rect: { top: 20, left: 10, width: 100, height: 30 },
    });
    expect(rects[1]).toEqual({
      uuid: 'atom-2',
      rect: { top: 60, left: 200, width: 80, height: 24 },
    });
  });

  it('timeout: no reply within timeoutMs resolves to empty array', async () => {
    const cw = makeContentWindow();
    const iframe = makeIframe(cw);
    const win = (globalThis as unknown as { window: WindowStub }).window;

    const promise = requestChipRects(iframe, ['atom-1'], 500);

    // Listener registered while waiting.
    expect(win.listeners.size).toBe(1);

    // Advance past the timeout without dispatching any reply.
    await vi.advanceTimersByTimeAsync(600);

    const rects = await promise;
    expect(rects).toEqual([]);
    // Listener removed on timeout — guards against memory leaks.
    expect(win.listeners.size).toBe(0);
  });

  it('mismatched requestId: stale reply ignored, falls through to timeout', async () => {
    const cw = makeContentWindow();
    const iframe = makeIframe(cw);
    const win = (globalThis as unknown as { window: WindowStub }).window;

    const promise = requestChipRects(iframe, ['atom-1'], 500);

    // Reply with a DIFFERENT requestId — simulates a stale response from a
    // previous call. The helper must ignore it and let the timeout fire.
    win.dispatch(
      makeMessageEvent(
        {
          type: 'contract-ide:rects',
          requestId: 'some-other-id',
          rects: [{ uuid: 'atom-1', rect: { x: 0, y: 0, width: 10, height: 10 } }],
        },
        cw,
      ),
    );

    // Promise should NOT have resolved yet — listener is still attached.
    expect(win.listeners.size).toBe(1);

    await vi.advanceTimersByTimeAsync(600);
    const rects = await promise;
    expect(rects).toEqual([]);
  });

  it('wrong source: event from a different window is ignored', async () => {
    const cw = makeContentWindow();
    const otherWindow = makeContentWindow(); // different identity
    const iframe = makeIframe(cw);
    const win = (globalThis as unknown as { window: WindowStub }).window;

    const promise = requestChipRects(iframe, ['atom-1'], 500);
    const sent = cw.posted[0]!;

    // Dispatch a "valid-looking" reply but from `otherWindow` (e.g. a
    // sibling iframe or browser extension). Must be ignored.
    win.dispatch(
      makeMessageEvent(
        {
          type: 'contract-ide:rects',
          requestId: sent.requestId,
          rects: [{ uuid: 'atom-1', rect: { x: 0, y: 0, width: 10, height: 10 } }],
        },
        otherWindow,
      ),
    );

    expect(win.listeners.size).toBe(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(await promise).toEqual([]);
  });

  it('no contentWindow: returns empty array immediately, no listener leak', async () => {
    const iframe = makeIframe(null);
    const win = (globalThis as unknown as { window: WindowStub }).window;

    const rects = await requestChipRects(iframe, ['atom-1'], 500);

    expect(rects).toEqual([]);
    // Critically: no listener was ever registered (would otherwise leak
    // until the timeout, which never gets scheduled either).
    expect(win.listeners.size).toBe(0);
  });
});

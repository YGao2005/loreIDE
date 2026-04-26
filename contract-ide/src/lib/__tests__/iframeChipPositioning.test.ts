/**
 * Vitest unit tests for `requestChipRects` (Phase 13 Plan 05 — CHIP-01).
 *
 * Project test infrastructure constraint per plan 13-04 SUMMARY:
 *   - vitest.config.ts uses `environment: 'node'` (NO jsdom)
 *   - test glob is `*.test.ts` only (NO `.tsx`)
 *   - `@testing-library/react` is NOT installed
 *
 * Therefore these tests fabricate minimal duck-typed mocks of HTMLIFrameElement
 * + Document + Element rather than relying on a real DOM. We exercise the
 * load-bearing logic:
 *
 *   1. Rect normalisation: window-relative element rects become iframe-local
 *      coordinates by subtracting `iframe.getBoundingClientRect()`.
 *   2. SecurityError fallthrough: contentDocument access throwing returns []
 *      within timeoutMs (postMessage path with no responder times out).
 *   3. Skips elements without a data-contract-uuid attribute.
 *
 * The actual postMessage round-trip (path 2) is exercised by the smoke-test in
 * Task 3 (human-verify checkpoint) against a real Tauri WebView.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { requestChipRects, type ChipRect } from '../iframeChipPositioning';

// vitest.config.ts uses environment: 'node' (no jsdom) — `window` is undefined
// at module load. The helper's postMessage fallback path references
// `window.addEventListener` / `window.removeEventListener`, so tests that
// exercise the fallthrough need a minimal `window` stub. We install it
// per-test (rather than globally) so other tests stay close to the production
// runtime where window exists naturally inside the Tauri WebView.
type MinimalWindow = {
  addEventListener: (type: string, listener: (e: MessageEvent) => void) => void;
  removeEventListener: (
    type: string,
    listener: (e: MessageEvent) => void,
  ) => void;
};
function installWindowStub(): MinimalWindow {
  const stub: MinimalWindow = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as unknown as { window: MinimalWindow }).window = stub;
  return stub;
}
function removeWindowStub() {
  delete (globalThis as unknown as { window?: MinimalWindow }).window;
}

// Minimal duck-typed factories for the bits of DOM the helper actually touches.
// Cast through `unknown` because we only model the props/methods used —
// HTMLIFrameElement has hundreds of fields we don't need here.
function makeRect(top: number, left: number, width: number, height: number) {
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

interface MockElement {
  getBoundingClientRect: () => DOMRect;
  getAttribute: (name: string) => string | null;
}

function makeElement(uuid: string | null, rect: DOMRect): MockElement {
  return {
    getBoundingClientRect: () => rect,
    getAttribute: (name: string) =>
      name === 'data-contract-uuid' ? uuid : null,
  };
}

interface MockIframe {
  contentDocument: { querySelectorAll: (sel: string) => MockElement[] } | null;
  getBoundingClientRect: () => DOMRect;
  contentWindow: null;
}

function makeIframe(
  iframeRect: DOMRect,
  elementsByUuid: Array<{ uuid: string | null; rect: DOMRect }>,
): MockIframe {
  return {
    getBoundingClientRect: () => iframeRect,
    contentWindow: null,
    contentDocument: {
      querySelectorAll: (sel: string) => {
        // Only respond to the selector the helper uses — anything else
        // returns empty so a typo in the helper would fail the test.
        if (sel !== '[data-contract-uuid]') return [];
        return elementsByUuid.map(({ uuid, rect }) => makeElement(uuid, rect));
      },
    },
  };
}

describe('requestChipRects', () => {
  it('normalises element rects to iframe-local coordinates', async () => {
    // iframe at (100, 50) in window space; element at (180, 120) in window space.
    // Expected iframe-local position: (180-100, 120-50) = (80, 70).
    const iframe = makeIframe(makeRect(50, 100, 800, 600), [
      { uuid: 'atom-uuid-1', rect: makeRect(120, 180, 200, 40) },
    ]);

    const rects = await requestChipRects(iframe as unknown as HTMLIFrameElement);

    expect(rects).toHaveLength(1);
    const r = rects[0] as ChipRect;
    expect(r.uuid).toBe('atom-uuid-1');
    expect(r.rect.top).toBe(70); // 120 - 50
    expect(r.rect.left).toBe(80); // 180 - 100
    expect(r.rect.width).toBe(200);
    expect(r.rect.height).toBe(40);
  });

  it('handles multiple elements and preserves their iframe-local positions', async () => {
    const iframe = makeIframe(makeRect(0, 0, 800, 600), [
      { uuid: 'atom-a', rect: makeRect(10, 10, 100, 30) },
      { uuid: 'atom-b', rect: makeRect(60, 200, 80, 24) },
      { uuid: 'atom-c', rect: makeRect(450, 50, 250, 120) },
    ]);

    const rects = await requestChipRects(iframe as unknown as HTMLIFrameElement);

    expect(rects).toHaveLength(3);
    expect(rects.map((r) => r.uuid)).toEqual(['atom-a', 'atom-b', 'atom-c']);
    // Spot-check normalisation: iframe at (0,0) means iframe-local === window.
    expect(rects[1]!.rect.top).toBe(60);
    expect(rects[1]!.rect.left).toBe(200);
  });

  it('skips elements whose data-contract-uuid attribute is missing', async () => {
    // The querySelectorAll in real DOMs only returns elements WITH the
    // attribute, but defensive code in the helper checks again before
    // pushing — this guards against a future where the selector is
    // loosened.
    const iframe = makeIframe(makeRect(0, 0, 400, 300), [
      { uuid: 'atom-real', rect: makeRect(10, 10, 50, 20) },
      { uuid: null, rect: makeRect(100, 100, 50, 20) }, // attribute returns null
    ]);

    const rects = await requestChipRects(iframe as unknown as HTMLIFrameElement);

    // Only the element with a non-null uuid is emitted.
    expect(rects).toHaveLength(1);
    expect(rects[0]!.uuid).toBe('atom-real');
  });

  describe('postMessage fallthrough cases (require window stub)', () => {
    beforeEach(() => {
      installWindowStub();
    });
    afterEach(() => {
      removeWindowStub();
    });

    it('returns empty array when contentDocument is null (cross-origin or unloaded)', async () => {
      // contentDocument === null mimics either (a) cross-origin SecurityError
      // (the browser denies access) or (b) iframe not yet loaded.
      const iframe = {
        contentDocument: null,
        contentWindow: null,
        getBoundingClientRect: () => makeRect(0, 0, 400, 300),
      };

      // Use a tight timeout so the test doesn't sit waiting for the
      // postMessage fallback — there's no responder so it always times out.
      const rects = await requestChipRects(
        iframe as unknown as HTMLIFrameElement,
        10,
      );

      expect(rects).toEqual([]);
    });

    it('returns empty array when contentDocument access throws SecurityError', async () => {
      // True cross-origin behaviour: the browser throws on the contentDocument
      // getter. We model this with an object whose `contentDocument` property
      // throws when read, then the helper falls through to the postMessage
      // path which times out empty.
      const iframe = {
        get contentDocument() {
          throw new Error('Blocked by cross-origin');
        },
        contentWindow: null,
        getBoundingClientRect: () => makeRect(0, 0, 400, 300),
      };

      const rects = await requestChipRects(
        iframe as unknown as HTMLIFrameElement,
        10,
      );

      expect(rects).toEqual([]);
    });
  });
});

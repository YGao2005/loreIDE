import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Cmd+Shift+R (mac) / Ctrl+Shift+R (others) → invoke `reset_demo_state`
 * Tauri command, which spawns contract-ide/demo/reset-demo.sh and relaunches
 * the app with a deterministic SQLite seed. Pure stagecraft tool for
 * multi-take filming — never leave the IDE window between takes.
 *
 * preventDefault is critical: Cmd+Shift+R is the browser/devtools
 * "hard reload" shortcut; without preventDefault both would fire.
 *
 * Available in dev AND prod builds because the demo bundle uses the prod
 * build. The script itself is a no-op outside the demo machine layout
 * (REPO_ROOT defaults to $HOME/lahacks).
 *
 * Status feedback uses the same lightweight DOM-toast pattern established
 * by AppShell.tsx's source:click and substrate:first-node-toast handlers
 * (no toast library dep). Because the script's pkill cascade kills this
 * process ~1-2s after spawn, the success toast is mostly cosmetic — the
 * real signal is the app window blinking out and reappearing.
 */
export function useResetHotkey() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.shiftKey) return;
      if (e.key.toLowerCase() !== 'r') return;

      e.preventDefault();

      const startToast = makeToast('Resetting demo state…', 'info');
      const startedAt = performance.now();

      void invoke<void>('reset_demo_state')
        .then(() => {
          startToast.remove();
          const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
          // The reset script will SIGTERM us before this lands in most cases —
          // it's a belt-and-suspenders cosmetic confirmation.
          makeToast(`Reset spawned in ${seconds}s — relaunching…`, 'success');
        })
        .catch((err: unknown) => {
          startToast.remove();
          const msg = err instanceof Error ? err.message : String(err);
          makeToast(`Reset failed: ${msg}`, 'error');
          console.error('[useResetHotkey] reset_demo_state failed:', err);
        });
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}

type ToastKind = 'info' | 'success' | 'error';

function makeToast(text: string, kind: ToastKind): { remove: () => void } {
  const el = document.createElement('div');
  el.textContent = text;
  const accent =
    kind === 'error'
      ? 'border-color:#b91c1c;color:#fecaca'
      : kind === 'success'
        ? 'border-color:#15803d;color:#bbf7d0'
        : 'border-color:#444;color:#fff';
  el.style.cssText = [
    'position:fixed',
    'top:3rem',
    'left:50%',
    'transform:translateX(-50%)',
    'background:rgba(20,20,20,0.95)',
    'border:1px solid #444',
    'border-radius:8px',
    'padding:8px 14px',
    'font-size:11px',
    'font-family:var(--font-geist-sans,sans-serif)',
    'z-index:9999',
    'pointer-events:none',
    'opacity:1',
    'transition:opacity 0.3s ease',
    accent,
  ].join(';');
  document.body.appendChild(el);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 350);
  };

  // Auto-dismiss non-info toasts after a few seconds; info toasts persist
  // until the caller explicitly removes them (we replace with a final state).
  if (kind !== 'info') {
    setTimeout(remove, 3000);
  }

  return { remove };
}

// Dev-only console mirror. Wraps console.log/warn/error so every call also
// appends to /tmp/contract-ide.log via the `devlog` Tauri command. An
// external tailer can then observe the running app without the user having
// to copy/paste devtools output.
import { invoke } from '@tauri-apps/api/core';

type LogLevel = 'log' | 'warn' | 'error' | 'debug';

function formatArg(a: unknown): string {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function mirror(level: LogLevel, args: unknown[]) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${args.map(formatArg).join(' ')}`;
  // Fire-and-forget; never let a logger failure break the app.
  invoke<void>('devlog', { line }).catch(() => void 0);
}

export function installDevLog() {
  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  console.log = (...args: unknown[]) => {
    orig.log(...args);
    mirror('log', args);
  };
  console.warn = (...args: unknown[]) => {
    orig.warn(...args);
    mirror('warn', args);
  };
  console.error = (...args: unknown[]) => {
    orig.error(...args);
    mirror('error', args);
  };
  console.debug = (...args: unknown[]) => {
    orig.debug(...args);
    mirror('debug', args);
  };
  window.addEventListener('error', (e) => {
    mirror('error', ['window.onerror', e.message, e.filename, e.lineno]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    mirror('error', ['unhandledrejection', e.reason]);
  });
  mirror('log', ['[devlog] installed']);
}

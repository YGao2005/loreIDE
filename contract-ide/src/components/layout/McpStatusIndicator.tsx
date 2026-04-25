import { useEffect, useState } from 'react';
import { subscribeMcpStatus, getMcpStatus, type McpStatus } from '@/ipc/mcp';

/**
 * Small MCP health indicator (Plan 05-01). Subscribes to the `mcp:status`
 * Tauri event the Rust launch wiring emits, plus seeds from `get_mcp_status`
 * on mount to handle the race where the `ready` event fired before this
 * component mounted.
 *
 * Visual spec:
 *   unknown (default): grey dot, label "MCP…"
 *   running:           green dot, label "MCP ready"
 *   stopped:           red dot,   label "MCP offline" (reason in tooltip)
 */
export function McpStatusIndicator() {
  const [status, setStatus] = useState<McpStatus>('unknown');
  const [reason, setReason] = useState<string | undefined>();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getMcpStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        /* ignore — event stream is source of truth */
      });

    subscribeMcpStatus((ev) => {
      setStatus(ev.status);
      setReason(ev.reason);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const dotClass =
    status === 'running'
      ? 'bg-emerald-500'
      : status === 'stopped'
        ? 'bg-red-500'
        : 'bg-zinc-400';
  const label =
    status === 'running' ? 'MCP ready' : status === 'stopped' ? 'MCP offline' : 'MCP…';

  return (
    <div
      className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground"
      title={reason ? `${label} — ${reason}` : label}
      aria-live="polite"
    >
      <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden />
      <span>{label}</span>
    </div>
  );
}

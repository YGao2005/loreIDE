import { useState, useRef, useEffect } from 'react';
import type { RefObject } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { useAgentStore } from '@/store/agent';
import { useGraphStore } from '@/store/graph';
import { runAgent } from '@/ipc/agent';
import { assembleScopeContext } from '@/lib/agent-prompt';
import { extractTokenCounts } from '@/lib/jsonl-parser';
import { cn } from '@/lib/utils';
import type { ScopeContext } from '@/lib/agent-prompt';

// Stable empty array reference for the streamBuffer fallback. Returning a
// fresh `[]` from a Zustand selector each render makes useSyncExternalStore
// see a new snapshot every time and triggers an infinite update loop
// ("getSnapshot should be cached" warning).
const EMPTY_STREAM_BUFFER: readonly string[] = [];

/**
 * Collapsible chat panel (SHELL-01).
 *
 * Phase 8 (08-04b): REPLACES the Phase 1 placeholder body in place.
 * The existing `ChatPanelProps { panelRef }` signature is PRESERVED (B1)
 * so AppShell's collapse/expand affordance keeps working.
 *
 * Scope binding uses `useGraphStore(s => s.selectedNodeUuid)` per W4:
 * `useGraphStore` exposes selectedNodeUuid and parentUuidStack — there is
 * NO currentZoomedNodeUuid field. selectedNodeUuid IS the currently-zoomed
 * node (set by graph node click + Cmd+K jump-to-node).
 *
 * On Send:
 *   1. Read selectedNodeUuid from useGraphStore.getState() (W4).
 *   2. Call runAgent(prompt, selectedNodeUuid) — returns tracking_id.
 *   3. Store tracking_id via useAgentStore.getState().start().
 *   4. AppShell (mounted at boot) handles agent:stream → appendStream and
 *      agent:complete → complete. This component only reads those updates.
 */
export interface ChatPanelProps {
  panelRef: RefObject<PanelImperativeHandle | null>;
}

/** Try to extract a human-readable line from a stream-json event. */
function extractStreamText(line: string): string {
  if (!line.trim()) return '';
  try {
    const v = JSON.parse(line) as Record<string, unknown>;
    // stream-json assistant text delta
    const type = v['type'];
    if (type === 'assistant') {
      const msg = v['message'] as Record<string, unknown> | undefined;
      const content = msg?.['content'];
      if (Array.isArray(content)) {
        const texts: string[] = [];
        for (const block of content) {
          if (typeof block === 'object' && block !== null) {
            const b = block as Record<string, unknown>;
            if (b['type'] === 'text' && typeof b['text'] === 'string') {
              texts.push(b['text']);
            }
            if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
              const input = b['input'] as Record<string, unknown> | undefined;
              const fp = input?.['file_path'] ?? input?.['path'] ?? '';
              texts.push(`[${b['name']}: ${fp}]`);
            }
          }
        }
        if (texts.length > 0) return texts.join(' ');
      }
      // Try extracting usage as a counts summary
      const usage = msg?.['usage'];
      if (usage && typeof usage === 'object') {
        const counts = extractTokenCounts(usage as Record<string, unknown>);
        if (counts.output !== undefined) {
          return `[${counts.output} tokens out]`;
        }
      }
    }
    if (type === 'result') {
      const resultStr = v['result'];
      if (typeof resultStr === 'string' && resultStr.trim()) {
        return resultStr.slice(0, 200);
      }
    }
    // Fallback: show the raw line trimmed (but hide noisy system events)
    if (type === 'system') return '';
    return line.slice(0, 120);
  } catch {
    return line.slice(0, 120);
  }
}

export function ChatPanel({ panelRef }: ChatPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [scopeCtx, setScopeCtx] = useState<ScopeContext | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const streamEndRef = useRef<HTMLDivElement | null>(null);

  // W4: selectedNodeUuid IS the currently-zoomed node.
  const selectedNodeUuid = useGraphStore((s) => s.selectedNodeUuid);
  const nodes = useGraphStore((s) => s.nodes);
  const selectedNode = nodes.find((n) => n.uuid === selectedNodeUuid) ?? null;

  const agentStatus = useAgentStore((s) => s.current?.status ?? 'idle');
  const streamBuffer = useAgentStore(
    (s) => s.current?.streamBuffer ?? EMPTY_STREAM_BUFFER,
  );
  const isRunning = agentStatus === 'running';

  // Load scope context when selected node changes.
  useEffect(() => {
    if (!selectedNodeUuid) {
      setScopeCtx(null);
      return;
    }
    void assembleScopeContext(selectedNodeUuid).then(setScopeCtx).catch(() => setScopeCtx(null));
  }, [selectedNodeUuid]);

  // Auto-scroll stream buffer to bottom.
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamBuffer.length]);

  // Show toast when agent completes.
  useEffect(() => {
    if (agentStatus === 'complete') {
      setToastMsg('Receipt ready — see Receipts tab');
      const t = setTimeout(() => setToastMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [agentStatus]);

  const onToggle = () => {
    const panel = panelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setCollapsed(false);
    } else {
      panel.collapse();
      setCollapsed(true);
    }
  };

  const handleSend = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isRunning) return;
    const scopeUuid = useGraphStore.getState().selectedNodeUuid;
    try {
      const trackingId = await runAgent(trimmed, scopeUuid);
      useAgentStore.getState().start(trackingId, scopeUuid);
      setPrompt('');
    } catch (e) {
      console.error('[ChatPanel] runAgent failed:', e);
      setToastMsg(`Agent error: ${String(e)}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Scope chip label.
  const scopeChipLabel = selectedNode
    ? `${selectedNode.name}${scopeCtx ? ` (${scopeCtx.neighbors.length} neighbors)` : ''}`
    : 'No scope selected';

  // Status indicator text.
  const statusText: Record<string, string> = {
    idle: '',
    running: 'Streaming…',
    complete: 'Complete',
    error: 'Error',
  };

  return (
    <div className="h-full w-full bg-background border-t border-border/50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Chat</span>
          {agentStatus !== 'idle' && (
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded',
                agentStatus === 'running' && 'bg-teal-100/30 text-teal-600',
                agentStatus === 'complete' && 'bg-muted text-muted-foreground',
                agentStatus === 'error' && 'bg-red-100/30 text-red-600',
              )}
            >
              {statusText[agentStatus]}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? '▴ expand' : '▾ collapse'}
        </button>
      </div>

      {/* Scope context chip */}
      <div className="px-4 py-1.5 border-b border-border/30 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/60">Scope:</span>
          <span
            className={cn(
              'text-[11px] px-1.5 py-0.5 rounded font-mono',
              selectedNode
                ? 'bg-muted/60 text-foreground/80'
                : 'text-muted-foreground/50',
            )}
          >
            {scopeChipLabel}
          </span>
        </div>
      </div>

      {/* Streaming output pane */}
      <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0 font-mono text-xs text-foreground/80">
        {streamBuffer.length === 0 && agentStatus === 'idle' && (
          <div className="text-muted-foreground/50 text-[11px] pt-1">
            Type an intent below and press Send (or ⌘↵) to run the agent scoped to the selected node.
          </div>
        )}
        {streamBuffer.map((line, i) => {
          const text = extractStreamText(line);
          if (!text) return null;
          return (
            <div key={i} className="leading-relaxed text-[11px] py-0.5 break-words">
              {text}
            </div>
          );
        })}
        <div ref={streamEndRef} />
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className="mx-4 mb-1 px-3 py-1.5 rounded-md bg-muted/80 text-xs text-foreground/80 border border-border/40 shrink-0">
          {toastMsg}
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-border/50 px-3 py-2 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want the agent to do…"
            disabled={isRunning}
            rows={2}
            className={cn(
              'flex-1 resize-none rounded-md bg-muted/40 border border-border/60 px-3 py-2',
              'text-xs text-foreground placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-1 focus:ring-border',
              'disabled:opacity-50',
            )}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={isRunning || !prompt.trim()}
            className={cn(
              'shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              isRunning || !prompt.trim()
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-foreground/10 text-foreground hover:bg-foreground/20',
            )}
          >
            {isRunning ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

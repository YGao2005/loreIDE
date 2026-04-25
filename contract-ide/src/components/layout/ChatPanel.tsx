import { useState, useRef, useEffect } from 'react';
import { Loader2Icon, SendHorizonalIcon } from 'lucide-react';
import { useAgentStore } from '@/store/agent';
import { useGraphStore } from '@/store/graph';
import { runAgent } from '@/ipc/agent';
import { assembleScopeContext } from '@/lib/agent-prompt';
import { cn } from '@/lib/utils';
import { ChatStream } from '@/components/chat/ChatStream';
import type { ScopeContext } from '@/lib/agent-prompt';

// Stable empty array reference for the streamBuffer fallback. Returning a
// fresh `[]` from a Zustand selector each render makes useSyncExternalStore
// see a new snapshot every time and triggers an infinite update loop
// ("getSnapshot should be cached" warning).
const EMPTY_STREAM_BUFFER: readonly string[] = [];

/**
 * Chat content body. Tab-strip + panel collapse are owned by RightPanel.
 *
 * Scope binding: useGraphStore.selectedNodeUuid IS the currently-zoomed node
 * (set by graph node click + Cmd+K jump-to-node).
 *
 * On Send:
 *   1. Read selectedNodeUuid from useGraphStore.getState().
 *   2. Call runAgent(prompt, selectedNodeUuid) — returns tracking_id.
 *   3. Store tracking_id via useAgentStore.getState().start(id, scope, prompt).
 *   4. AppShell (mounted at boot) handles agent:stream → appendStream and
 *      agent:complete → complete. This component only reads those updates.
 *
 * Stream rendering is delegated to ChatStream, which parses the raw JSONL
 * buffer into structured events (text / thinking / tool / result).
 */

type ModelChoice = 'haiku' | 'sonnet' | 'opus';
type EffortChoice = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export function ChatPanel() {
  const [prompt, setPrompt] = useState('');
  const [scopeCtx, setScopeCtx] = useState<ScopeContext | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  // Per-session model + effort. Defaults match Rust DEFAULT_AGENT_* constants
  // — fast chat. Bump effort for harder questions; promote to sonnet/opus when
  // the agent needs to write code or reason through multi-step plans.
  const [model, setModel] = useState<ModelChoice>('haiku');
  const [effort, setEffort] = useState<EffortChoice>('low');
  const streamEndRef = useRef<HTMLDivElement | null>(null);

  // W4: selectedNodeUuid IS the currently-zoomed node.
  const selectedNodeUuid = useGraphStore((s) => s.selectedNodeUuid);
  const nodes = useGraphStore((s) => s.nodes);
  const selectedNode = nodes.find((n) => n.uuid === selectedNodeUuid) ?? null;

  const agentStatus = useAgentStore((s) => s.current?.status ?? 'idle');
  const streamBuffer = useAgentStore(
    (s) => s.current?.streamBuffer ?? EMPTY_STREAM_BUFFER,
  );
  const userPrompt = useAgentStore((s) => s.current?.prompt ?? null);
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

  const handleSend = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isRunning) return;
    const storeState = useGraphStore.getState();
    const scopeUuid = storeState.selectedNodeUuid;
    console.log('[ChatPanel] send', {
      scopeUuidAtSubmit: scopeUuid,
      reactSelectedNodeUuid: selectedNodeUuid,
      reactSelectedNodeName: selectedNode?.name ?? null,
      nodesLoaded: storeState.nodes.length,
    });
    try {
      const trackingId = await runAgent(trimmed, scopeUuid, { model, effort });
      useAgentStore.getState().start(trackingId, scopeUuid, trimmed);
      setPrompt('');
    } catch (e) {
      console.error('[ChatPanel] runAgent failed:', e);
      setToastMsg(`Agent error: ${String(e)}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline (standard chat UX).
    // Cmd/Ctrl+Enter also sends (kept for muscle memory from older builds).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
    <div className="h-full w-full bg-background flex flex-col">
      {/* Scope context chip + status indicator */}
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
          {agentStatus !== 'idle' && (
            <span
              className={cn(
                'ml-auto text-[10px] px-1.5 py-0.5 rounded',
                agentStatus === 'running' && 'bg-teal-100/30 text-teal-600',
                agentStatus === 'complete' && 'bg-muted text-muted-foreground',
                agentStatus === 'error' && 'bg-red-100/30 text-red-600',
              )}
            >
              {statusText[agentStatus]}
            </span>
          )}
        </div>
      </div>

      {/* Streaming output pane */}
      <div className="flex-1 overflow-y-auto px-3 py-1 min-h-0">
        {streamBuffer.length === 0 && !userPrompt && agentStatus === 'idle' && (
          <div className="text-muted-foreground/50 text-[11px] pt-2 px-1">
            Type an intent below and press Send (or ⌘↵) to run the agent scoped to the selected node.
          </div>
        )}
        <ChatStream
          lines={streamBuffer}
          userPrompt={userPrompt}
          isRunning={isRunning}
        />
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
        {/* Model + effort pickers — tune latency per message. Defaults
            (haiku + low) favor fast chat; bump for harder questions. */}
        <div className="flex items-center gap-3 mb-1.5 text-[10px] text-muted-foreground/80">
          <label className="flex items-center gap-1">
            <span>Model</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as ModelChoice)}
              disabled={isRunning}
              className={cn(
                'bg-muted/40 border border-border/60 rounded px-1.5 py-0.5',
                'text-foreground/80 text-[10px] cursor-pointer',
                'focus:outline-none focus:ring-1 focus:ring-ring',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <option value="haiku">Haiku</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span>Effort</span>
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value as EffortChoice)}
              disabled={isRunning}
              className={cn(
                'bg-muted/40 border border-border/60 rounded px-1.5 py-0.5',
                'text-foreground/80 text-[10px] cursor-pointer',
                'focus:outline-none focus:ring-1 focus:ring-ring',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">XHigh</option>
              <option value="max">Max</option>
            </select>
          </label>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want the agent to do… (Enter to send, Shift+Enter for newline)"
            disabled={isRunning}
            rows={2}
            className={cn(
              'flex-1 resize-none rounded-md bg-muted/40 border border-border/60 px-3 py-2',
              'text-xs text-foreground placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-1 focus:ring-ring',
              'disabled:opacity-50',
            )}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={isRunning || !prompt.trim()}
            aria-label="Send message"
            title={isRunning ? 'Agent is running…' : 'Send (Enter)'}
            className={cn(
              'shrink-0 inline-flex items-center justify-center rounded-md size-9 transition-all',
              isRunning || !prompt.trim()
                ? 'bg-muted text-muted-foreground/60 cursor-not-allowed'
                : 'bg-teal-500 text-white shadow-sm hover:bg-teal-600 active:scale-95',
            )}
          >
            {isRunning ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SendHorizonalIcon className="size-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

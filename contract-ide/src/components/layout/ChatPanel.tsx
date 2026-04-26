import { useState, useRef, useEffect } from 'react';
import { Loader2Icon, SendHorizonalIcon } from 'lucide-react';
import { useAgentStore } from '@/store/agent';
import { useGraphStore } from '@/store/graph';
import { runAgent } from '@/ipc/agent';
import { assembleScopeContext } from '@/lib/agent-prompt';
import { cn } from '@/lib/utils';
import { ChatStream } from '@/components/chat/ChatStream';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  const kickoff = useAgentStore((s) => s.current?.kickoff ?? null);
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

  // Status indicator text.
  const statusText: Record<string, string> = {
    idle: '',
    running: 'Streaming…',
    complete: 'Complete',
    error: 'Error',
  };

  return (
    <div className="h-full w-full bg-background flex flex-col">
      {/* Scope context card + status indicator. Communicates what the agent
          will use as context — same uuid as bottom Inspector + canvas selection
          ring. This panel is the "agent's view" of what you're looking at. */}
      <div className="px-3 pt-2 pb-2 border-b border-border/30 shrink-0">
        {selectedNode ? (
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="inline-flex items-center shrink-0 gap-1 px-1.5 py-0.5 rounded font-mono text-[9px] uppercase tracking-wide bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-500/20"
              title="Agent context — passed to the LLM with your message"
            >
              <span className="size-1.5 rounded-full bg-teal-500" aria-hidden />
              context
            </span>
            <span
              className="inline-flex items-center shrink-0 px-1.5 py-0.5 rounded font-mono text-[9px] bg-muted/60 text-foreground/70"
              title={`${selectedNode.level} · ${selectedNode.kind}`}
            >
              {selectedNode.level} · {selectedNode.kind}
            </span>
            <span
              className="text-xs font-medium truncate text-foreground/90"
              title={selectedNode.name}
            >
              {selectedNode.name}
            </span>
            {scopeCtx && scopeCtx.neighbors.length > 0 && (
              <span
                className="shrink-0 text-[10px] text-muted-foreground/70"
                title={`${scopeCtx.neighbors.length} graph neighbors will also be available to the agent`}
              >
                +{scopeCtx.neighbors.length}
              </span>
            )}
            {agentStatus !== 'idle' && (
              <span
                className={cn(
                  'ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded',
                  agentStatus === 'running' && 'bg-teal-100/30 text-teal-600',
                  agentStatus === 'complete' && 'bg-muted text-muted-foreground',
                  agentStatus === 'error' && 'bg-red-100/30 text-red-600',
                )}
              >
                {statusText[agentStatus]}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9px] uppercase tracking-wide bg-muted/40 border border-border/40">
              <span className="size-1.5 rounded-full bg-muted-foreground/40" aria-hidden />
              no context
            </span>
            <span>Click a node or atom to give the agent context</span>
            {agentStatus !== 'idle' && (
              <span
                className={cn(
                  'ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded',
                  agentStatus === 'running' && 'bg-teal-100/30 text-teal-600',
                  agentStatus === 'complete' && 'bg-muted text-muted-foreground',
                  agentStatus === 'error' && 'bg-red-100/30 text-red-600',
                )}
              >
                {statusText[agentStatus]}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Streaming output pane */}
      <div className="flex-1 overflow-y-auto px-3 py-1 min-h-0">
        {streamBuffer.length === 0 && !userPrompt && !kickoff && agentStatus === 'idle' && (
          <div className="text-muted-foreground/50 text-[11px] pt-2 px-1">
            Type an intent below and press Send (or ⌘↵) to run the agent scoped to the selected node.
          </div>
        )}
        <ChatStream
          lines={streamBuffer}
          userPrompt={userPrompt}
          isRunning={isRunning}
          kickoff={kickoff}
        />
        <div ref={streamEndRef} />
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className="mx-4 mb-1 px-3 py-1.5 rounded-md bg-muted/80 text-xs text-foreground/80 border border-border/40 shrink-0">
          {toastMsg}
        </div>
      )}

      {/* Input area — composed surface. Compact triggers above, textarea
          with embedded send below. Wrapped in a single subtle backdrop layer
          so it reads as one unified card. */}
      <div className="shrink-0 border-t border-border/40 bg-background/70 backdrop-blur-sm">
        <div className="px-3 pt-2 pb-3">
          {/* Triggers — pill-style dropdowns. Each shows its current value
              with a chevron; click to open a Radix popover with full labels +
              hint text. Compact form factor lets the textarea below take the
              full panel width even at 28% of screen. */}
          <div className="flex items-center gap-1.5 mb-2">
            <Select
              value={model}
              onValueChange={(v) => setModel(v as ModelChoice)}
              disabled={isRunning}
            >
              <SelectTrigger
                aria-label="Model"
                className={cn(
                  'h-6 px-2 py-0 gap-1.5 w-auto',
                  'rounded-md border border-border/40 bg-muted/40',
                  'text-[10px] font-medium text-foreground/80',
                  'shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-none',
                  'hover:bg-muted/70 hover:border-border/60',
                  'data-[state=open]:bg-muted/80 data-[state=open]:border-border/80',
                  'transition-colors duration-150',
                  '[&>svg]:size-3 [&>svg]:opacity-50 [&>svg]:translate-y-[0.5px]',
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="start"
                className="min-w-[180px] rounded-lg border-border/50 shadow-lg"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="text-[11px] py-1.5"
                  >
                    <div className="flex flex-col gap-0.5 py-0.5">
                      <span className="font-medium leading-none">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground/70 leading-none">
                        {opt.hint}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={effort}
              onValueChange={(v) => setEffort(v as EffortChoice)}
              disabled={isRunning}
            >
              <SelectTrigger
                aria-label="Effort"
                className={cn(
                  'h-6 px-2 py-0 gap-1.5 w-auto',
                  'rounded-md border border-border/40 bg-muted/40',
                  'text-[10px] font-medium text-foreground/80',
                  'shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-none',
                  'hover:bg-muted/70 hover:border-border/60',
                  'data-[state=open]:bg-muted/80 data-[state=open]:border-border/80',
                  'transition-colors duration-150',
                  '[&>svg]:size-3 [&>svg]:opacity-50 [&>svg]:translate-y-[0.5px]',
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="start"
                className="min-w-[180px] rounded-lg border-border/50 shadow-lg"
              >
                {EFFORT_OPTIONS.map((opt, i) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="text-[11px] py-1.5"
                  >
                    <div className="flex items-center gap-2 py-0.5">
                      {/* Intensity bars — visualizes the scale from low to max. */}
                      <span className="inline-flex items-center gap-[1.5px]" aria-hidden>
                        {EFFORT_OPTIONS.map((_, j) => (
                          <span
                            key={j}
                            className={cn(
                              'h-2.5 w-[2px] rounded-full transition-colors',
                              j <= i ? 'bg-teal-500' : 'bg-muted-foreground/25',
                            )}
                          />
                        ))}
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium leading-none">{opt.label}</span>
                        <span className="text-[10px] text-muted-foreground/70 leading-none">
                          {opt.hint}
                        </span>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Textarea with embedded send button. Button is absolute-positioned
              at bottom-right INSIDE the textarea well so the alignment is
              deliberate (single composed input) rather than three loose
              elements. Padding-right reserves space so typed text never
              collides with the button. */}
          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want the agent to do…"
              disabled={isRunning}
              rows={2}
              className={cn(
                'block w-full resize-none rounded-lg bg-muted/30 border border-border/40 pl-3 pr-12 py-2',
                'text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/40',
                'shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]',
                'transition-[background-color,border-color,box-shadow] duration-150',
                'focus:outline-none focus:bg-muted/50 focus:border-border/70 focus:ring-2 focus:ring-ring/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={isRunning || !prompt.trim()}
              aria-label="Send message"
              title={isRunning ? 'Agent is running…' : 'Send  ⏎'}
              className={cn(
                'group absolute right-2 bottom-2 inline-flex items-center justify-center size-7 rounded-md',
                'transition-all duration-150 ease-out',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                isRunning || !prompt.trim()
                  ? 'bg-transparent text-muted-foreground/40 cursor-not-allowed'
                  : cn(
                      'bg-gradient-to-b from-teal-500 to-teal-600 text-white',
                      'shadow-[0_1px_2px_rgba(13,148,136,0.25),inset_0_1px_0_rgba(255,255,255,0.2)]',
                      'hover:from-teal-400 hover:to-teal-500 hover:shadow-[0_2px_6px_rgba(13,148,136,0.35),inset_0_1px_0_rgba(255,255,255,0.24)]',
                      'active:from-teal-600 active:to-teal-700 active:scale-[0.96] active:shadow-[0_1px_1px_rgba(13,148,136,0.2)]',
                    ),
              )}
            >
              {isRunning ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <SendHorizonalIcon className="size-3.5 transition-transform duration-150 group-hover:translate-x-px" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Picker option metadata — mirrored on the trigger (label only) and in the
// dropdown menu (label + hint + visual scale for effort).
// ───────────────────────────────────────────────────────────────────────────

interface PickerOption<V extends string> {
  value: V;
  label: string;
  hint: string;
}

const MODEL_OPTIONS: readonly PickerOption<ModelChoice>[] = [
  { value: 'haiku', label: 'Haiku', hint: 'Fast · low cost' },
  { value: 'sonnet', label: 'Sonnet', hint: 'Balanced reasoning' },
  { value: 'opus', label: 'Opus', hint: 'Deepest reasoning' },
] as const;

const EFFORT_OPTIONS: readonly PickerOption<EffortChoice>[] = [
  { value: 'low', label: 'Low', hint: 'Snap replies' },
  { value: 'medium', label: 'Medium', hint: 'Balanced thinking' },
  { value: 'high', label: 'High', hint: 'Deep thinking' },
  { value: 'xhigh', label: 'XHigh', hint: 'Exhaustive thinking' },
  { value: 'max', label: 'Max', hint: 'No token limit' },
] as const;

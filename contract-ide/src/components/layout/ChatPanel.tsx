import { useState, useRef, useEffect } from 'react';
import {
  Loader2Icon,
  PlusIcon,
  SendHorizonalIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react';
import { useAgentStore, type ChatSession } from '@/store/agent';
import { useGraphStore } from '@/store/graph';
import { runAgent, stopAgent } from '@/ipc/agent';
import {
  closeChat as closeChatIpc,
  createChat as createChatIpc,
  renameChat as renameChatIpc,
} from '@/ipc/chats';
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

/**
 * Multi-chat content body. Tab-strip across the top (Cursor-model — close
 * moves to History, "+" creates a new chat). Below the strip: scope chip,
 * scrollback timeline, model/effort selectors, input.
 *
 * Active chat is held in `useAgentStore.activeChatId`. The chat list lives in
 * SQLite (`chats` table); this panel renders only open chats. Closed chats
 * live in the History panel (Phase E) — reopening reconstructs from the
 * session JSONL.
 *
 * On Send:
 *   1. Resolve activeChat (auto-create one if none).
 *   2. Read its `claudeSessionId` — if non-null, runAgent passes
 *      `resumeSessionId` so claude --resume picks up the conversation.
 *   3. Spawn the run; register trackingId → chatId via startRun.
 *   4. AppShell-mounted subscribers route agent:stream / agent:complete back
 *      into this chat by trackingId, regardless of which tab is active.
 *
 * Stream rendering is delegated to ChatStream, which parses raw JSONL into
 * structured events (assistant text / thinking / tool / result).
 */

type ModelChoice = 'haiku' | 'sonnet' | 'opus';
type EffortChoice = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const MAX_AUTO_NAME_LEN = 48;

function deriveChatName(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return 'New chat';
  if (trimmed.length <= MAX_AUTO_NAME_LEN) return trimmed;
  return trimmed.slice(0, MAX_AUTO_NAME_LEN - 1).trimEnd() + '…';
}

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

  // W4: selectedNodeUuid IS the currently-zoomed node. Scope chip shows the
  // GLOBAL selection, since the agent uses the live scope at send time —
  // chat row stores its scope_uuid for History display, not for runtime.
  const selectedNodeUuid = useGraphStore((s) => s.selectedNodeUuid);
  const nodes = useGraphStore((s) => s.nodes);
  const selectedNode = nodes.find((n) => n.uuid === selectedNodeUuid) ?? null;

  const chats = useAgentStore((s) => s.chats);
  const activeChatId = useAgentStore((s) => s.activeChatId);
  const activeChat: ChatSession | null =
    chats.find((c) => c.id === activeChatId) ?? null;

  // Derived view of the active chat — same fields the prior single-chat UI
  // consumed. When activeChat is null (empty state), all fall back to idle.
  const agentStatus = activeChat?.current?.status ?? 'idle';
  const streamBuffer = activeChat?.current?.streamBuffer ?? EMPTY_STREAM_BUFFER;
  const errorBuffer = activeChat?.current?.errorBuffer ?? EMPTY_STREAM_BUFFER;
  const userPrompt = activeChat?.current?.prompt ?? null;
  const kickoff = activeChat?.current?.kickoff ?? null;
  const history = activeChat?.history ?? EMPTY_HISTORY;
  const isRunning = agentStatus === 'running';
  const hasContent = history.length > 0 || agentStatus !== 'idle';

  // Load scope context when selected node changes.
  useEffect(() => {
    if (!selectedNodeUuid) {
      setScopeCtx(null);
      return;
    }
    void assembleScopeContext(selectedNodeUuid).then(setScopeCtx).catch(() => setScopeCtx(null));
  }, [selectedNodeUuid]);

  // Auto-scroll to bottom when the active chat streams a new line OR a new
  // turn is pushed. Only fires for the active chat (background tabs streaming
  // don't yank focus). Scrolls on tab switch too via activeChatId dep.
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamBuffer.length, history.length, activeChatId]);

  // Show toast when active chat completes a run.
  useEffect(() => {
    if (agentStatus === 'complete') {
      setToastMsg('Receipt ready — see History tab');
      const t = setTimeout(() => setToastMsg(null), 4000);
      return () => clearTimeout(t);
    }
    if (agentStatus === 'stopped') {
      setToastMsg('Run stopped');
      const t = setTimeout(() => setToastMsg(null), 2500);
      return () => clearTimeout(t);
    }
  }, [agentStatus]);

  const handleStop = async () => {
    const trackingId = activeChat?.current?.trackingId;
    if (!trackingId) return;
    // Optimistic — the killed claude process will fire agent:complete with a
    // non-zero exit; completeRun preserves 'stopped' so the UI doesn't flip
    // to 'error' afterward.
    useAgentStore.getState().markStopped(trackingId);
    try {
      await stopAgent(trackingId);
    } catch (e) {
      console.warn('[ChatPanel] stopAgent failed', e);
    }
  };

  const handleCreateChat = async (): Promise<ChatSession | null> => {
    try {
      const scopeUuid = useGraphStore.getState().selectedNodeUuid;
      const row = await createChatIpc({ scopeUuid, name: 'New chat' });
      useAgentStore.getState().upsertChatFromRow(row, { activate: true });
      return useAgentStore.getState().chats.find((c) => c.id === row.id) ?? null;
    } catch (e) {
      console.error('[ChatPanel] createChat failed', e);
      setToastMsg(`Couldn't start a new chat: ${String(e)}`);
      return null;
    }
  };

  const handleCloseTab = async (chatId: string) => {
    // Cursor model: close moves the chat to History (closed_at set in DB);
    // it can be reopened from the History panel later. Non-destructive.
    try {
      await closeChatIpc(chatId);
    } catch (e) {
      console.warn('[ChatPanel] closeChat failed (continuing)', e);
    }
    useAgentStore.getState().removeChat(chatId);
  };

  const handleSelectTab = (chatId: string) => {
    useAgentStore.getState().setActive(chatId);
  };

  const handleSend = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isRunning) return;

    // Resolve / lazily create the active chat. If the user hits Send with no
    // open tabs, we create one for them rather than blocking — friendlier
    // first-run UX than forcing them to click "+" first.
    let chat: ChatSession | null = activeChat;
    if (!chat) {
      chat = await handleCreateChat();
      if (!chat) return;
    }

    const scopeUuid = useGraphStore.getState().selectedNodeUuid;
    const resumeSessionId = chat.claudeSessionId;
    // Capture the prior turn's scope BEFORE startRun mutates chat.current — the
    // Rust runner uses this to detect a mid-chat canvas focus shift and re-inject
    // the new scope, since claude --resume otherwise stays anchored to turn-1's scope.
    const previousScopeUuid = chat.current?.scopeUuid ?? null;
    try {
      const trackingId = await runAgent(trimmed, scopeUuid, {
        model,
        effort,
        resumeSessionId,
        previousScopeUuid,
      });
      useAgentStore
        .getState()
        .startRun({ chatId: chat.id, trackingId, scopeUuid, prompt: trimmed });
      // Auto-name on first turn — only if the chat is still using the default
      // 'New chat' label. Persisted to DB so History shows a useful title.
      if (chat.name === 'New chat' || chat.name.trim() === '') {
        const next = deriveChatName(trimmed);
        useAgentStore.getState().applyName(chat.id, next);
        void renameChatIpc(chat.id, next).catch((e) =>
          console.warn('[ChatPanel] renameChat failed', e),
        );
      }
      setPrompt('');
    } catch (e) {
      console.error('[ChatPanel] runAgent failed:', e);
      setToastMsg(`Agent error: ${String(e)}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline (standard chat UX).
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
    stopped: 'Stopped',
  };

  return (
    <div className="h-full w-full bg-background flex flex-col">
      {/* Tab strip — open chats with the "+" button at the right end. Always
          rendered (even with zero tabs) so the "+" affordance is consistently
          discoverable. Cursor-model: closing a tab moves it to History, not
          destructive. */}
      <ChatTabStrip
        chats={chats}
        activeChatId={activeChatId}
        onSelect={handleSelectTab}
        onClose={(id) => void handleCloseTab(id)}
        onNew={() => void handleCreateChat()}
      />

      {/* Scope context card + status indicator. */}
      <div className="px-3 pt-2 pb-2 border-b border-border-subtle shrink-0">
        {selectedNode ? (
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="inline-flex items-center shrink-0 gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] uppercase tracking-wide bg-brand/8 text-brand border border-brand/25"
              title="Agent context — passed to the LLM with your message"
            >
              <span className="size-1.5 rounded-full bg-brand" aria-hidden />
              context
            </span>
            <span
              className="inline-flex items-center shrink-0 px-1.5 py-0.5 rounded font-mono text-[10px] bg-muted/60 text-foreground/70"
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
                  agentStatus === 'running' && 'bg-brand/10 text-brand',
                  agentStatus === 'complete' && 'bg-muted text-muted-foreground',
                  agentStatus === 'stopped' && 'bg-muted text-muted-foreground',
                  agentStatus === 'error' && 'bg-red-100/30 text-red-600',
                )}
              >
                {statusText[agentStatus]}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] uppercase tracking-wide bg-muted/40 border border-border-subtle">
              <span className="size-1.5 rounded-full bg-muted-foreground/40" aria-hidden />
              no context
            </span>
            <span>Click a node or atom to give the agent context</span>
            {agentStatus !== 'idle' && (
              <span
                className={cn(
                  'ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded',
                  agentStatus === 'running' && 'bg-brand/10 text-brand',
                  agentStatus === 'complete' && 'bg-muted text-muted-foreground',
                  agentStatus === 'stopped' && 'bg-muted text-muted-foreground',
                  agentStatus === 'error' && 'bg-red-100/30 text-red-600',
                )}
              >
                {statusText[agentStatus]}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Streaming output pane. Renders one ChatStream per turn — historical
          turns first (always idle), then the current run (may be streaming).
          Each ChatStream draws its own user-prompt bubble + event timeline.
          activeChatId in the key forces remount on tab switch so memoized
          ChatStream state (open thinking blocks etc.) doesn't bleed across
          chats. */}
      <div className="flex-1 overflow-y-auto px-3 py-1 min-h-0">
        {!activeChat ? (
          <EmptyChatState onNew={() => void handleCreateChat()} />
        ) : (
          <>
            {!hasContent && !userPrompt && !kickoff && (
              <div className="text-muted-foreground/50 text-[11px] pt-2 px-1">
                Type an intent below and press Send (or ⌘↵) to run the agent scoped to the selected node.
              </div>
            )}
            {history.map((run) => (
              <ChatStream
                key={`${activeChat.id}:${run.trackingId}`}
                lines={run.streamBuffer}
                userPrompt={run.prompt}
                isRunning={false}
                kickoff={run.kickoff ?? null}
              />
            ))}
            <ChatStream
              key={`${activeChat.id}:current`}
              lines={streamBuffer}
              userPrompt={userPrompt}
              isRunning={isRunning}
              kickoff={kickoff}
            />
            {agentStatus === 'error' && (
              <ErrorOutputBlock
                stderr={errorBuffer}
                stdout={streamBuffer}
              />
            )}
            <div ref={streamEndRef} />
          </>
        )}
      </div>

      {/* Toast */}
      {toastMsg && (
        <div className="mx-4 mb-1 px-3 py-1.5 rounded-md bg-muted/80 text-xs text-foreground/80 border border-border-subtle shrink-0">
          {toastMsg}
        </div>
      )}

      {/* Input area — composed surface. Compact triggers above, textarea
          with embedded send below. Always rendered so the "Send" path can
          auto-create a chat when none is active. */}
      <div className="shrink-0 border-t border-border-subtle bg-background/70 backdrop-blur-sm">
        <div className="px-3 pt-2 pb-3">
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
                  'rounded-md border border-border-subtle bg-muted/40',
                  'text-[10px] font-medium text-foreground/80',
                  'shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-none',
                  'hover:bg-muted/70 hover:border-border-strong',
                  'data-[state=open]:bg-muted/80 data-[state=open]:border-border-strong',
                  'transition-colors duration-150',
                  '[&>svg]:size-3 [&>svg]:opacity-50 [&>svg]:translate-y-[0.5px]',
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="start"
                className="min-w-[180px] rounded-lg border-border shadow-lg"
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
                  'rounded-md border border-border-subtle bg-muted/40',
                  'text-[10px] font-medium text-foreground/80',
                  'shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-none',
                  'hover:bg-muted/70 hover:border-border-strong',
                  'data-[state=open]:bg-muted/80 data-[state=open]:border-border-strong',
                  'transition-colors duration-150',
                  '[&>svg]:size-3 [&>svg]:opacity-50 [&>svg]:translate-y-[0.5px]',
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="start"
                className="min-w-[180px] rounded-lg border-border shadow-lg"
              >
                {EFFORT_OPTIONS.map((opt, i) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="text-[11px] py-1.5"
                  >
                    <div className="flex items-center gap-2 py-0.5">
                      <span className="inline-flex items-center gap-[1.5px]" aria-hidden>
                        {EFFORT_OPTIONS.map((_, j) => (
                          <span
                            key={j}
                            className={cn(
                              'h-2.5 w-[2px] rounded-full transition-colors',
                              j <= i ? 'bg-brand' : 'bg-muted-foreground/25',
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

          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want the agent to do…"
              disabled={isRunning}
              rows={2}
              className={cn(
                'block w-full resize-none rounded-lg bg-muted/30 border border-border-subtle pl-3 pr-12 py-2',
                'text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/40',
                'shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]',
                'transition-[background-color,border-color,box-shadow] duration-150',
                'focus:outline-none focus:bg-muted/50 focus:border-border-strong focus:ring-2 focus:ring-ring/20',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            />
            {isRunning ? (
              <button
                type="button"
                onClick={() => void handleStop()}
                aria-label="Stop run"
                title="Stop run"
                className={cn(
                  'group absolute right-2 bottom-2 inline-flex items-center justify-center size-7 rounded-md',
                  'transition-all duration-150 ease-out',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  // Distinct red-tinted treatment so stop is visually unambiguous
                  // — never confused with the brand-color Send button.
                  'bg-red-500/90 text-white',
                  'shadow-[0_1px_2px_rgba(220,38,38,0.3),inset_0_1px_0_rgba(255,255,255,0.18)]',
                  'hover:brightness-110 hover:shadow-[0_2px_6px_rgba(220,38,38,0.4),inset_0_1px_0_rgba(255,255,255,0.22)]',
                  'active:brightness-95 active:scale-[0.96]',
                )}
              >
                <SquareIcon className="size-3 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!prompt.trim()}
                aria-label="Send message"
                title="Send  ⏎"
                className={cn(
                  'group absolute right-2 bottom-2 inline-flex items-center justify-center size-7 rounded-md',
                  'transition-all duration-150 ease-out',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  !prompt.trim()
                    ? 'bg-transparent text-muted-foreground/40 cursor-not-allowed'
                    : cn(
                        'bg-brand text-brand-foreground',
                        'shadow-[0_1px_2px_rgba(72,107,122,0.25),inset_0_1px_0_rgba(255,255,255,0.18)]',
                        'hover:brightness-110 hover:shadow-[0_2px_6px_rgba(72,107,122,0.35),inset_0_1px_0_rgba(255,255,255,0.22)]',
                        'active:brightness-95 active:scale-[0.96] active:shadow-[0_1px_1px_rgba(72,107,122,0.2)]',
                      ),
                )}
              >
                <SendHorizonalIcon className="size-3.5 transition-transform duration-150 group-hover:translate-x-px" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Tab strip — Cursor-style chat tabs + "+" affordance
// ───────────────────────────────────────────────────────────────────────────

interface ChatTabStripProps {
  chats: ChatSession[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
  onClose: (chatId: string) => void;
  onNew: () => void;
}

function ChatTabStrip({
  chats,
  activeChatId,
  onSelect,
  onClose,
  onNew,
}: ChatTabStripProps) {
  return (
    <div className="flex items-stretch border-b border-border-subtle bg-muted/20 shrink-0 min-h-[34px]">
      <div className="flex-1 flex items-stretch overflow-x-auto">
        {chats.map((chat) => (
          <ChatTab
            key={chat.id}
            chat={chat}
            active={chat.id === activeChatId}
            onSelect={() => onSelect(chat.id)}
            onClose={() => onClose(chat.id)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onNew}
        aria-label="New chat"
        title="New chat"
        className={cn(
          'shrink-0 inline-flex items-center justify-center w-8',
          'border-l border-border-subtle text-muted-foreground/70',
          'hover:bg-muted/60 hover:text-foreground transition-colors',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/40',
        )}
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  );
}

interface ChatTabProps {
  chat: ChatSession;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function ChatTab({ chat, active, onSelect, onClose }: ChatTabProps) {
  const isRunning = chat.current?.status === 'running';
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group relative flex items-center gap-1.5 px-2.5 min-w-0 max-w-[180px]',
        'cursor-pointer select-none transition-colors',
        'border-r border-border-subtle',
        active
          ? 'bg-background text-foreground'
          : 'bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground/80',
      )}
    >
      {/* Active indicator — thin top bar */}
      {active && (
        <span
          className="absolute inset-x-0 top-0 h-[2px] bg-brand"
          aria-hidden
        />
      )}
      {isRunning ? (
        <Loader2Icon
          className={cn(
            'size-3 shrink-0 animate-spin',
            active ? 'text-brand' : 'text-muted-foreground/70',
          )}
        />
      ) : (
        <span
          className={cn(
            'size-1.5 rounded-full shrink-0',
            active ? 'bg-brand' : 'bg-muted-foreground/30',
          )}
          aria-hidden
        />
      )}
      <span
        className="text-[11px] font-medium truncate min-w-0"
        title={chat.name}
      >
        {chat.name}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close chat"
        title="Close (moves to History)"
        className={cn(
          'shrink-0 size-4 rounded-sm flex items-center justify-center',
          'transition-opacity',
          active
            ? 'opacity-50 hover:opacity-100 hover:bg-muted/80'
            : 'opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-muted/80',
        )}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Error output — surfaces stderr (+ unparseable stdout) when the run failed
// ───────────────────────────────────────────────────────────────────────────

/** Shown beneath a failed run. The actionable error from `claude` (auth,
 * credit balance, missing API key, network) lands on stderr; we also surface
 * any stdout lines that didn't parse as known JSONL events since claude
 * sometimes writes plain-text errors to stdout before exiting. */
function ErrorOutputBlock({
  stderr,
  stdout,
}: {
  stderr: readonly string[];
  stdout: readonly string[];
}) {
  // Filter stdout to lines that are NOT recognized JSON event types, since
  // those are already rendered as ChatEvents in the timeline above. The
  // remainder is usually a plain-text error or an init/system line that the
  // parser ignored.
  const stdoutNoise = stdout.filter((line) => {
    const t = line.trim();
    if (!t) return false;
    try {
      const v = JSON.parse(t) as Record<string, unknown>;
      const kind = v['type'];
      // Hide normal stream-json events; keep anything else.
      return !(
        kind === 'system' ||
        kind === 'assistant' ||
        kind === 'user' ||
        kind === 'result'
      );
    } catch {
      // Non-JSON line — definitely worth showing.
      return true;
    }
  });

  const all = [
    ...stderr.map((l) => ({ kind: 'stderr' as const, line: l })),
    ...stdoutNoise.map((l) => ({ kind: 'stdout' as const, line: l })),
  ];
  if (all.length === 0) {
    return (
      <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
        Run failed with no output captured. Check the terminal running{' '}
        <code className="font-mono">pnpm tauri dev</code> for{' '}
        <code className="font-mono">[agent] stderr</code> lines, or run{' '}
        <code className="font-mono">claude</code> from a shell to verify auth
        / usage.
      </div>
    );
  }

  return (
    <details className="mt-2 rounded-md border border-red-500/40 bg-red-500/5 group" open>
      <summary className="px-3 py-1.5 text-[11px] font-medium text-red-700 dark:text-red-300 cursor-pointer select-none flex items-center gap-2">
        <span>Error output</span>
        <span className="text-[10px] font-normal text-red-700/70 dark:text-red-300/70">
          {all.length} {all.length === 1 ? 'line' : 'lines'}
        </span>
      </summary>
      <pre className="px-3 pb-2 pt-1 text-[11px] font-mono whitespace-pre-wrap break-words leading-relaxed text-red-800/90 dark:text-red-200/90 max-h-72 overflow-y-auto">
        {all.map((entry, i) => (
          <div key={i} className={cn(entry.kind === 'stderr' && 'text-red-600 dark:text-red-400')}>
            {entry.line}
          </div>
        ))}
      </pre>
    </details>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Empty state — no chats open
// ───────────────────────────────────────────────────────────────────────────

function EmptyChatState({ onNew }: { onNew: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
      <div className="text-[13px] font-medium text-foreground/80">
        No open chats
      </div>
      <div className="text-[11px] text-muted-foreground/70 max-w-[280px] leading-relaxed">
        Past chats live in the History tab. Click "+" up top — or type below
        and press Send — to start a new one.
      </div>
      <button
        type="button"
        onClick={onNew}
        className={cn(
          'mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md',
          'bg-brand text-brand-foreground text-[11px] font-medium',
          'shadow-[0_1px_2px_rgba(72,107,122,0.25),inset_0_1px_0_rgba(255,255,255,0.18)]',
          'hover:brightness-110 transition-all',
        )}
      >
        <PlusIcon className="size-3" />
        Start a new chat
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Stable empty references — Zustand selectors that return a fresh array each
// render trigger React's "getSnapshot should be cached" warning.
// ───────────────────────────────────────────────────────────────────────────

const EMPTY_STREAM_BUFFER: readonly string[] = [];
const EMPTY_HISTORY: readonly never[] = [];

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

/**
 * History panel — list of closed chats with their per-turn receipts folded
 * inline. Replaces the prior "Receipts" tab; receipts now live as expandable
 * detail under the chat row that produced them.
 *
 * Click the row body to expand/collapse the receipts list. Click "Reopen" to
 * pull the chat back into the tab strip — calls reopen_chat then
 * read_chat_jsonl to reconstruct conversation content from the session JSONL,
 * then upsertChatFromRow with the reconstructed history.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CornerUpLeftIcon,
  Loader2Icon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentStore, turnsToAgentRuns } from '@/store/agent';
import {
  getChatReceipts,
  getChatSummaries,
  listHistoryChats,
  readChatJsonl,
  reopenChat,
  type ChatReceipt,
  type ChatRow,
  type ChatSummary,
} from '@/ipc/chats';

interface HistoryPanelProps {
  /** Called after a successful reopen so the parent can switch the right
   * panel back to the Chat tab and surface the reactivated chat. */
  onReopen?: (chatId: string) => void;
}

const POLL_AFTER_REOPEN_MS = 250;

export function HistoryPanel({ onReopen }: HistoryPanelProps) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ChatSummary>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [receiptsByChat, setReceiptsByChat] = useState<
    Record<string, ChatReceipt[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Open chats — used to dim/disable rows that are already in the tab strip.
  // Select the stable `chats` array reference (Zustand snapshot is cached on
  // identity), then derive the lookup Set in a memo. Returning `new Set(...)`
  // straight from the selector trips React's getSnapshot caching rule and
  // triggers an infinite render loop.
  const openChats = useAgentStore((s) => s.chats);
  const openChatIds = useMemo(
    () => new Set(openChats.map((c) => c.id)),
    [openChats],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listHistoryChats({ limit: 50 });
      setChats(rows);
      if (rows.length > 0) {
        const sums = await getChatSummaries(rows.map((r) => r.id));
        const map: Record<string, ChatSummary> = {};
        for (const s of sums) map[s.chat_id] = s;
        setSummaries(map);
      }
    } catch (e) {
      console.error('[HistoryPanel] load failed', e);
      setError(`Couldn't load history: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleToggle = async (chatId: string) => {
    if (expandedId === chatId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(chatId);
    if (!receiptsByChat[chatId]) {
      try {
        const rs = await getChatReceipts(chatId);
        setReceiptsByChat((prev) => ({ ...prev, [chatId]: rs }));
      } catch (e) {
        console.warn('[HistoryPanel] getChatReceipts failed', e);
      }
    }
  };

  const handleReopen = async (chatId: string) => {
    setReopeningId(chatId);
    try {
      const row = await reopenChat(chatId);
      const turns = await readChatJsonl(chatId);
      const history = turnsToAgentRuns(turns);
      useAgentStore.getState().upsertChatFromRow(row, {
        history,
        activate: true,
      });
      onReopen?.(chatId);
      // Drop the chat out of the History list locally — DB closed_at is now
      // null, so a fresh load would also hide it. Save the round trip.
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      // Light delay so the user sees the chat appear in the tab strip before
      // the row vanishes — pure UX nicety, can drop if it feels laggy.
      setTimeout(() => setReopeningId(null), POLL_AFTER_REOPEN_MS);
    } catch (e) {
      console.error('[HistoryPanel] reopen failed', e);
      setError(`Couldn't reopen chat: ${String(e)}`);
      setReopeningId(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-3 pt-2 pb-2 border-b border-border-subtle shrink-0 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          History
        </span>
        <span className="text-[11px] text-muted-foreground/60">
          {chats.length} {chats.length === 1 ? 'chat' : 'chats'}
        </span>
        <button
          type="button"
          onClick={() => void loadAll()}
          className="ml-auto text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
          title="Refresh"
        >
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-[11px] text-muted-foreground/60">
            <Loader2Icon className="size-3.5 animate-spin mr-2" />
            Loading history…
          </div>
        ) : error ? (
          <div className="text-[11px] text-red-600/80 px-2">{error}</div>
        ) : chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center px-6">
            <div className="text-[12px] font-medium text-foreground/80">
              No history yet
            </div>
            <div className="text-[11px] text-muted-foreground/60 max-w-[280px] leading-relaxed">
              Closed chats land here. Receipts (token counts, cost, tool calls)
              fold under the chat that generated them.
            </div>
          </div>
        ) : (
          <ul className="space-y-1">
            {chats.map((chat) => (
              <HistoryRow
                key={chat.id}
                chat={chat}
                summary={summaries[chat.id]}
                expanded={expandedId === chat.id}
                receipts={receiptsByChat[chat.id]}
                isOpenInTabs={openChatIds.has(chat.id)}
                isReopening={reopeningId === chat.id}
                onToggle={() => void handleToggle(chat.id)}
                onReopen={() => void handleReopen(chat.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface HistoryRowProps {
  chat: ChatRow;
  summary: ChatSummary | undefined;
  expanded: boolean;
  receipts: ChatReceipt[] | undefined;
  isOpenInTabs: boolean;
  isReopening: boolean;
  onToggle: () => void;
  onReopen: () => void;
}

function HistoryRow({
  chat,
  summary,
  expanded,
  receipts,
  isOpenInTabs,
  isReopening,
  onToggle,
  onReopen,
}: HistoryRowProps) {
  const closedAt = chat.closed_at
    ? new Date(chat.closed_at).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  return (
    <li
      className={cn(
        'rounded-md border border-border-subtle bg-muted/20 transition-colors',
        expanded && 'border-border-strong bg-muted/40',
      )}
    >
      {/* Row header */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 size-4 rounded text-muted-foreground hover:text-foreground transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 min-w-0 flex flex-col items-start text-left"
        >
          <span
            className="text-[12px] font-medium text-foreground/90 truncate w-full"
            title={chat.name}
          >
            {chat.name}
          </span>
          <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1.5 mt-0.5">
            {closedAt && <span>{closedAt}</span>}
            {summary && summary.turn_count > 0 && (
              <>
                <span>·</span>
                <span>
                  {summary.turn_count}{' '}
                  {summary.turn_count === 1 ? 'turn' : 'turns'}
                </span>
              </>
            )}
            {summary && summary.total_cost_usd > 0 && (
              <>
                <span>·</span>
                <span>${summary.total_cost_usd.toFixed(4)}</span>
              </>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={onReopen}
          disabled={isOpenInTabs || isReopening}
          className={cn(
            'shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded',
            'text-[10px] font-medium transition-colors',
            'border border-border-subtle',
            isOpenInTabs
              ? 'opacity-40 cursor-not-allowed text-muted-foreground'
              : isReopening
                ? 'opacity-60 text-muted-foreground'
                : 'text-foreground/80 hover:bg-muted/60 hover:text-foreground',
          )}
          title={
            isOpenInTabs
              ? 'Already open in the tab strip'
              : 'Reopen as a live tab'
          }
        >
          {isReopening ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <CornerUpLeftIcon className="size-3" />
          )}
          {isOpenInTabs ? 'Open' : 'Reopen'}
        </button>
      </div>

      {/* Expanded receipts list */}
      {expanded && (
        <div className="border-t border-border-subtle px-2.5 py-2">
          {!receipts ? (
            <div className="text-[10px] text-muted-foreground/60 italic px-1">
              Loading receipts…
            </div>
          ) : receipts.length === 0 ? (
            <div className="text-[10px] text-muted-foreground/60 italic px-1">
              No receipts captured for this chat.
            </div>
          ) : (
            <ul className="space-y-1">
              {receipts.map((r, i) => (
                <ReceiptRow key={String(r['id'] ?? i)} receipt={r} index={i + 1} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function ReceiptRow({
  receipt,
  index,
}: {
  receipt: ChatReceipt;
  index: number;
}) {
  const inputTokens = numberOf(receipt['input_tokens']);
  const outputTokens = numberOf(receipt['output_tokens']);
  const cost = numberOf(receipt['estimated_cost_usd']);
  const toolCalls = numberOf(receipt['tool_call_count']);
  const wallTimeMs = numberOf(receipt['wall_time_ms']);
  const startedAt = stringOf(receipt['started_at']);
  const parseStatus = stringOf(receipt['parse_status']);
  const isMock = parseStatus === 'fallback_mock';

  return (
    <li className="flex items-center gap-2 text-[10px] text-muted-foreground/80 font-mono">
      <span className="text-muted-foreground/50 w-5 text-right shrink-0">
        #{index}
      </span>
      {startedAt && (
        <span className="shrink-0">
          {new Date(startedAt).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      )}
      <span className="shrink-0">
        {inputTokens.toLocaleString()}↓ / {outputTokens.toLocaleString()}↑
      </span>
      {toolCalls > 0 && (
        <span className="shrink-0">{toolCalls} tools</span>
      )}
      {wallTimeMs > 0 && (
        <span className="shrink-0">{formatDuration(wallTimeMs)}</span>
      )}
      <span className="ml-auto shrink-0 text-foreground/70">
        ${cost.toFixed(4)}
      </span>
      {isMock && (
        <span
          className="shrink-0 rounded bg-amber-500/15 border border-amber-500/30 px-1 py-0.5 text-[9px] text-amber-600"
          title="JSONL parse fell back to mock — token counts may be zero"
        >
          mock
        </span>
      )}
    </li>
  );
}

function numberOf(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function stringOf(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

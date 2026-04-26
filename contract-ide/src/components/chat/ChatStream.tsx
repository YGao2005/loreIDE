/**
 * Renders the parsed agent stream as a Cursor/Antigravity-style timeline:
 *   - User prompt bubble at top
 *   - Assistant prose blocks
 *   - Collapsible "Thinking" reasoning blocks
 *   - Tool-call cards (icon + summary, expandable to show input + result)
 *   - Final result/usage chip
 *
 * Stream parsing is memoized on the buffer reference; re-renders during
 * streaming only re-parse when a new line arrives.
 */
import { memo, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Brain,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  FileEditIcon,
  FileSearchIcon,
  FileTextIcon,
  GlobeIcon,
  ListChecksIcon,
  Loader2Icon,
  PencilIcon,
  PlugIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  parseChatStream,
  prettyToolName,
  toolCallSummary,
  type ChatEvent,
} from '@/lib/chatStream';
import { KickoffCard } from './KickoffCard';
import type { KickoffPayload } from '@/store/agent';

interface ChatStreamProps {
  /** Raw JSONL lines from agent:stream. */
  lines: readonly string[];
  /** User's prompt — rendered as a bubble at the top of the run. */
  userPrompt?: string | null;
  /** Whether the run is currently streaming. Used to show a typing indicator. */
  isRunning: boolean;
  /** When set (Delegate-launched run), renders a structured plan card in
   * place of the user-prompt bubble. */
  kickoff?: KickoffPayload | null;
}

export const ChatStream = memo(function ChatStream({
  lines,
  userPrompt,
  isRunning,
  kickoff,
}: ChatStreamProps) {
  const events = useMemo(() => parseChatStream(lines), [lines]);

  const hasAny =
    events.length > 0 || (userPrompt && userPrompt.length > 0) || !!kickoff;
  if (!hasAny && !isRunning) return null;

  return (
    <div className="flex flex-col gap-2.5 py-2">
      {kickoff ? (
        <KickoffCard kickoff={kickoff} />
      ) : (
        userPrompt && <UserBubble text={userPrompt} />
      )}
      {events.map((e) => (
        <EventBlock key={e.key} event={e} />
      ))}
      {isRunning && <TypingIndicator />}
    </div>
  );
});

function EventBlock({ event }: { event: ChatEvent }) {
  switch (event.kind) {
    case 'text':
      return <AssistantText text={event.text} />;
    case 'thinking':
      return <ThinkingBlock text={event.text} />;
    case 'tool':
      return <ToolCallCard event={event} />;
    case 'result':
      return <ResultChip event={event} />;
  }
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="self-end max-w-[88%] rounded-lg bg-foreground/10 px-3 py-2 text-[12px] text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
      {text}
    </div>
  );
}

function AssistantText({ text }: { text: string }) {
  return (
    <div className="text-[12px] leading-relaxed text-foreground/90 break-words space-y-1">
      {renderBlocks(text)}
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border/40 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground/80 transition-colors"
      >
        {open ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        <Brain className="size-3 shrink-0" />
        <span className="font-medium">Thinking</span>
        {!open && (
          <span className="ml-1 truncate text-muted-foreground/60 italic font-normal">
            {firstLine(text)}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-2 pt-0.5 text-[11px] italic text-muted-foreground leading-relaxed whitespace-pre-wrap border-t border-border/40">
          {text}
        </div>
      )}
    </div>
  );
}

function ToolCallCard({
  event,
}: {
  event: Extract<ChatEvent, { kind: 'tool' }>;
}) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(event.name);
  const summary = toolCallSummary(event.name, event.input);
  const display = prettyToolName(event.name);
  const isError = event.result?.isError === true;

  return (
    <div
      className={cn(
        'rounded-md border bg-muted/20 transition-colors',
        isError ? 'border-red-500/40' : 'border-border/40',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left"
      >
        {open ? (
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground/90 shrink-0">
          {display}
        </span>
        {summary && (
          <span className="text-[11px] font-mono text-muted-foreground/80 truncate min-w-0">
            {summary}
          </span>
        )}
        <span className="ml-auto shrink-0">
          <ToolStatus pending={event.pending} isError={isError} />
        </span>
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-2 space-y-2">
          {hasInputBody(event.input, event.name) && (
            <ToolBodyBlock label="Input" body={formatToolInput(event.name, event.input)} />
          )}
          {event.result && (
            <ToolBodyBlock
              label={isError ? 'Error' : 'Result'}
              body={event.result.content}
              variant={isError ? 'error' : 'default'}
            />
          )}
          {!event.result && event.pending && (
            <div className="text-[10px] text-muted-foreground italic">Waiting for result…</div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolStatus({ pending, isError }: { pending: boolean; isError: boolean }) {
  if (pending) {
    return <Loader2Icon className="size-3 animate-spin text-muted-foreground" />;
  }
  if (isError) {
    return <CircleAlertIcon className="size-3 text-red-500" />;
  }
  return <CircleCheckIcon className="size-3 text-emerald-500/80" />;
}

function ToolBodyBlock({
  label,
  body,
  variant = 'default',
}: {
  label: string;
  body: string;
  variant?: 'default' | 'error';
}) {
  const trimmed = body.length > 4000 ? body.slice(0, 4000) + '\n…[truncated]' : body;
  return (
    <div>
      <div
        className={cn(
          'text-[10px] uppercase tracking-wider mb-1 font-medium',
          variant === 'error' ? 'text-red-500' : 'text-muted-foreground/70',
        )}
      >
        {label}
      </div>
      <pre
        className={cn(
          'text-[11px] font-mono whitespace-pre-wrap break-words rounded bg-background/60 border border-border/40 px-2 py-1.5 max-h-72 overflow-y-auto leading-relaxed',
          variant === 'error' ? 'text-red-600/90' : 'text-foreground/80',
        )}
      >
        {trimmed}
      </pre>
    </div>
  );
}

function ResultChip({
  event,
}: {
  event: Extract<ChatEvent, { kind: 'result' }>;
}) {
  // Note: `summary` is intentionally NOT rendered here. Claude's `result` event
  // duplicates the final assistant text block, so showing it again would just
  // repeat what's already in the timeline above. The chip is stats-only.
  const parts: string[] = [];
  if (event.tokensIn !== undefined) parts.push(`${event.tokensIn} in`);
  if (event.tokensOut !== undefined) parts.push(`${event.tokensOut} out`);
  if (event.durationMs !== undefined) parts.push(`${formatDuration(event.durationMs)}`);
  if (event.costUsd !== undefined) parts.push(`$${event.costUsd.toFixed(4)}`);

  return (
    <div
      className={cn(
        'mt-1 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px]',
        event.isError
          ? 'border-red-500/40 bg-red-500/5 text-red-600'
          : 'border-border/40 bg-muted/30 text-muted-foreground',
      )}
    >
      {event.isError ? (
        <CircleAlertIcon className="size-3 shrink-0" />
      ) : (
        <CircleCheckIcon className="size-3 shrink-0 text-emerald-500/80" />
      )}
      <span className="font-medium">
        {event.isError ? 'Run failed' : 'Run complete'}
      </span>
      {parts.length > 0 && (
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
          {parts.join(' · ')}
        </span>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
      <span className="inline-flex gap-1">
        <span className="size-1 rounded-full bg-current animate-pulse [animation-delay:-0.3s]" />
        <span className="size-1 rounded-full bg-current animate-pulse [animation-delay:-0.15s]" />
        <span className="size-1 rounded-full bg-current animate-pulse" />
      </span>
      <span>Thinking…</span>
    </div>
  );
}

// --- Tool icon mapping -------------------------------------------------------

type IconCmp = (props: LucideProps) => ReactElement;

function toolIcon(name: string): IconCmp {
  switch (name) {
    case 'Read':
      return FileTextIcon as unknown as IconCmp;
    case 'Edit':
    case 'MultiEdit':
      return PencilIcon as unknown as IconCmp;
    case 'Write':
    case 'NotebookEdit':
      return FileEditIcon as unknown as IconCmp;
    case 'Bash':
      return TerminalIcon as unknown as IconCmp;
    case 'Glob':
      return FileSearchIcon as unknown as IconCmp;
    case 'Grep':
      return SearchIcon as unknown as IconCmp;
    case 'WebFetch':
    case 'WebSearch':
      return GlobeIcon as unknown as IconCmp;
    case 'TodoWrite':
      return ListChecksIcon as unknown as IconCmp;
    default:
      return name.startsWith('mcp__')
        ? (PlugIcon as unknown as IconCmp)
        : (WrenchIcon as unknown as IconCmp);
  }
}

// --- Helpers -----------------------------------------------------------------

function firstLine(text: string): string {
  const idx = text.indexOf('\n');
  const first = idx === -1 ? text : text.slice(0, idx);
  return first.length > 100 ? first.slice(0, 99) + '…' : first;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function hasInputBody(input: Record<string, unknown>, _name: string): boolean {
  // Show input body when there's something useful beyond what the summary line shows.
  const keys = Object.keys(input);
  if (keys.length === 0) return false;
  // For trivial single-key tools like Glob (just a pattern), input == summary. Skip.
  if (keys.length === 1) {
    const v = input[keys[0]];
    if (typeof v === 'string' && v.length < 120) return false;
  }
  return true;
}

function formatToolInput(name: string, input: Record<string, unknown>): string {
  // For Edit/MultiEdit, show the diff-style strings prominently.
  if (name === 'Edit' || name === 'Write') {
    const lines: string[] = [];
    const fp = input['file_path'] ?? input['path'];
    if (typeof fp === 'string') lines.push(`file_path: ${fp}`);
    if (typeof input['old_string'] === 'string') {
      lines.push(`\n--- old\n${input['old_string'] as string}`);
    }
    if (typeof input['new_string'] === 'string') {
      lines.push(`\n+++ new\n${input['new_string'] as string}`);
    }
    if (typeof input['content'] === 'string') {
      lines.push(`\ncontent:\n${input['content'] as string}`);
    }
    if (lines.length > 0) return lines.join('\n');
  }
  return JSON.stringify(input, null, 2);
}

/**
 * Block-level renderer: lines starting with `#`–`######` become heading blocks;
 * runs of plain lines stay grouped together with whitespace-pre-wrap so existing
 * line breaks are preserved. Inline tokens (code, bold) inside each block are
 * delegated to `renderInline`.
 *
 * Markdown coverage is intentionally narrow — headers + the inline tokens
 * already handled. Lists, links, blockquotes, etc. fall through as plain text;
 * extend here when claude's output makes that visibly painful.
 */
function renderBlocks(text: string): ReactElement[] {
  const lines = text.split('\n');
  const out: ReactElement[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const joined = buffer.join('\n');
    out.push(
      <div key={`p-${out.length}`} className="whitespace-pre-wrap">
        {renderInline(joined)}
      </div>,
    );
    buffer = [];
  };

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (!m) {
      buffer.push(line);
      continue;
    }
    flushBuffer();
    const level = m[1].length;
    const content = m[2];
    const cls =
      level === 1
        ? 'text-[15px] font-semibold mt-2 mb-0.5'
        : level === 2
          ? 'text-[13px] font-semibold mt-1.5 mb-0.5'
          : level === 3
            ? 'text-[12px] font-semibold mt-1 mb-0.5'
            : 'text-[12px] font-medium text-foreground/85 mt-1 mb-0.5';
    out.push(
      <div key={`h-${out.length}`} className={cls}>
        {renderInline(content)}
      </div>,
    );
  }
  flushBuffer();
  return out;
}

/**
 * Tiny inline renderer: `\`code\`` → <code>, **bold** → <strong>.
 * Stays out of the way for plain text.
 */
function renderInline(text: string): ReactElement[] {
  const out: ReactElement[] = [];
  // Tokenize on backticks first, then on **bold**.
  const codeSplit = text.split(/(`[^`\n]+`)/g);
  let key = 0;
  for (const seg of codeSplit) {
    if (!seg) continue;
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
      out.push(
        <code
          key={key++}
          className="font-mono text-[11px] rounded bg-muted/60 px-1 py-0.5"
        >
          {seg.slice(1, -1)}
        </code>,
      );
    } else {
      const boldSplit = seg.split(/(\*\*[^*\n]+\*\*)/g);
      for (const piece of boldSplit) {
        if (!piece) continue;
        if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
          out.push(
            <strong key={key++} className="font-semibold">
              {piece.slice(2, -2)}
            </strong>,
          );
        } else {
          out.push(<span key={key++}>{piece}</span>);
        }
      }
    }
  }
  return out;
}

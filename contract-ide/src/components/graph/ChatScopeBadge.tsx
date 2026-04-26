/**
 * Phase 13 Plan 13 — "In agent chat context" indicator.
 *
 * Renders a small teal chat-bubble badge whenever the given uuid IS the
 * current chat scope (= useGraphStore.selectedNodeUuid). Drops into card
 * headers (ScreenCard, ServiceCard, EndpointCard) and the bottom Inspector
 * header so the user can see at a glance which surface the agent will use
 * as context when they send a message in the chat panel.
 *
 * Why distinct from the selection ring:
 *   The selection ring is react-flow's universal "this is the active node"
 *   feedback. This badge specifically says "the chat panel is grounded in
 *   this contract" — same uuid, different layer of meaning. Teal accent
 *   matches ChatPanel's send-button gradient + scope chip border so the
 *   visual link is obvious.
 *
 * Hidden when no scope is selected. Tooltip is the same on every surface so
 * users learn it once.
 */

import { MessageSquareIcon } from 'lucide-react';
import { useGraphStore } from '@/store/graph';
import { cn } from '@/lib/utils';

export interface ChatScopeBadgeProps {
  /** Contract uuid — compared against useGraphStore.selectedNodeUuid. */
  uuid: string;
  /**
   * Visual size variant. `chip` is for AtomChip overlays (smaller rect-corner
   * dot), `card` is for card headers (icon + dot), `inspector` is for the
   * bottom Inspector header (icon + label).
   */
  variant?: 'chip' | 'card' | 'inspector';
  /** Optional className to merge into the badge container. */
  className?: string;
}

const TOOLTIP =
  'In agent chat context — your next message will use this contract as scope';

export function ChatScopeBadge({
  uuid,
  variant = 'card',
  className,
}: ChatScopeBadgeProps) {
  const selectedUuid = useGraphStore((s) => s.selectedNodeUuid);
  if (selectedUuid !== uuid) return null;

  if (variant === 'chip') {
    // Tiny corner dot for atom chips — overlay rect is small, can't fit text.
    return (
      <span
        className={cn(
          'absolute -top-1 -right-1 size-2.5 rounded-full bg-teal-500 ring-2 ring-background',
          'shadow-[0_0_4px_rgba(20,184,166,0.6)]',
          className,
        )}
        title={TOOLTIP}
        aria-label={TOOLTIP}
      />
    );
  }

  if (variant === 'inspector') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide',
          'bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-500/20',
          className,
        )}
        title={TOOLTIP}
      >
        <MessageSquareIcon className="size-2.5" aria-hidden />
        chat scope
      </span>
    );
  }

  // 'card' variant — icon + dot, fits in card headers between code/name and
  // hover-only buttons.
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded text-[10px]',
        'bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-500/20',
        className,
      )}
      title={TOOLTIP}
      aria-label={TOOLTIP}
    >
      <MessageSquareIcon className="size-2.5" aria-hidden />
      <span className="font-mono uppercase tracking-wide">chat</span>
    </span>
  );
}

/**
 * Sidebar search affordance — Raycast-style ghost input that opens the
 * IntentPalette (Cmd+P) on click. Lives directly under the RepoHeader so
 * the sidebar's first interactive surface is always discoverable.
 *
 * Not a real input — clicking dispatches the `intent-palette:open` window
 * event the IntentPalette listens for. We avoid mounting a second cmdk
 * surface here; one search is the canonical search.
 */

import { SearchIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SidebarSearch() {
  function handleOpen() {
    window.dispatchEvent(new CustomEvent('intent-palette:open'));
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      aria-label="Search flows, atoms, substrate"
      className={cn(
        'group flex w-full items-center gap-2 rounded-md border border-border-subtle',
        'bg-background/40 px-2.5 py-1.5 text-left text-[12px] text-muted-foreground/80',
        'transition-colors hover:border-border hover:bg-background/70 hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
      )}
    >
      <SearchIcon
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-foreground/70"
        strokeWidth={2}
        aria-hidden
      />
      <span className="flex-1 truncate">Search flows, atoms…</span>
      <kbd
        className={cn(
          'pointer-events-none inline-flex h-4 select-none items-center gap-0.5',
          'rounded border border-border-subtle bg-muted/40 px-1 font-mono text-[10px] text-muted-foreground/70',
        )}
        aria-hidden
      >
        <span className="text-[11px] leading-none">⌘</span>
        <span>P</span>
      </kbd>
    </button>
  );
}

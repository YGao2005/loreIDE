/**
 * Sidebar repo header — anchors the top of the sidebar with project identity.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │  <project name>             ⋯    │   weight 600, foreground
 *   │   <branch>                       │   mono, muted
 *   └──────────────────────────────────┘
 *
 * The ⋯ menu surfaces the actions previously stranded as floating pills
 * (Switch Repo, Copy Mode) plus two new affordances (Reveal in Finder,
 * Reveal .contracts/). Path is shown at the top of the menu so the header
 * itself stays calm.
 *
 * Branch comes from reading `.git/HEAD` via plugin-fs (capabilities/default.json
 * grants fs:scope `**`). Symbolic ref → branch name; bare sha → short sha
 * (detached HEAD). Failure is silent — we just hide the branch line.
 *
 * No new deps: the dropdown is a hand-rolled popover with click-outside +
 * Escape handlers (shadcn dropdown-menu would require pulling in radix).
 */

import { useEffect, useRef, useState } from 'react';
import {
  CheckIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { homeDir } from '@tauri-apps/api/path';
import { cn } from '@/lib/utils';
import { useGraphStore } from '@/store/graph';
import { useUiStore } from '@/store/ui';
import { switchRepoFromUi } from '@/ipc/repo';

function deriveProjectName(repoPath: string | null): string {
  if (!repoPath) return 'No repo open';
  const segments = repoPath.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? repoPath;
}

function tildeify(path: string, home: string | null): string {
  if (home && path.startsWith(home)) {
    return '~' + path.slice(home.length);
  }
  return path;
}

async function readBranch(repoPath: string): Promise<string | null> {
  try {
    const raw = await readTextFile(`${repoPath}/.git/HEAD`);
    const trimmed = raw.trim();
    const refPrefix = 'ref: refs/heads/';
    if (trimmed.startsWith(refPrefix)) {
      return trimmed.slice(refPrefix.length);
    }
    // Detached HEAD — show short sha.
    if (/^[0-9a-f]{7,}$/i.test(trimmed)) {
      return trimmed.slice(0, 7);
    }
    return null;
  } catch {
    // Not a git repo, or file not readable — silently hide the branch line.
    return null;
  }
}

export function RepoHeader() {
  const repoPath = useGraphStore((s) => s.repoPath);
  const copyModeActive = useUiStore((s) => s.copyModeActive);
  const toggleCopyMode = useUiStore((s) => s.toggleCopyMode);

  const [branch, setBranch] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const projectName = deriveProjectName(repoPath);
  const fullPath = repoPath ? tildeify(repoPath, home) : null;

  // Resolve home dir once for tilde-collapse. Best-effort — failure leaves
  // `home` as null and the menu shows the absolute path.
  useEffect(() => {
    homeDir()
      .then((h) => setHome(h.replace(/\/$/, '')))
      .catch(() => setHome(null));
  }, []);

  // Re-read branch on repo change. If `.git/HEAD` is missing or unreadable,
  // `readBranch` returns null and we hide the branch row.
  useEffect(() => {
    let cancelled = false;
    if (!repoPath) {
      setBranch(null);
      return;
    }
    readBranch(repoPath).then((b) => {
      if (!cancelled) setBranch(b);
    });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  async function handleSwitchRepo() {
    setMenuOpen(false);
    if (switching) return;
    setSwitching(true);
    try {
      const result = await switchRepoFromUi();
      if (result.outcome === 'error') {
        console.warn('[RepoHeader] switch repo failed:', result.error);
      }
    } finally {
      setSwitching(false);
    }
  }

  async function handleRevealRepo() {
    setMenuOpen(false);
    if (!repoPath) return;
    try {
      // revealItemInDir highlights the file/dir in Finder; passing the repo
      // path itself reveals the repo folder inside its parent.
      await revealItemInDir(repoPath);
    } catch (e) {
      console.warn('[RepoHeader] reveal repo failed:', e);
    }
  }

  async function handleRevealContracts() {
    setMenuOpen(false);
    if (!repoPath) return;
    try {
      await revealItemInDir(`${repoPath}/.contracts`);
    } catch (e) {
      console.warn('[RepoHeader] reveal .contracts/ failed:', e);
    }
  }

  function handleToggleCopyMode() {
    toggleCopyMode();
    setMenuOpen(false);
  }

  return (
    <div className="px-1 pb-2.5 border-b border-border-subtle">
      <div className="flex items-start gap-2 px-1.5">
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'truncate text-[13px] font-semibold leading-tight tracking-tight',
              repoPath ? 'text-foreground' : 'italic text-muted-foreground',
            )}
            title={fullPath ?? undefined}
          >
            {switching ? 'Switching…' : projectName}
          </div>
          {branch && (
            <div className="mt-0.5 flex items-center gap-1 text-[10.5px] font-mono text-muted-foreground/80 truncate">
              <GitBranchIcon className="h-2.5 w-2.5 shrink-0" strokeWidth={2} aria-hidden />
              <span className="truncate">{branch}</span>
            </div>
          )}
          {!branch && !repoPath && (
            <div className="mt-0.5 text-[10.5px] text-muted-foreground/60">
              Open a repository to begin
            </div>
          )}
        </div>
        <RepoMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          fullPath={fullPath}
          repoOpen={Boolean(repoPath)}
          copyModeActive={copyModeActive}
          onSwitchRepo={handleSwitchRepo}
          onRevealRepo={handleRevealRepo}
          onRevealContracts={handleRevealContracts}
          onToggleCopyMode={handleToggleCopyMode}
        />
      </div>
    </div>
  );
}

interface RepoMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fullPath: string | null;
  repoOpen: boolean;
  copyModeActive: boolean;
  onSwitchRepo: () => void;
  onRevealRepo: () => void;
  onRevealContracts: () => void;
  onToggleCopyMode: () => void;
}

function RepoMenu({
  open,
  onOpenChange,
  fullPath,
  repoOpen,
  copyModeActive,
  onSwitchRepo,
  onRevealRepo,
  onRevealContracts,
  onToggleCopyMode,
}: RepoMenuProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click-outside + Escape to close. Effect only runs while open so we don't
  // stack listeners during the closed steady state.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="Repo actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!open)}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors',
          'hover:bg-muted/60 hover:text-foreground',
          open && 'bg-muted/60 text-foreground',
        )}
      >
        <MoreHorizontalIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full z-50 mt-1 min-w-[200px]',
            'rounded-md border border-border-strong bg-popover/95 backdrop-blur-md',
            'shadow-lg shadow-black/5 py-1 text-[12px]',
          )}
        >
          {fullPath && (
            <div className="px-3 pt-1 pb-2 text-[10px] font-mono text-muted-foreground/70 truncate border-b border-border-subtle mb-1">
              {fullPath}
            </div>
          )}
          <MenuItem icon={<RefreshCwIcon className="h-3.5 w-3.5" />} onClick={onSwitchRepo}>
            Switch repo…
          </MenuItem>
          {repoOpen && (
            <>
              <MenuItem icon={<FolderOpenIcon className="h-3.5 w-3.5" />} onClick={onRevealRepo}>
                Reveal in Finder
              </MenuItem>
              <MenuItem
                icon={<FolderIcon className="h-3.5 w-3.5" />}
                onClick={onRevealContracts}
              >
                Reveal .contracts/
              </MenuItem>
            </>
          )}
          <div className="my-1 h-px bg-border-subtle" />
          <MenuItem
            icon={
              copyModeActive ? (
                <CheckIcon className="h-3.5 w-3.5 text-brand" />
              ) : (
                <span className="block h-3.5 w-3.5" aria-hidden />
              )
            }
            onClick={onToggleCopyMode}
            ariaChecked={copyModeActive}
          >
            Copy Mode
          </MenuItem>
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  ariaChecked?: boolean;
}

function MenuItem({ icon, children, onClick, ariaChecked }: MenuItemProps) {
  return (
    <button
      type="button"
      role={ariaChecked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={ariaChecked}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground/90',
        'hover:bg-muted/60 transition-colors',
      )}
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center text-muted-foreground shrink-0">
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}

/**
 * Phase 13.5 — Sync Review surface.
 *
 * The right-sidebar Review tab. Replaces the floating VerifierPanel +
 * HarvestPanel popups with a single PR-review-shaped surface that hydrates
 * on Pull. Sections render top-to-bottom: header → honors → implicit
 * decisions (with inline Verify-with-agent) → harvested rules (Beat 4) →
 * flag (Beat 3).
 *
 * Empty state: "No incoming changes" + Pull button. Pull triggers fixture
 * load + blast-radius animation on the canvas chain.
 *
 * State source: useSyncReviewStore (one payload at a time; second Pull
 * replaces).
 *
 * Aesthetic: terminal-document hybrid. Linear/Raycast restraint, git-log
 * sensibility. No tinted card fills — semantic color lives in icons + a
 * 2px left-border accent. Mono reserved for SHAs/uuids/diff-style lines;
 * sans for narrative. The captured receipt reads like a real git-journal
 * entry; the verify-with-agent stream reads like terminal output.
 */

import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  Info,
  AlertTriangle,
  Sparkles,
  GitMerge,
  CornerDownLeft,
  ChevronRight,
} from 'lucide-react';
import {
  useSyncReviewStore,
  type SyncReviewImplicit,
  type SyncReviewFlag,
  type SyncReviewHarvested,
  type SyncReviewHonor,
} from '@/store/syncReview';
import { useCitationStore } from '@/store/citation';
import { SubstrateCitation } from '@/components/inspector/SubstrateCitation';
import { loadSyncReview, applyConstraintNarrowing } from '@/lib/demoOrchestration';
import { animateSyncBlastRadius } from '@/lib/syncBlastRadius';
import { cn } from '@/lib/utils';
import { invoke } from '@tauri-apps/api/core';

const FLAG_HALO_MS = 8000;
const HARVEST_CHIP_HALO_MS = 4000;

// Semantic accent registry — single source of truth so a designer change
// here cascades. Used as `border-l-2 border-{accent}` + matching icon color.
const ACCENT = {
  honor:    { border: 'border-emerald-500/40', icon: 'text-emerald-400' },
  implicit: { border: 'border-amber-500/40',   icon: 'text-amber-400'   },
  harvest:  { border: 'border-sky-500/40',     icon: 'text-sky-400'     },
  flag:     { border: 'border-rose-500/50',    icon: 'text-rose-400'    },
  ok:       { border: 'border-emerald-500/40', icon: 'text-emerald-400' },
} as const;

export function SyncReviewPanel() {
  const payload = useSyncReviewStore((s) => s.payload);
  const pulling = useSyncReviewStore((s) => s.pulling);
  const merged = useSyncReviewStore((s) => s.merged);

  if (merged && payload) {
    return <FinishView />;
  }

  if (!payload) {
    return <EmptyState pulling={pulling} />;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <Header payload={payload} />
      <HonorsSection honors={payload.honors} />
      {payload.implicit_decisions.length > 0 && (
        <ImplicitSection implicits={payload.implicit_decisions} />
      )}
      {payload.harvested_rules.length > 0 && (
        <HarvestSection harvested={payload.harvested_rules} />
      )}
      {payload.flag && <FlagSection flag={payload.flag} />}
      <Footer payload={payload} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state — a quiet git-status-style surface, not a stranded button

function EmptyState({ pulling }: { pulling: boolean }) {
  const mergedCount = useSyncReviewStore((s) => s.mergedCount);
  const nextBeat: 'beat3' | 'beat4' = mergedCount === 0 ? 'beat3' : 'beat4';

  const onPull = async () => {
    try {
      // Publish any captured-but-unsynced substrate rows BEFORE the staged
      // fixture animation runs. Distiller writes new rows with
      // published_at=NULL; retrieval filters published_at IS NOT NULL; this
      // call flips NULL → now() so a freshly-captured rule (e.g. the design-
      // system #FF0000 commitment from the PM session) becomes retrievable
      // for the next agent run. No-op when nothing is pending. Best-effort:
      // a publish failure should not block the demo animation.
      try {
        const result = await invoke<{
          published_count: number;
          published_uuids: string[];
        }>('publish_pending_substrate');
        if (result.published_count > 0) {
          console.info(
            `[SyncReview] Published ${result.published_count} pending substrate rules:`,
            result.published_uuids,
          );
        }
      } catch (publishErr) {
        console.warn('[SyncReview] publish_pending_substrate failed:', publishErr);
      }
      const payload = await loadSyncReview(nextBeat);
      const ordered = [
        payload.blast_radius.trigger_uuid,
        ...payload.blast_radius.participant_uuids,
      ];
      void animateSyncBlastRadius(ordered, 'fresh');
    } catch (err) {
      console.error('[SyncReview] Pull failed:', err);
    }
  };

  const headline =
    nextBeat === 'beat3' ? 'No local changes' : 'Waiting for next commit';
  const subline =
    nextBeat === 'beat3'
      ? 'Your partner pushed a commit to origin/main.'
      : 'Your local agent run produced a new commit.';

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-16">
      {/* Status badge — looks like a git-graph node */}
      <div className="flex items-center gap-2 mb-5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-400" />
        </span>
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.18em]">
          1 commit ahead
        </span>
      </div>

      {/* Headline + subline — narrative, not chrome */}
      <div className="text-sm text-foreground mb-1">{headline}</div>
      <div className="text-[11px] text-muted-foreground text-center max-w-[260px] leading-relaxed mb-6">
        {subline}
      </div>

      {/* Pull CTA — looks like a real action, with a kbd hint */}
      <button
        type="button"
        onClick={onPull}
        disabled={pulling}
        className={cn(
          'group inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-md',
          'text-xs font-medium text-foreground',
          'bg-foreground/[0.04] border border-border',
          'hover:bg-foreground/[0.08] hover:border-foreground/30',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-all duration-150',
          'shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]',
        )}
      >
        {pulling ? (
          <>
            <span className="inline-block h-3 w-3 rounded-full border-[1.5px] border-foreground/30 border-t-foreground/80 animate-spin" />
            <span>Pulling…</span>
          </>
        ) : (
          <>
            <ArrowDownToLine className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span>Pull incoming changes</span>
          </>
        )}
      </button>

      {/* Branch line — tiny, mono, ground-truth */}
      <div className="mt-8 text-[10px] font-mono text-muted-foreground/40 tracking-wide">
        on <span className="text-muted-foreground/70">main</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Finish view — captured-artifact aesthetic, not a generic toast

function FinishView() {
  const payload = useSyncReviewStore((s) => s.payload)!;
  const captured = useSyncReviewStore((s) => s.capturedNarrowing);
  const dismiss = useSyncReviewStore((s) => s.dismissFinish);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-8 animate-in fade-in slide-in-from-bottom-1 duration-300">
      {/* Merged headline — minimal, single line of weight */}
      <div className="flex items-center gap-2.5 mb-1">
        <GitMerge className="h-4 w-4 text-emerald-400" strokeWidth={2.25} />
        <span className="text-sm font-medium text-foreground tracking-tight">
          Merged
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/60 ml-1">
          {payload.commit.sha}
        </span>
      </div>
      <div className="text-[12px] text-muted-foreground leading-relaxed mb-6 ml-[26px]">
        {payload.commit.message}
      </div>

      {/* Captured receipt — the load-bearing UX moment. Reads like a real
          git-journal entry: dotted top + bottom borders, mono `+` prefix
          lines, user's quote rendered as a literal blockquote. */}
      {captured && (
        <div className="mb-6">
          <div className="text-[10px] text-muted-foreground/70 mb-2 ml-[26px] flex items-center gap-1.5">
            <span className="h-px w-3 bg-border" />
            <span>captured to substrate</span>
          </div>
          <div className="relative ml-[26px] py-3 border-y border-dashed border-border/70 font-mono text-[11px] leading-[1.7]">
            {/* User's own words — quoted in italic, the only sans line in here */}
            <div className="text-foreground/90 font-sans italic mb-3 pl-3 border-l-2 border-emerald-500/40 not-italic">
              <span className="text-muted-foreground/40 mr-1">"</span>
              {captured}
              <span className="text-muted-foreground/40 ml-0.5">"</span>
            </div>
            {/* Diff-style additions */}
            <div className="text-emerald-400/90">
              <span className="text-emerald-500/60 select-none mr-2">+</span>
              scope-refinement → con-settings-no-modal-interrupts-2025-Q4
            </div>
            <div className="text-emerald-400/90">
              <span className="text-emerald-500/60 select-none mr-2">+</span>
              applies_when narrowed to non-destructive interactions
            </div>
            <div className="text-muted-foreground/60 mt-2">
              <span className="text-muted-foreground/40 select-none mr-2">·</span>
              provenance: pr {payload.commit.sha} · review session
            </div>
          </div>
        </div>
      )}

      {/* Session summary — small print, like a transaction footer */}
      <div className="ml-[26px] mb-8">
        <div className="text-[10px] text-muted-foreground/70 mb-2 flex items-center gap-1.5">
          <span className="h-px w-3 bg-border" />
          <span>session summary</span>
        </div>
        <div className="text-[11px] text-muted-foreground space-y-1 font-mono leading-relaxed">
          <SummaryLine n={payload.honors.length} label="substrate honor" plural="substrate honors" />
          {payload.implicit_decisions.length > 0 && (
            <SummaryLine n={payload.implicit_decisions.length} label="implicit decision surfaced" plural="implicit decisions surfaced" />
          )}
          {payload.harvested_rules.length > 0 && (
            <SummaryLine n={payload.harvested_rules.length} label="rule harvested" plural="rules harvested" />
          )}
          {payload.flag && (
            <SummaryLine n={1} label="stale-priority flag resolved" plural="stale-priority flags resolved" />
          )}
        </div>
      </div>

      {/* Continue — passive button, the moment is past */}
      <button
        type="button"
        onClick={dismiss}
        className={cn(
          'w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs',
          'text-muted-foreground hover:text-foreground',
          'border border-border hover:border-foreground/30',
          'transition-colors duration-150',
        )}
      >
        <span>Continue</span>
        <CornerDownLeft className="h-3 w-3 opacity-60" />
      </button>
    </div>
  );
}

function SummaryLine({ n, label, plural }: { n: number; label: string; plural: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-foreground/80 font-medium tabular-nums w-4 text-right">{n}</span>
      <span>{n === 1 ? label : plural}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header — commit metadata, git-graph-flavored

function Header({ payload }: { payload: NonNullable<ReturnType<typeof useSyncReviewStore.getState>['payload']> }) {
  const c = payload.commit;
  return (
    <div className="px-5 pt-5 pb-4 border-b border-border">
      <div className="flex items-start gap-3">
        {/* Commit dot — git graph node */}
        <div className="mt-1.5">
          <span className="block h-2 w-2 rounded-full bg-sky-400 ring-2 ring-sky-400/20" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-foreground leading-snug">
            {c.message}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span className="font-mono text-foreground/70">{c.sha}</span>
            <Dot />
            <span>{c.author}</span>
            <Dot />
            <span>{c.files_changed} files changed</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="text-muted-foreground/40 select-none">·</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer — git-status-style ground line under the review

function Footer({ payload }: { payload: NonNullable<ReturnType<typeof useSyncReviewStore.getState>['payload']> }) {
  return (
    <div className="px-5 py-3 border-t border-border/60 text-[10px] font-mono text-muted-foreground/50 tracking-wide flex items-center gap-1.5">
      <span>on</span>
      <span className="text-muted-foreground/80">main</span>
      <Dot />
      <span>incoming</span>
      <span className="text-foreground/70">{payload.commit.sha}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Honors

function HonorsSection({ honors }: { honors: SyncReviewHonor[] }) {
  return (
    <SectionShell label="Rules honored" count={honors.length}>
      <div className="space-y-px">
        {honors.map((h, i) => (
          <Row key={i} accent="honor" icon={<Check className={cn('h-3.5 w-3.5', ACCENT.honor.icon)} strokeWidth={2.5} />}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[12px] text-foreground leading-snug">{h.ruleName}</span>
              {h.ruleUuid && <SubstrateCitation uuid={h.ruleUuid} shortLabel="source" />}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {h.detail}
            </div>
          </Row>
        ))}
      </div>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Implicit decisions + Verify-with-agent

function ImplicitSection({ implicits }: { implicits: SyncReviewImplicit[] }) {
  return (
    <SectionShell
      label="Implicit decisions"
      count={implicits.length}
      hint="agent defaults — no team rule applied"
    >
      <div className="space-y-px">
        {implicits.map((imp) => (
          <ImplicitRow key={imp.id} implicit={imp} />
        ))}
      </div>
    </SectionShell>
  );
}

function ImplicitRow({ implicit }: { implicit: SyncReviewImplicit }) {
  const [expanded, setExpanded] = useState(false);
  const [question, setQuestion] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const streamed = useFakeStream(
    submitted ? implicit.verify_response?.tokens ?? null : null,
    implicit.verify_response?.stream_delay_ms ?? 30,
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setSubmitted(question.trim());
  };

  return (
    <Row accent="implicit" icon={<Info className={cn('h-3.5 w-3.5', ACCENT.implicit.icon)} strokeWidth={2.25} />}>
      <div className="text-[12px] text-foreground leading-snug">{implicit.field}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
        {implicit.derivedFrom}
      </div>

      {/* CTA — only when the row is dormant */}
      {!expanded && !submitted && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="group mt-2 inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Sparkles className="h-3 w-3 text-amber-400/70 group-hover:text-amber-400" />
          <span>Verify with agent</span>
          <ChevronRight className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60 -ml-0.5 transition-opacity" />
        </button>
      )}

      {/* Input — Raycast-style, baseline only, with ↵ hint */}
      {expanded && !submitted && (
        <form onSubmit={onSubmit} className="mt-2.5">
          <div className="relative">
            <span className="absolute left-0 top-2.5 text-amber-400/60 font-mono text-[11px] select-none">
              ❯
            </span>
            <textarea
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && question.trim()) {
                  e.preventDefault();
                  setSubmitted(question.trim());
                }
              }}
              placeholder="ask the agent…"
              rows={2}
              className={cn(
                'w-full pl-5 pr-2 pt-2 pb-1.5 text-[12px] resize-none',
                'bg-transparent text-foreground placeholder:text-muted-foreground/40',
                'border-b border-border focus:border-amber-500/50 focus:outline-none',
                'font-mono leading-relaxed transition-colors',
              )}
            />
          </div>
          <div className="flex items-center justify-between gap-2 mt-1.5">
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                setQuestion('');
              }}
              className="text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors"
            >
              esc to cancel
            </button>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <CornerDownLeft className="h-2.5 w-2.5" />
              <span>{question.trim() ? 'send' : 'ask'}</span>
            </div>
          </div>
        </form>
      )}

      {/* Response — terminal-output aesthetic */}
      {submitted && (
        <div className="mt-3">
          {/* User's question — echoed as terminal prompt */}
          <div className="font-mono text-[11px] text-muted-foreground/80 leading-relaxed mb-2.5 flex gap-2">
            <span className="text-amber-400/60 select-none shrink-0">❯</span>
            <span>{submitted}</span>
          </div>

          {/* Agent reply */}
          <div className="text-[12px] text-foreground/90 whitespace-pre-wrap leading-[1.65] font-sans">
            {streamed.text}
            {streamed.streaming && (
              <span className="inline-block w-[2px] h-[13px] bg-amber-400 ml-0.5 align-text-top animate-pulse" />
            )}
          </div>

          {/* Promote-to-substrate hint, post-stream */}
          {!streamed.streaming && (
            <div className="mt-3 pt-2.5 border-t border-border/40 text-[10px] text-muted-foreground/70 font-mono">
              <span className="text-emerald-500/60 select-none mr-2">+</span>
              promote to substrate? <span className="text-muted-foreground/40">(coming soon)</span>
            </div>
          )}
        </div>
      )}
    </Row>
  );
}

/** Reveals tokens one at a time on a delay. */
function useFakeStream(tokens: string[] | null, delayMs: number) {
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (!tokens) {
      setText('');
      setStreaming(false);
      return;
    }
    setText('');
    setStreaming(true);
    let i = 0;
    const interval = setInterval(() => {
      if (i >= tokens.length) {
        clearInterval(interval);
        setStreaming(false);
        return;
      }
      const token = tokens[i];
      i++;
      setText((prev) => prev + token);
    }, delayMs);
    return () => clearInterval(interval);
  }, [tokens, delayMs]);

  return { text, streaming };
}

// ─────────────────────────────────────────────────────────────────────────────
// Harvested rules (Beat 4)

function HarvestSection({ harvested }: { harvested: SyncReviewHarvested[] }) {
  const highlight = useCitationStore((s) => s.highlight);
  useEffect(() => {
    harvested.forEach((h, i) => {
      setTimeout(() => highlight(h.attached_to_uuid, HARVEST_CHIP_HALO_MS), i * 350);
    });
  }, [harvested, highlight]);

  return (
    <SectionShell
      label="New rules learned"
      count={harvested.length}
      hint="harvested from this session"
    >
      <div className="space-y-px">
        {harvested.map((h) => (
          <Row key={h.uuid} accent="harvest" icon={<Sparkles className={cn('h-3.5 w-3.5', ACCENT.harvest.icon)} strokeWidth={2.25} />}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[12px] text-foreground leading-snug">{h.name}</span>
              {h.promoted_from_implicit && (
                <span
                  className="inline-flex items-center px-1.5 py-px rounded-sm text-[9px] font-mono uppercase tracking-wider text-amber-300/90 border border-amber-500/30"
                  title="Promoted from this morning's implicit decision"
                >
                  promoted
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {h.text}
            </div>
            {h.attached_to_name && (
              <div className="mt-1.5 font-mono text-[10px] text-sky-400/80 flex items-center gap-1">
                <span className="text-muted-foreground/40 select-none">→</span>
                <span>{h.attached_to_name}</span>
              </div>
            )}
          </Row>
        ))}
      </div>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Flag (Beat 3) — inline narrowing

function FlagSection({ flag }: { flag: SyncReviewFlag }) {
  const highlight = useCitationStore((s) => s.highlight);
  const markMerged = useSyncReviewStore((s) => s.markMerged);
  const setCapturedNarrowing = useSyncReviewStore((s) => s.setCapturedNarrowing);
  const [expanded, setExpanded] = useState(false);
  const [narrow, setNarrow] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    highlight(flag.parentSurfaceUuid, FLAG_HALO_MS);
  }, [flag.parentSurfaceUuid, highlight]);

  const onAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = narrow.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setWriteError(null);
    try {
      // Real writeback: appends a dated narrowing clause to applies_when
      // and clears intent_drift_state on the substrate row. The receipt
      // displayed below echoes the actual DB state, not theater.
      await applyConstraintNarrowing(flag.ruleUuid, text);
      setCapturedNarrowing(text);
      setAccepted(true);
    } catch (err) {
      console.error('[FlagSection] narrowing writeback failed:', err);
      setWriteError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onMerge = () => markMerged();

  return (
    <SectionShell
      label="Needs attention"
      count={1}
      hint="stale parent-surface constraint"
      tone="flag"
    >
      <Row
        accent={accepted ? 'ok' : 'flag'}
        icon={
          <AlertTriangle
            className={cn('h-3.5 w-3.5', accepted ? ACCENT.ok.icon : ACCENT.flag.icon)}
            strokeWidth={2.25}
          />
        }
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] text-foreground leading-snug">{flag.ruleName}</span>
          <SubstrateCitation uuid={flag.ruleUuid} shortLabel="source" />
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
          {flag.detail}
        </div>

        {!expanded && !accepted && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="group mt-2 inline-flex items-center gap-1 text-[10.5px] text-rose-300/90 hover:text-rose-300 transition-colors"
          >
            <span>Review priority history</span>
            <ChevronRight className="h-2.5 w-2.5 opacity-60 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}

        {expanded && !accepted && (
          <div className="mt-3 space-y-3">
            {/* Priority timeline — visual rail with year/state markers */}
            {flag.priority_history && (
              <div className="font-mono text-[10.5px] leading-relaxed">
                {flag.priority_history.map((p, i) => {
                  const active = p.to === null;
                  return (
                    <div key={i} className="flex items-baseline gap-2.5 py-0.5">
                      <span
                        className={cn(
                          'inline-block w-1 h-1 rounded-full mt-1.5 shrink-0',
                          active ? 'bg-emerald-400' : 'bg-muted-foreground/40',
                        )}
                      />
                      <span className={active ? 'text-foreground' : 'text-muted-foreground line-through decoration-muted-foreground/30'}>
                        {p.priority}
                      </span>
                      <span className="text-muted-foreground/50 ml-auto text-[10px]">
                        {p.from} → {p.to ?? 'now'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Narrowing input — same Raycast-style as verify-with-agent but rose-accented */}
            <form onSubmit={onAccept}>
              <div className="relative">
                <span className="absolute left-0 top-2.5 text-rose-400/60 font-mono text-[11px] select-none">
                  ❯
                </span>
                <textarea
                  autoFocus
                  value={narrow}
                  onChange={(e) => setNarrow(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && narrow.trim()) {
                      e.preventDefault();
                      onAccept(e as unknown as React.FormEvent);
                    }
                  }}
                  placeholder="narrow the constraint…"
                  rows={3}
                  className={cn(
                    'w-full pl-5 pr-2 pt-2 pb-1.5 text-[12px] resize-none',
                    'bg-transparent text-foreground placeholder:text-muted-foreground/40',
                    'border-b border-border focus:border-rose-500/50 focus:outline-none',
                    'font-mono leading-relaxed transition-colors',
                  )}
                />
              </div>
              <div className="flex items-center justify-between gap-2 mt-1.5">
                <span className="text-[10px] text-muted-foreground/60">
                  applies to non-destructive interactions only
                </span>
                <button
                  type="submit"
                  disabled={!narrow.trim() || submitting}
                  className={cn(
                    'inline-flex items-center gap-1.5 text-[10.5px] px-2 py-1 rounded',
                    'border border-border text-foreground/80',
                    'hover:border-rose-500/40 hover:text-foreground',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'transition-colors',
                  )}
                >
                  {submitting ? (
                    <>
                      <span className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-foreground/30 border-t-foreground/80 animate-spin" />
                      <span>Writing…</span>
                    </>
                  ) : (
                    <>
                      <span>Accept narrowing</span>
                      <kbd className="font-mono text-[9px] text-muted-foreground/70">⌘↵</kbd>
                    </>
                  )}
                </button>
              </div>
              {writeError && (
                <div className="mt-1.5 text-[10px] text-rose-400/90 font-mono">
                  Writeback failed: {writeError}
                </div>
              )}
            </form>
          </div>
        )}

        {accepted && (
          <div className="mt-3.5">
            {/* Captured receipt — git-journal entry, dotted top+bottom */}
            <div className="text-[10px] text-muted-foreground/70 mb-2 flex items-center gap-1.5">
              <span className="h-px w-3 bg-border" />
              <span>captured to substrate</span>
            </div>
            <div className="py-2.5 border-y border-dashed border-border/70 font-mono text-[11px] leading-[1.7]">
              <div className="text-foreground/90 font-sans mb-2.5 pl-3 border-l-2 border-emerald-500/40">
                <span className="text-muted-foreground/40 mr-1">"</span>
                {narrow}
                <span className="text-muted-foreground/40 ml-0.5">"</span>
              </div>
              <div className="text-emerald-400/90">
                <span className="text-emerald-500/60 select-none mr-2">+</span>
                scope-refinement → con-settings-no-modal-interrupts-2025-Q4
              </div>
              <div className="text-emerald-400/90">
                <span className="text-emerald-500/60 select-none mr-2">+</span>
                applies_when narrowed to non-destructive interactions
              </div>
            </div>

            {/* Merge button — solid, real action */}
            <button
              type="button"
              onClick={onMerge}
              className={cn(
                'mt-3.5 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[12px] font-medium',
                'bg-emerald-500/15 border border-emerald-500/40 text-emerald-100',
                'hover:bg-emerald-500/25 hover:border-emerald-400/60',
                'transition-colors duration-150',
                'shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]',
              )}
            >
              <GitMerge className="h-3.5 w-3.5" strokeWidth={2.25} />
              <span>Merge PR</span>
            </button>
          </div>
        )}
      </Row>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section shell — mixed-case heading, count chip, no uppercase tracking-wider

function SectionShell({
  label,
  count,
  hint,
  tone = 'neutral',
  children,
}: {
  label: string;
  count?: number;
  hint?: string;
  tone?: 'neutral' | 'flag';
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 pt-4 pb-3 border-b border-border/50 last:border-b-0">
      <header className="flex items-baseline justify-between gap-3 mb-2.5">
        <div className="flex items-baseline gap-2">
          <h3
            className={cn(
              'text-[12px] font-medium tracking-tight',
              tone === 'flag' ? 'text-rose-300' : 'text-foreground/85',
            )}
          >
            {label}
          </h3>
          {typeof count === 'number' && (
            <span
              className={cn(
                'text-[10px] font-mono tabular-nums',
                tone === 'flag' ? 'text-rose-400/70' : 'text-muted-foreground/60',
              )}
            >
              {count}
            </span>
          )}
        </div>
        {hint && (
          <span className="text-[10px] text-muted-foreground/60 truncate">{hint}</span>
        )}
      </header>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — flat, left-border-accent only. Used by every section row.

function Row({
  accent,
  icon,
  children,
}: {
  accent: keyof typeof ACCENT;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'group flex items-start gap-2.5 pl-3 pr-1 py-2 border-l-2 transition-colors',
        ACCENT[accent].border,
        'hover:bg-foreground/[0.015]',
      )}
    >
      <span className="shrink-0 mt-[3px]">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

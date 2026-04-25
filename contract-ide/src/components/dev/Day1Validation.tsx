import { Suspense, lazy, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  testClaudeSpawn,
  testHookPayloadFixture,
  testPkgSqliteBinary,
  type SpawnResult,
} from '@/ipc/validation';

/**
 * Day-1 Integration Validation panel (Plan 01-04).
 *
 * Dev-only — mounted only when `import.meta.env.DEV` is true. Exposes the
 * three ROADMAP Phase 1 success-criterion-6 checks as buttons, plus a 4th
 * human-observed Monaco worker check. Each row captures stdout/stderr.
 *
 * Check B hard-fails when the referenced JSONL transcript is absent or
 * lacks `input_tokens` — the Rust command returns Err, the row shows ✗.
 */

type Status = 'idle' | 'loading' | 'pass' | 'fail';

interface CheckRowState {
  status: Status;
  message?: string;
  details?: ReactNode;
}

const INITIAL: CheckRowState = { status: 'idle' };

function StatusIcon({ status }: { status: Status }) {
  switch (status) {
    case 'loading':
      return <span className="text-muted-foreground animate-pulse">●</span>;
    case 'pass':
      return <span className="text-green-500 font-bold">✓</span>;
    case 'fail':
      return <span className="text-red-500 font-bold">✗</span>;
    case 'idle':
    default:
      return <span className="text-muted-foreground/40">○</span>;
  }
}

interface CheckRowProps {
  label: string;
  description: string;
  state: CheckRowState;
  onRun: () => void;
  runLabel?: string;
}

function CheckRow({ label, description, state, onRun, runLabel = 'Run' }: CheckRowProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col gap-1 border border-border/40 rounded-md px-3 py-2 bg-background/60">
      <div className="flex items-center gap-3">
        <div className="w-4 text-center text-sm">
          <StatusIcon status={state.status} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{label}</div>
          <div className="text-xs text-muted-foreground truncate">{description}</div>
        </div>
        <Button
          size="xs"
          variant="outline"
          onClick={onRun}
          disabled={state.status === 'loading'}
        >
          {state.status === 'loading' ? 'Running…' : runLabel}
        </Button>
      </div>
      {state.message ? (
        <div
          className={cn(
            'text-xs px-5',
            state.status === 'fail' ? 'text-red-500' : 'text-muted-foreground',
          )}
        >
          {state.message}
        </div>
      ) : null}
      {state.details ? (
        <div className="px-5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] uppercase tracking-wider text-muted-foreground/70 hover:text-foreground"
          >
            {expanded ? 'hide output' : 'show output'}
          </button>
          {expanded ? (
            <pre className="mt-1 max-h-56 overflow-auto text-[11px] leading-snug whitespace-pre-wrap bg-muted/40 rounded p-2 font-mono">
              {state.details}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function spawnResultSummary(result: SpawnResult): string {
  return `exit_code=${result.exit_code ?? 'null'}\n\n--- stdout ---\n${result.stdout || '(empty)'}\n\n--- stderr ---\n${result.stderr || '(empty)'}`;
}

// Lazy-load Monaco only when Check D runs — keeps the main bundle small and
// defers the worker-creation moment to an explicit user action so the Tauri
// dev console's "Could not create web worker" error (if any) is unambiguously
// tied to this click.
const MonacoEditor = lazy(async () => {
  const mod = await import('@monaco-editor/react');
  return { default: mod.default };
});

export function Day1Validation() {
  const [checkA, setCheckA] = useState<CheckRowState>(INITIAL);
  const [checkB, setCheckB] = useState<CheckRowState>(INITIAL);
  const [checkC, setCheckC] = useState<CheckRowState>(INITIAL);
  const [monacoMounted, setMonacoMounted] = useState(false);

  const runCheckA = async () => {
    setCheckA({ status: 'loading', message: 'invoking test_claude_spawn…' });
    try {
      const result = await testClaudeSpawn();
      const ok = result.success && result.stdout.trim().length > 0;
      setCheckA({
        status: ok ? 'pass' : 'fail',
        message: ok
          ? `subprocess returned ${result.stdout.trim().length} chars on stdout`
          : `subprocess ${result.success ? 'succeeded but stdout was empty' : 'failed'} — see output`,
        details: spawnResultSummary(result),
      });
    } catch (err) {
      setCheckA({
        status: 'fail',
        message: `invoke error: ${String(err)}`,
        details: String(err),
      });
    }
  };

  const runCheckB = async () => {
    setCheckB({ status: 'loading', message: 'reading fixture + searching ~/.claude/projects…' });
    try {
      const payload = await testHookPayloadFixture();
      const resolved = payload['_resolved_transcript_path'];
      setCheckB({
        status: 'pass',
        message:
          typeof resolved === 'string'
            ? `JSONL with input_tokens: ${resolved}`
            : 'fixture shape valid and JSONL resolved',
        details: JSON.stringify(payload, null, 2),
      });
    } catch (err) {
      // The Rust side rejects with "Check B FAIL: ..." on missing JSONL /
      // missing input_tokens — this is the hard-fail path by design.
      setCheckB({
        status: 'fail',
        message: String(err),
        details: String(err),
      });
    }
  };

  const runCheckC = async () => {
    setCheckC({ status: 'loading', message: 'running day0-sqlite binary…' });
    try {
      const result = await testPkgSqliteBinary();
      setCheckC({
        status: result.success ? 'pass' : 'fail',
        message: result.success
          ? `pkg+better-sqlite3 binary exited 0 (${result.stdout.trim().length} chars stdout)`
          : `binary exited with code ${result.exit_code ?? 'null'} — see stderr`,
        details: spawnResultSummary(result),
      });
    } catch (err) {
      setCheckC({
        status: 'fail',
        message: String(err),
        details: String(err),
      });
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold">Day 1 Integration Validation</h2>
        <p className="text-xs text-muted-foreground">
          All three must be green to start Phase 2. Watch the Tauri dev console for Monaco
          worker errors on Check D.
        </p>
      </div>

      <CheckRow
        label="Check A — claude subprocess"
        description={'spawn `claude -p "say hello"` via tauri-plugin-shell (auth inherited via HOME)'}
        state={checkA}
        onRun={runCheckA}
      />

      <CheckRow
        label="Check B — PostToolUse fixture + transcript input_tokens"
        description="parse day0 fixture + confirm a JSONL under ~/.claude/projects contains input_tokens (hard-fail if missing)"
        state={checkB}
        onRun={runCheckB}
      />

      <CheckRow
        label="Check C — pkg + better-sqlite3"
        description="run /Users/yang/lahacks/day0/check3-pkg-sqlite/bin/day0-sqlite; require exit 0"
        state={checkC}
        onRun={runCheckC}
      />

      {/* Check D — human-observed Monaco worker mount. */}
      <div className="flex flex-col gap-1 border border-border/40 rounded-md px-3 py-2 bg-background/60">
        <div className="flex items-center gap-3">
          <div className="w-4 text-center text-sm">
            <StatusIcon status={monacoMounted ? 'pass' : 'idle'} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Check D — Monaco worker</div>
            <div className="text-xs text-muted-foreground">
              mount Monaco; watch Tauri dev console for &quot;Could not create web worker&quot;
            </div>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setMonacoMounted(true)}
            disabled={monacoMounted}
          >
            {monacoMounted ? 'Mounted' : 'Mount Monaco'}
          </Button>
        </div>
        {monacoMounted ? (
          <div className="mt-2 h-[100px] w-full border border-border/40 rounded overflow-hidden">
            <Suspense
              fallback={
                <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                  loading monaco…
                </div>
              }
            >
              <MonacoEditor
                height="100px"
                defaultLanguage="typescript"
                defaultValue="// check D — watch Tauri dev console for worker errors"
                options={{ minimap: { enabled: false }, fontSize: 11, lineNumbers: 'off' }}
              />
            </Suspense>
          </div>
        ) : null}
      </div>
    </div>
  );
}

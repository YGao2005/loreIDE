import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Day1Validation } from '@/components/dev/Day1Validation';

/**
 * Plan 01-03 replaces the Plan 01-02 smoke test with the three-pane shell.
 *
 * The IPC roundtrip (getNodes) is now exercised by GraphPlaceholder via
 * <AsyncState> — the empty-state message ("No contracts yet — open a repo")
 * continues to prove the Rust → serde → TS path works end-to-end.
 *
 * Plan 01-04 layers a dev-only Day-1 Integration Validation panel on top.
 * The panel is gated behind `import.meta.env.DEV` so it never ships in
 * production builds. It surfaces as a small floating toggle in the
 * bottom-right corner to avoid disrupting the three-pane layout.
 */
export default function App() {
  const [devPanelOpen, setDevPanelOpen] = useState(false);

  return (
    <>
      <AppShell />
      <button
        type="button"
        data-day1-validation-toggle
        onClick={() => setDevPanelOpen((v) => !v)}
        className="fixed bottom-3 right-3 z-50 rounded-full border border-border/60 bg-background/90 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-md hover:text-foreground hover:border-border"
        title="Day-1 integration validation"
      >
        {devPanelOpen ? 'close day-1' : 'day-1 checks'}
      </button>
      {devPanelOpen ? (
        <div
          data-day1-validation-panel
          className="fixed bottom-14 right-3 z-50 w-[420px] max-h-[70vh] overflow-auto rounded-lg border border-border/60 bg-background shadow-xl"
        >
          <Day1Validation />
        </div>
      ) : null}
    </>
  );
}

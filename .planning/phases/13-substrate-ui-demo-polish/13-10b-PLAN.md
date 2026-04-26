---
phase: 13-substrate-ui-demo-polish
plan: 10b
type: execute
wave: 5
depends_on: ["13-01", "13-02", "13-03", "13-04", "13-05", "13-06", "13-07", "13-08", "13-09"]
files_modified:
  - contract-ide/src-tauri/src/commands/sync.rs
  - contract-ide/src-tauri/src/commands/demo_orchestration.rs
  - contract-ide/src-tauri/src/commands/mod.rs
  - contract-ide/src-tauri/src/lib.rs
  - contract-ide/src/lib/demoOrchestration.ts
  - contract-ide/src/components/dev/DemoOrchestrationPanel.tsx
  - contract-ide/src/components/layout/AppShell.tsx
autonomous: false
requirements:
  - DEMO-04
external_phase_dependencies:
  - "Plan 13-10a (sibling Wave 5 plan) ships the JSON fixture files (blast-radius.json, beat3-verifier.json, beat4-harvest.json) and SQL seed that this plan's IPCs read from. The two plans run in parallel — they touch ZERO shared files. This plan is the UI orchestration layer; 13-10a is the data layer."
serialization_hint: "13-10b is the only Wave 5 plan that modifies lib.rs (adds load_beat3_verifier_fixture + emit_beat4_harvest IPC handlers; modifies trigger_sync_animation handler shipped by plan 13-09). 13-10a does NOT touch lib.rs. No serialization needed within Wave 5 because 13-10a and 13-10b have zero file overlap."
must_haves:
  truths:
    - "trigger_sync_animation IPC reads blast-radius.json from disk (replaces placeholder uuids from plan 13-09 — fallback to empty arrays if fixture missing)"
    - "load_beat3_verifier_fixture IPC reads beat3-verifier.json and returns parsed shape — TS layer applies via useVerifierStore.setResults"
    - "emit_beat4_harvest IPC reads beat4-harvest.json and emits substrate:nodes-added Tauri event — HarvestPanel (plan 13-09) consumes it including attached_to_uuid for N9 halos"
    - "DemoOrchestrationPanel exposes single-click triggers for each beat (dev affordance — visible during rehearsal, hidden in production builds via import.meta.env.DEV)"
    - "Cmd+P precision test from plan 13-03 passes ≥8/10 against the seeded substrate (mandatory gate before demo rehearsal — runs against fixtures shipped by plan 13-10a)"
  artifacts:
    - path: "contract-ide/src-tauri/src/commands/sync.rs"
      provides: "trigger_sync_animation now reads blast-radius.json (replaces plan 13-09's hardcoded placeholders)"
      contains: "load_blast_radius_fixture"
    - path: "contract-ide/src-tauri/src/commands/demo_orchestration.rs"
      provides: "Rust IPCs for Beat 3 + Beat 4 fixture loading"
      contains: "load_beat3_verifier_fixture"
    - path: "contract-ide/src/lib/demoOrchestration.ts"
      provides: "TS wrapper for beat IPCs; exposes loadAndApplyBeat3Verifier + triggerBeat4Harvest"
      exports: ["loadAndApplyBeat3Verifier", "triggerBeat4Harvest"]
    - path: "contract-ide/src/components/dev/DemoOrchestrationPanel.tsx"
      provides: "Dev-mode panel with one-click beat triggers"
      contains: "DemoOrchestrationPanel"
  key_links:
    - from: "trigger_sync_animation Rust IPC"
      to: "blast-radius.json fixture (plan 13-10a)"
      via: "Reads file at app boot OR each call; replaces placeholder uuids from plan 13-09"
      pattern: "blast-radius.json"
    - from: "DemoOrchestrationPanel buttons"
      to: "loadAndApplyBeat3Verifier + triggerBeat4Harvest"
      via: "Reads beat3-verifier.json + beat4-harvest.json fixtures via Rust IPC"
      pattern: "beat3-verifier|beat4-harvest"
    - from: "emit_beat4_harvest"
      to: "HarvestPanel + animateHarvestArrival (plan 13-09)"
      via: "Tauri event 'substrate:nodes-added' carrying attached_to_uuid; HarvestPanel fires green halos per N9"
      pattern: "substrate:nodes-added|attached_to_uuid"
---

<objective>
Ship the demo UI orchestration layer — Rust IPCs that read fixture files (from plan 13-10a) + TS wrappers + DemoOrchestrationPanel for rehearsal use. **Pure UI/IPC**; no data files (those live in plan 13-10a). Per checker SF5: split from the original 13-10 to keep file ownership clean. This plan touches `src-tauri/` + `src/` only.

Purpose: Plan 13-10a ships the fixture data; this plan ships the runtime that loads it. Plan 13-09's `trigger_sync_animation` left placeholder uuids; this plan replaces with a JSON-reading impl. Plan 13-09's `loadBeat3VerifierResults` was an inline function; this plan wraps it in an IPC-driven path so reset-demo.sh's locked fixtures drive the demo deterministically. Plan 13-09's HarvestPanel listens for `substrate:nodes-added`; this plan provides an IPC to emit that event from the fixture.

Wave 5 placement: Depends on ALL prior plans (13-01 through 13-09). Runs in parallel with plan 13-10a — zero file overlap (10a touches `demo/`; 10b touches `src-tauri/` + `src/`). Both ship simultaneously to support plan 13-11's rehearsal.
</objective>

<execution_context>
@/Users/yang/.claude/get-shit-done/workflows/execute-plan.md
@/Users/yang/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/CANVAS-PURPOSE.md
@.planning/demo/presentation-script.md
@.planning/phases/13-substrate-ui-demo-polish/13-RESEARCH.md
@.planning/phases/13-substrate-ui-demo-polish/13-01-SUMMARY.md
@.planning/phases/13-substrate-ui-demo-polish/13-09-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update commands/sync.rs to read blast-radius.json + add commands/demo_orchestration.rs IPCs</name>
  <files>
    contract-ide/src-tauri/src/commands/sync.rs
    contract-ide/src-tauri/src/commands/demo_orchestration.rs
    contract-ide/src-tauri/src/commands/mod.rs
    contract-ide/src-tauri/src/lib.rs
  </files>
  <action>
**Step 1 — Update `commands/sync.rs` to read blast-radius.json from disk.**

Replace plan 13-09's hardcoded placeholder list with a JSON read:

```rust
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlastRadiusFixture {
    pub trigger_uuid: String,
    pub participant_uuids: Vec<String>,
}

fn load_blast_radius_fixture() -> Result<BlastRadiusFixture, String> {
    // Convention: fixture lives at <repo-root>/contract-ide/demo/seeds/blast-radius.json
    // OR at $CONTRACT_IDE_DEMO_FIXTURE_DIR/blast-radius.json
    let dir = std::env::var("CONTRACT_IDE_DEMO_FIXTURE_DIR")
        .unwrap_or_else(|_| {
            // Fallback: relative to compile-time CARGO_MANIFEST_DIR
            format!("{}/../demo/seeds", env!("CARGO_MANIFEST_DIR"))
        });
    let path = PathBuf::from(dir).join("blast-radius.json");
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read blast-radius.json at {path:?}: {e}"))?;
    let fixture: BlastRadiusFixture = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse blast-radius.json: {e}"))?;
    Ok(fixture)
}

#[tauri::command]
pub async fn trigger_sync_animation(
    app: AppHandle,
) -> Result<SyncTriggerResult, String> {
    let fixture = match load_blast_radius_fixture() {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[sync] fixture load failed, using fallback: {e}");
            // Fallback: empty arrays so the IPC doesn't blow up the UI
            return Ok(SyncTriggerResult {
                trigger_uuid: String::new(),
                participant_uuids: vec![],
            });
        }
    };
    let result = SyncTriggerResult {
        trigger_uuid: fixture.trigger_uuid,
        participant_uuids: fixture.participant_uuids,
    };
    let _ = app.emit("sync:triggered", &result);
    Ok(result)
}
```

**Step 2 — `commands/demo_orchestration.rs` — fixture loaders for Beat 3 + Beat 4.**

```rust
use serde_json::Value as JsonValue;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

fn fixture_dir() -> PathBuf {
    std::env::var("CONTRACT_IDE_DEMO_FIXTURE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(format!("{}/../demo/seeds", env!("CARGO_MANIFEST_DIR")))
        })
}

#[tauri::command]
pub async fn load_beat3_verifier_fixture() -> Result<JsonValue, String> {
    let path = fixture_dir().join("beat3-verifier.json");
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn emit_beat4_harvest(app: AppHandle) -> Result<(), String> {
    let path = fixture_dir().join("beat4-harvest.json");
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: JsonValue = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let nodes = parsed.get("harvested_nodes").cloned().unwrap_or(JsonValue::Array(vec![]));
    app.emit("substrate:nodes-added", &nodes).map_err(|e| e.to_string())?;
    Ok(())
}
```

Register in mod.rs + lib.rs as `commands::demo_orchestration::load_beat3_verifier_fixture` and `commands::demo_orchestration::emit_beat4_harvest`. **Per serialization_hint frontmatter:** This is the only Wave 5 plan modifying lib.rs (10a touches no Rust source) — no serialization needed within Wave 5.

**Avoid:**
- DO NOT inline fixture data in IPC fallbacks — read from disk so plan 13-11 can edit the JSON without rebuilding the binary.
- DO NOT panic on fixture-load failure — fallback to empty result + log to stderr; the demo orchestrator (plan 13-11) catches missing fixtures during pre-flight.
- DO NOT use blocking std::fs in the async runtime — for hackathon scale (one-shot fixture reads of <10KB) the sync read inside `async fn` is acceptable; if perf becomes an issue, wrap in `tokio::task::spawn_blocking`.
  </action>
  <verify>
`cd contract-ide && cargo check --manifest-path src-tauri/Cargo.toml` exits 0.
`grep -n "load_beat3_verifier_fixture\\|emit_beat4_harvest\\|load_blast_radius_fixture" contract-ide/src-tauri/src/lib.rs` returns at least 2 handlers (load_beat3_verifier_fixture + emit_beat4_harvest) registered in `generate_handler!`. (`load_blast_radius_fixture` is internal — only `trigger_sync_animation` is exposed.)
`cd contract-ide && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings 2>&1 | tail -20` exits 0.
  </verify>
  <done>
trigger_sync_animation now reads blast-radius.json on each call (no hardcoded placeholders). load_beat3_verifier_fixture + emit_beat4_harvest IPCs registered. All Rust code compiles; clippy clean.
  </done>
</task>

<task type="auto">
  <name>Task 2: Build TS wrapper + DemoOrchestrationPanel + AppShell mount</name>
  <files>
    contract-ide/src/lib/demoOrchestration.ts
    contract-ide/src/components/dev/DemoOrchestrationPanel.tsx
    contract-ide/src/components/layout/AppShell.tsx
  </files>
  <action>
**Step 1 — TS wrapper `src/lib/demoOrchestration.ts`.**

```typescript
import { invoke } from '@tauri-apps/api/core';
import { useVerifierStore, type VerifierRow, type ImplicitDecisionRow } from '@/store/verifier';

interface Beat3Fixture {
  rows: VerifierRow[];
  implicitDecisions: ImplicitDecisionRow[];
  flag: VerifierRow;
}

export async function loadAndApplyBeat3Verifier() {
  const fixture = await invoke<Beat3Fixture>('load_beat3_verifier_fixture');
  useVerifierStore.getState().setResults(
    [...fixture.rows, fixture.flag],
    fixture.implicitDecisions
  );
}

export async function triggerBeat4Harvest() {
  await invoke('emit_beat4_harvest');
  // The HarvestPanel's listen('substrate:nodes-added') subscriber will pick it up
  // AND fire animateHarvestArrival on each attached_to_uuid (per N9 — see plan 13-09)
}
```

**Note:** `loadAndApplyBeat3Verifier` produces the same effect as plan 13-09's `loadBeat3VerifierResults` inline function — this is the IPC-driven version that reads from beat3-verifier.json instead of hardcoding the rows. Plan 13-09's inline version remains for DevTools-driven testing; plan 13-10b's version is for demo rehearsal (locked fixture).

**Step 2 — `DemoOrchestrationPanel.tsx` — rehearsal control panel.**

```tsx
import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';
import { loadAndApplyBeat3Verifier, triggerBeat4Harvest } from '@/lib/demoOrchestration';

export function DemoOrchestrationPanel() {
  const [show, setShow] = useState(import.meta.env.DEV); // dev-only by default
  if (!show) return null;
  return (
    <div className="fixed left-4 bottom-4 z-50 rounded-lg border border-amber-500/40 bg-background/95 p-3 shadow-xl backdrop-blur w-64">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-amber-300">Demo Orchestration</h4>
        <button onClick={() => setShow(false)} className="text-[10px] text-muted-foreground">×</button>
      </div>
      <div className="space-y-1.5">
        <button
          onClick={() => invoke('trigger_sync_animation')}
          className="w-full text-xs rounded bg-blue-500/20 border border-blue-500/40 px-2 py-1 hover:bg-blue-500/30"
        >
          Beat 3: Sync animation
        </button>
        <button
          onClick={loadAndApplyBeat3Verifier}
          className="w-full text-xs rounded bg-orange-500/20 border border-orange-500/40 px-2 py-1 hover:bg-orange-500/30"
        >
          Beat 3: Verifier results
        </button>
        <button
          onClick={triggerBeat4Harvest}
          className="w-full text-xs rounded bg-green-500/20 border border-green-500/40 px-2 py-1 hover:bg-green-500/30"
        >
          Beat 4: Harvest panel
        </button>
      </div>
      <div className="text-[10px] text-muted-foreground mt-2">
        Hotkey: shift+click trigger to log fixture state
      </div>
    </div>
  );
}
```

Mount in AppShell behind `import.meta.env.DEV` so production builds don't show. Per Plan 01-04 decision, DO NOT gate on DEV alone — `tauri build --debug` builds in production mode. Allow override via `?demo=1` URL param OR a config flag. For now: `import.meta.env.DEV` is acceptable; plan 13-11 rehearsal verifies on release `.app` bundle.

```tsx
// In AppShell.tsx
{import.meta.env.DEV && <DemoOrchestrationPanel />}
```

**Avoid:**
- DO NOT gate DemoOrchestrationPanel on a feature flag complex enough to introduce its own bugs — `import.meta.env.DEV` is the simplest filter; production build won't include it via dead-code elimination.
- DO NOT make the panel modal — it must coexist with the canvas + verifier panel + harvest panel in real time during rehearsal.
- DO NOT auto-fire the orchestration on app boot — every trigger must be human-driven so the demonstrator controls timing.
  </action>
  <verify>
`cd contract-ide && npx tsc --noEmit` exits 0.
`grep -n "DemoOrchestrationPanel" contract-ide/src/components/layout/AppShell.tsx` returns at least one match.
Boot app in dev mode; verify DemoOrchestrationPanel visible bottom-left with three buttons.
Click each button; verify Sync animation runs, VerifierPanel populates with Beat 3 results (read from beat3-verifier.json), HarvestPanel shows Beat 4 nodes with promoted badge AND green halos on attached_to_uuid participants (N9 per plan 13-09).
  </verify>
  <done>
DemoOrchestrationPanel exposes one-click triggers in dev mode. All three IPC fixture loaders return correct data. Plan 13-11 will run the 3x rehearsal against this infrastructure.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Smoke-test all 3 fixture-loaded beats end-to-end</name>
  <files>(human verification — no files written by this task)</files>
  <action>
**Built (subject of verification):**
Three Rust IPCs that load fixture JSON files (from plan 13-10a). TS wrappers (loadAndApplyBeat3Verifier, triggerBeat4Harvest). DemoOrchestrationPanel exposes one-click beat triggers in dev mode.

**Verification protocol — execute and observe:**
1. Verify plan 13-10a is shipped — `ls contract-ide/demo/seeds/` shows all 5 files.
2. **First-run setup:** Edit `blast-radius.json`, `beat3-verifier.json`, `beat4-harvest.json` to substitute `<UUID-...>` placeholders with real UUIDs from the demo repo's `.contracts/*.md` frontmatter. (If Phase 9 is in flight and these contracts don't yet exist, document the substitution work as a TODO for plan 13-11 rehearsal blocking item.)
3. Run `bash contract-ide/demo/reset-demo.sh` (from plan 13-10a). Verify total elapsed time logged at end of script (target <10s, acceptable <15s).
4. After relaunch, open the demo repo in the IDE.
5. In the bottom-left, verify DemoOrchestrationPanel is visible (dev mode).
6. Click "Beat 3: Sync animation". Verify Sync animation plays across the chain (if a flow chain is currently rendered) — BLUE citation halos staggered 50ms apart starting at trigger uuid from blast-radius.json.
7. Click "Beat 3: Verifier results". Verify VerifierPanel shows 6 honor rows + 3 implicit decisions + 1 orange flag with halo on screen card. The flag's parentSurfaceUuid should match the real screen card uuid (substituted in step 2).
8. Click "Beat 4: Harvest panel". Verify HarvestPanel shows 3 new rules with one carrying the `[⌃ promoted from implicit]` badge. **Per N9**: each rule with attached_to_uuid triggers a GREEN halo on the corresponding participant in the chain, staggered ~200ms apart.
9. Run `cd contract-ide && npx vitest run cmdp-precision`. Verify ≥8/10 queries match top-1 — this is the SC 1 ≥80% precision gate. If precision falls below 80%, debug per 13-RESEARCH.md Risk 1: add FTS5 substring match as first-pass before LLM rerank.
10. Re-run reset-demo.sh a SECOND time. Verify the app fully relaunches with clean state — no stale highlights from the first run.
  </action>
  <verify>
1. plan 13-10a fixtures exist and are non-empty.
2. UUID placeholders substituted with real Phase 9 uuids in all 3 fixtures.
3. reset-demo.sh runs in <15s.
4. App boots; demo repo open.
5. DemoOrchestrationPanel visible bottom-left.
6. Click "Beat 3: Sync animation" → blast-radius animation plays, BLUE halos stagger 50ms.
7. Click "Beat 3: Verifier results" → VerifierPanel renders 6 honors + 3 implicit + 1 flag; orange flag halos screen card.
8. Click "Beat 4: Harvest panel" → HarvestPanel shows 3 nodes (one with promoted badge); GREEN halos appear on each attached_to_uuid participant per N9.
9. `npx vitest run cmdp-precision` passes ≥8/10.
10. Reset twice in a row; second run clean (no stale highlights from first).
  </verify>
  <done>
Type "approved" or describe issues. Common blocking issues: precision <8/10 (mitigation: tune find_substrate_by_intent), reset script doesn't kill app cleanly (mitigation: pkill name), placeholder UUIDs not yet substituted (mitigation: defer to plan 13-11 rehearsal pre-flight), N9 green halos don't fire (mitigation: verify HarvestPanel's animateHarvestArrival call from plan 13-09).
  </done>
</task>

</tasks>

<verification>
- All Rust IPCs compile + clippy clean
- TS wrapper passes tsc --noEmit
- DemoOrchestrationPanel mounts in dev mode
- All 3 buttons trigger the right beat behavior end-to-end
- Cmd+P precision test ≥8/10 (sanity check; passes only if Phase 9 contracts seeded with right names AND plan 13-10a fixtures populated)
- N9 green halos fire on Beat 4 harvest arrivals (plan 13-09 + 13-10a + 13-10b stack working together)
</verification>

<success_criteria>
- [ ] trigger_sync_animation reads blast-radius.json from disk (no hardcoded placeholders left from plan 13-09)
- [ ] load_beat3_verifier_fixture + emit_beat4_harvest IPC functions ship and registered in lib.rs
- [ ] TS wrapper exposes loadAndApplyBeat3Verifier + triggerBeat4Harvest
- [ ] DemoOrchestrationPanel one-click triggers work for all three beats
- [ ] Pure UI/IPC plan — no JSON / SQL / shell files (those are 13-10a's deliverable)
- [ ] N9 verified: Beat 4 harvest emit triggers green halos via HarvestPanel + animateHarvestArrival
- [ ] Cmd+P precision test runnable (passes ≥8/10 if Phase 9 contracts seeded — else gracefully fails with informative message)
- [ ] Human verification confirms reset-then-rehearse loop is reproducible
</success_criteria>

<output>
After completion, create `.planning/phases/13-substrate-ui-demo-polish/13-10b-SUMMARY.md` documenting:
- Which IPCs were added vs modified (vs plan 13-09's placeholders)
- Whether fixture-loading paths required env-var override during rehearsal
- Whether Cmd+P precision passed ≥8/10 OR what FTS5 fallback was added per Risk 1
- Confirmation that N9 attached_to_uuid green halos fire correctly when Beat 4 emit runs
- Any deviations from plan 13-10's original scope that this split into 10a + 10b changed
</output>

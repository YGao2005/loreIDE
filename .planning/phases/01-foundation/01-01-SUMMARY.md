---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [tauri, react, typescript, vite, macos, vibrancy, monaco, shadcn, tailwind-v4, window-vibrancy]

# Dependency graph
requires: []
provides:
  - Tauri v2 + React + TS scaffold at /Users/yang/lahacks/contract-ide/
  - Native macOS chrome: overlay titlebar, traffic lights at (19, 24), NSVisualEffectMaterial::Sidebar vibrancy
  - Transparent window surviving production .app bundle (macOSPrivateApi: true)
  - Monaco-ready CSP (blob: in script-src) + vite-plugin-monaco-editor with five language workers
  - SF Pro font stack + transparent html/body/#root baseline CSS
  - shadcn/ui v4 initialized (Radix + Nova preset) with Tailwind v4
  - Rust builder wired with tauri-plugin-shell + window-vibrancy setup hook; NO #[tokio::main]
  - capabilities/default.json permits shell:allow-execute, shell:allow-spawn (needed for Plan 01-04 claude subprocess test)
affects: [01-02, 01-03, 01-04, 02, 03, 04, 05, 06, 07, 08, 09]

# Tech tracking
tech-stack:
  added:
    - "tauri 2 (with macos-private-api feature)"
    - "tauri-plugin-shell 2.3.5"
    - "tauri-plugin-sql 2.4.0 (declared; wired in 01-02)"
    - "tauri-plugin-opener (retained from scaffold)"
    - "window-vibrancy 0.7"
    - "serde 1, serde_json 1, anyhow 1"
    - "zustand 5.0.12, zundo 2.3.0"
    - "react-resizable-panels 4.10.0"
    - "@monaco-editor/react 4.7.0, monaco-editor 0.55.1"
    - "vite-plugin-monaco-editor 1.1.0"
    - "tailwindcss v4 + @tailwindcss/vite + @types/node"
    - "shadcn/ui v4 (base=radix, preset=nova) — components: button, separator, resizable, scroll-area"
  patterns:
    - "Tauri v2 builder lives in src-tauri/src/lib.rs (NOT main.rs); main.rs only calls contract_ide_lib::run()"
    - "Vibrancy applied in setup hook on the main window (whole-window, not region-scoped)"
    - "Transparency survives production via macOSPrivateApi: true (Pitfall 3 mitigation)"
    - "Monaco web workers enabled via blob: in CSP script-src + vite-plugin-monaco-editor (Pitfall 2 mitigation)"
    - "NEVER #[tokio::main] — Tauri owns the async runtime (Pitfall 1 mitigation)"
    - "Tailwind v4 CSS-first @theme config (no tailwind.config.js)"

key-files:
  created:
    - "/Users/yang/lahacks/contract-ide/package.json"
    - "/Users/yang/lahacks/contract-ide/vite.config.ts"
    - "/Users/yang/lahacks/contract-ide/src/App.tsx"
    - "/Users/yang/lahacks/contract-ide/src/main.tsx"
    - "/Users/yang/lahacks/contract-ide/src/index.css"
    - "/Users/yang/lahacks/contract-ide/components.json"
    - "/Users/yang/lahacks/contract-ide/src-tauri/Cargo.toml"
    - "/Users/yang/lahacks/contract-ide/src-tauri/tauri.conf.json"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/main.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/src/lib.rs"
    - "/Users/yang/lahacks/contract-ide/src-tauri/capabilities/default.json"
  modified: []

key-decisions:
  - "shadcn v4 CLI flags: `--template vite --base radix --preset nova` (plan's `--base-color slate` was deprecated in v4)"
  - "Tailwind v4 + @tailwindcss/vite + @types/node installed BEFORE `shadcn init` (v4 prereq)"
  - "macOSPrivateApi: true added in Task 1 (not deferred to Task 2) to match the `macos-private-api` Cargo feature flag already required at Task 1 build time"
  - "Retained tauri-plugin-opener from scaffold alongside tauri-plugin-shell (no conflict; zero-cost)"
  - "Added `html,body,#root { background: transparent !important }` AFTER `@layer base` to defeat shadcn's `bg-background` override"

patterns-established:
  - "Tauri v2 builder in src-tauri/src/lib.rs with setup hook for window-vibrancy; main.rs stays a one-liner"
  - "Frontend deps pinned to RESEARCH.md Standard Stack versions (verified 2026-04-24)"
  - "CSP explicitly permits blob: in script-src so future Monaco worker mounts succeed in WKWebView"
  - "Vibrancy applied whole-window; non-sidebar panels get CSS background-color overrides (deferred to Plan 01-03)"

requirements-completed: [SHELL-01]

# Metrics
duration: ~60min (Tasks 1+2 autonomous + Task 3 human verification loop)
completed: 2026-04-24
---

# Phase 1 Plan 1: Tauri v2 Foundation + Native macOS Chrome Summary

**Tauri v2 + React + TS scaffold with overlay titlebar, NSVisualEffectMaterial::Sidebar vibrancy surviving production builds, Monaco-ready CSP (blob:), SF Pro font stack, and shadcn/ui v4 — zero Tauri runtime footguns (`#[tokio::main]` absent).**

## Performance

- **Duration:** ~60 min (across Tasks 1+2 autonomous + Task 3 human-verify loop incl. production build)
- **Started:** 2026-04-24 (Tasks 1+2 commits `ee250da`, `8f5a7af`)
- **Completed:** 2026-04-24T22:19:48Z
- **Tasks:** 3 (2 auto + 1 human-verify)
- **Files modified:** 11 (all created)

## Accomplishments

- Launchable Tauri v2 window titled "Contract IDE" with native macOS chrome
- Traffic lights rendered at (19, 24) under an overlay titlebar with no separate title bar chrome
- Translucent window with `NSVisualEffectMaterial::Sidebar` vibrancy — **confirmed surviving the production `.app` bundle** (Pitfall 3 cleared on camera-grade verification)
- SF Pro font stack rendering via `-apple-system` cascade (confirmed via devtools computed font-family)
- Monaco CSP (`blob:` in `script-src`) + `vite-plugin-monaco-editor` with 5 language workers registered — Tauri dev console free of red errors, no "Could not create web worker"
- shadcn/ui v4 initialized (Radix base + Nova preset) with `button`, `separator`, `resizable`, `scroll-area` components added
- `capabilities/default.json` permits `shell:allow-execute` and `shell:allow-spawn` (Plan 01-04 claude subprocess test ready)
- `git grep -E '#\[tokio::main\]' src-tauri/` returns empty — Tauri owns the runtime

## Task Commits

1. **Task 1: Scaffold Tauri v2 + React + TS project with locked deps** — `ee250da` (feat)
2. **Task 2: Wire native macOS chrome, Monaco CSP, and shell/vibrancy plugins** — `8f5a7af` (feat)
3. **Task 3: Human verification — native macOS chrome renders correctly** — APPROVED (checkpoint, no code commit; state recorded in `a43eb31`)

**Plan metadata commit:** pending (this commit)

## Files Created/Modified

- `contract-ide/package.json` — pinned frontend deps (zustand 5.0.12, zundo 2.3.0, react-resizable-panels 4.10.0, @monaco-editor/react 4.7.0, monaco-editor 0.55.1, tauri plugins, vite-plugin-monaco-editor, tailwindcss v4, @tailwindcss/vite, @types/node)
- `contract-ide/vite.config.ts` — registers `vite-plugin-monaco-editor` with `['editorWorkerService', 'typescript', 'json', 'css', 'html']` workers; `(monacoEditor as any).default(...)` CJS/ESM cast applied
- `contract-ide/src/App.tsx` — placeholder `<div>` for vibrancy verification
- `contract-ide/src/index.css` — transparent html/body/#root + SF Pro stack (with `!important` override after `@layer base` to defeat shadcn's `bg-background`)
- `contract-ide/components.json` — shadcn v4 config (Radix + Nova)
- `contract-ide/src-tauri/Cargo.toml` — tauri 2 (with `macos-private-api` feature), tauri-plugin-shell 2, tauri-plugin-sql 2 (sqlite), tauri-plugin-opener (retained), window-vibrancy 0.7, serde, serde_json, anyhow
- `contract-ide/src-tauri/tauri.conf.json` — window at (1400×900, min 1100×700), `titleBarStyle: Overlay`, `trafficLightPosition: { x: 19, y: 24 }`, `transparent: true`, `hiddenTitle: true`, `macOSPrivateApi: true`, CSP with `blob:` in `script-src`
- `contract-ide/src-tauri/src/main.rs` — one-liner: `contract_ide_lib::run()` with top-of-file comment warning against `#[tokio::main]`
- `contract-ide/src-tauri/src/lib.rs` — builder registers `tauri_plugin_shell::init()`; setup hook applies `apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)` on macOS
- `contract-ide/src-tauri/capabilities/default.json` — permits `shell:allow-execute`, `shell:allow-spawn`

## Human Verification Result

**APPROVED — all 6 verification steps passed.**

| # | Check | Result |
|---|-------|--------|
| 1 | Window "Contract IDE" opens via `npm run tauri dev` | PASS |
| 2 | Overlay titlebar with traffic lights at (19, 24) | PASS |
| 3 | Translucent window (Finder visible behind) in dev | PASS |
| 4 | Computed font-family = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif` (devtools) | PASS |
| 5 | Tauri dev console free of red errors; no "Could not create web worker" | PASS |
| 6 | Production build (`npm run tauri build -- --debug`) — `.app` bundle window still translucent (Pitfall 3 cleared) | PASS |

Optional check (`git grep -E "#\[tokio::main\]" contract-ide/src-tauri/` empty): PASS.

## Decisions Made

1. **shadcn v4 CLI flags corrected.** Plan specified `--base-color slate` (deprecated in v4). Used `--template vite --base radix --preset nova`.
2. **Tailwind v4 prerequisites installed before `shadcn init`.** Installed `tailwindcss`, `@tailwindcss/vite`, `@types/node` up-front; v4 CLI-free init requires them present before shadcn generates `components.json`.
3. **`macOSPrivateApi: true` set in Task 1, not deferred to Task 2.** The `macos-private-api` Cargo feature on `tauri` (added in Task 1 for window-vibrancy to compile) is the matched pair of the JSON flag — splitting them across tasks would leave Task 1 builds transiently inconsistent.
4. **Kept `tauri-plugin-opener` from scaffold.** Ships with `create-tauri-app`; removing it was unnecessary churn. Coexists cleanly with `tauri-plugin-shell`.
5. **CSS override with `!important` after `@layer base`.** shadcn's `bg-background` declaration overrode the transparent html/body/#root rule from the plan. Appended the override below the `@layer base` block.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] shadcn v4 CLI flag deprecation**
- **Found during:** Task 1 (shadcn init)
- **Issue:** `npx shadcn@latest init --yes --base-color slate` failed — `--base-color` was deprecated in shadcn v4.
- **Fix:** Used `npx shadcn@latest init --template vite --base radix --preset nova --yes`.
- **Files modified:** `components.json` (generated)
- **Verification:** components.json written; `button/separator/resizable/scroll-area` added without error.
- **Committed in:** `ee250da`

**2. [Rule 3 - Blocking] Tailwind v4 + @tailwindcss/vite + @types/node required before shadcn init**
- **Found during:** Task 1 (shadcn init)
- **Issue:** shadcn v4 init depends on Tailwind v4 + its Vite plugin + Node types being present first.
- **Fix:** Installed `tailwindcss`, `@tailwindcss/vite`, `@types/node` before `npx shadcn init`.
- **Files modified:** `package.json`, `vite.config.ts`
- **Verification:** `shadcn init` ran cleanly; dev server started without Tailwind errors.
- **Committed in:** `ee250da`

**3. [Rule 3 - Blocking] `macOSPrivateApi: true` added in Task 1 (not Task 2)**
- **Found during:** Task 1 (cargo build after adding window-vibrancy)
- **Issue:** window-vibrancy's private-API usage requires the `macos-private-api` Cargo feature on `tauri` at compile time; the plan's Task 1 build step otherwise would hit an inconsistency between Rust feature flag and missing JSON flag.
- **Fix:** Set `app.macOSPrivateApi: true` in `tauri.conf.json` during Task 1, matching the Cargo `features = ["macos-private-api"]` declaration.
- **Files modified:** `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
- **Verification:** `cargo build` in `src-tauri/` exited 0.
- **Committed in:** `ee250da`

**4. [Rule 3 - Blocking] Retained `tauri-plugin-opener` from scaffold**
- **Found during:** Task 2 (lib.rs builder edit)
- **Issue:** `create-tauri-app` scaffold registers `tauri-plugin-opener` by default; plan did not mention it, but removing it would be pointless churn and would break the scaffold invocation if retried.
- **Fix:** Left `tauri-plugin-opener` in Cargo.toml and registered alongside `tauri-plugin-shell` in the builder.
- **Files modified:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`
- **Verification:** `cargo check` clean; dev run shows no plugin conflict.
- **Committed in:** `8f5a7af`

**5. [Rule 1 - Bug] shadcn's `bg-background` overrode transparent html/body/#root**
- **Found during:** Task 2 → Task 3 vibrancy check
- **Issue:** With the plan's transparent CSS placed at the top of `index.css`, shadcn's `@layer base { body { @apply bg-background } }` cascaded later and painted the window solid.
- **Fix:** Appended `html,body,#root { background: transparent !important }` AFTER `@layer base` to defeat the shadcn override.
- **Files modified:** `src/index.css`
- **Verification:** Human Task 3 step 3 (vibrancy visible in dev) and step 6 (vibrancy surviving production build) both PASS.
- **Committed in:** `8f5a7af`

---

**Total deviations:** 5 auto-fixed (4 Rule 3 - Blocking, 1 Rule 1 - Bug). **Impact on plan:** All deviations were scaffold-time environment corrections or necessary to satisfy the plan's own verification criteria. No scope creep. All pinned dep versions preserved.

## Issues Encountered

- **Tauri bundle identifier warning (non-blocking, deferred).** Tauri warned that `com.contract-ide.app` ends in `.app`, which collides with the macOS bundle extension convention. Build succeeded; warning is cosmetic. **Follow-up:** rename to e.g. `com.contract-ide.ide` or `com.contracide.app` in a later cleanup pass. Not demo-blocking.
- **`window-vibrancy 0.6` pulled transitively.** Direct Cargo.toml declares `window-vibrancy = "0.7"` only, but cargo's dep tree also compiles 0.6 via a transitive branch (likely through `muda` or similar). Zero runtime impact — our `apply_vibrancy` resolves against 0.7. Noted for awareness; revisit only if binary size becomes a concern.

## User Setup Required

None - no external service configuration required for Plan 01-01. (Plan 01-04 introduces claude CLI auth inheritance; tracked there.)

## Next Phase Readiness

- **Ready for Plan 01-02** (SQLite schema + typed Rust IPC skeleton). The scaffold, `tauri-plugin-sql 2.4.0` dep, and shell-capable capabilities file are all in place; 01-02 just needs to add `sql:allow-*` permissions and write the migration files.
- **Ready for Plan 01-03** (three-pane AppShell + Copy Mode pill + AsyncState + autosave/zundo). shadcn resizable + scroll-area + button + separator components already installed; `zundo` and `zustand` pinned.
- **Ready for Plan 01-04** (Day-1 integration validation). `shell:allow-execute`/`shell:allow-spawn` capabilities present; Monaco CSP blob: already live so the worker-mount smoke test can run without further CSP changes.

---
*Phase: 01-foundation*
*Completed: 2026-04-24*

## Self-Check: PASSED

All 11 key-files verified present on disk. All 3 referenced commits (`ee250da`, `8f5a7af`, `a43eb31`) present in git history.

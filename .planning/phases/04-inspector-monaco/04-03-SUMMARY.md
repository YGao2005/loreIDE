---
phase: 04-inspector-monaco
plan: 03
subsystem: ui
tags: [inspector, preview, iframe, reqwest, tauri-csp, rustls, probe, localhost-preview]

# Dependency graph
requires:
  - phase: 04-inspector-monaco
    plan: 01
    provides: PreviewTab stub shell, ipc/inspector.ts module, commands/inspector.rs module
  - phase: 04-inspector-monaco
    plan: 02
    provides: commands/inspector.rs append-site (hash_text + read_contract_frontmatter precede probe_route)
  - phase: 01-foundation
    provides: Tauri CSP baseline with blob: in script-src (must NOT be clobbered)
provides:
  - probe_route async Tauri command — reqwest-based dev-server reachability check (1s timeout, bool return)
  - probeRoute TypeScript IPC wrapper — single-arg (url) for PreviewTab consumption
  - frame-src CSP grant for http://localhost:* + http://127.0.0.1:* — unblocks cross-origin iframe loads
  - Live PreviewTab — four-state component (idle / probing / unreachable / reachable) with iframe rendering and Retry
  - reqwest 0.12 dependency with rustls-tls + json features, default-features=false (macOS-clean TLS)
affects: [04-04-uat, 09-demo-polish]

# Tech tracking
tech-stack:
  added: [reqwest 0.12 (rustls-tls, json, no defaults), frame-src CSP directive]
  patterns:
    - "Probes run through Rust reqwest, not frontend fetch — tauri://localhost → http://localhost is cross-origin, fetch is CORS-blocked (Pitfall 6)"
    - "probe_route returns bool (not Result<bool, String>) — a failed probe is definitionally false, not an error to explain"
    - "probe accepts status < 500 as reachable — 404/403 pages still mean the dev server is up"
    - "useEffect cancellation flag pattern — cancelled = true on cleanup so rapid tab switches don't setState-after-unmount"
    - "iframe key={probeCount} — bumping the counter forces React unmount/remount = cleanest full-navigation reload without mutating src"
    - "iframe sandbox='allow-scripts allow-same-origin allow-forms' — Next.js hot reload needs all three; dropping allow-same-origin blanks the render"
    - "CSP frame-src includes both localhost AND 127.0.0.1 — some Next.js setups bind only one; CSP host-match is literal, not resolved"

key-files:
  modified:
    - contract-ide/src-tauri/Cargo.toml
    - contract-ide/src-tauri/Cargo.lock
    - contract-ide/src-tauri/src/commands/inspector.rs
    - contract-ide/src-tauri/src/lib.rs
    - contract-ide/src-tauri/tauri.conf.json
    - contract-ide/src/ipc/inspector.ts
    - contract-ide/src/components/inspector/PreviewTab.tsx

key-decisions:
  - "reqwest added to Cargo.toml (not already present as the plan assumed) — plan's Step 1 fallback path executed verbatim: canonical form with rustls-tls + json + default-features=false"
  - "default-features=false is load-bearing even though the dev-machine build succeeded without it — pulls in native-tls → OpenSSL conflict with Tauri's TLS on a clean CI or fresh-clone build (Pitfall 5)"
  - "CSP frame-src narrowed to http://localhost:* + http://127.0.0.1:* — NOT wildcard. Phase 9 polish may revisit for remote preview targets; hackathon scope is local-only"
  - "probe_route uses reqwest::Client::builder with 1s timeout — fast-fail keeps UI responsive when dev server is down; a longer timeout would make 'unreachable' feel like 'hung'"
  - "probe_route returns bool not Result — the frontend's UX question is binary (render iframe or show prompt); failure modes (timeout, connection refused, DNS) collapse to the same 'unreachable' outcome"
  - "PreviewTab iframe uses sandbox with THREE tokens — allow-scripts + allow-same-origin + allow-forms. Zero tokens blocks hot reload; dropping allow-same-origin produces blank render; extra tokens are not needed for vercel/commerce (deferred UAT confirmation)"
  - "Retry is a manual button, not an auto-poll — predictable UX, no CPU burn when user switches tabs"

requirements-completed: [INSP-02]

# Metrics
duration: ~2min
completed: 2026-04-24
---

# Phase 4 Plan 03: Live Preview Pane Summary

**Replaced the PreviewTab stub with a real localhost-iframe + reqwest probe path, landed frame-src CSP so the iframe can actually load http://localhost:*, and added reqwest 0.12 with rustls-tls as the macOS-clean TLS backend — two tasks, both behind cargo check + tsc --noEmit, one plan-assumption deviation (reqwest absent, re-added) with zero UX impact.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-24T21:22:20Z
- **Completed:** 2026-04-24T21:24:19Z
- **Tasks:** 2
- **Files modified/created:** 7 (0 created, 7 modified)

## Accomplishments

- `probe_route(url: String) -> bool` async Tauri command in `commands/inspector.rs`: reqwest::Client with 1s timeout; returns `true` when status < 500, `false` on any error (build failure, timeout, connection refused, 5xx).
- `probeRoute(url)` TypeScript wrapper in `src/ipc/inspector.ts` with CORS-pitfall rationale inlined.
- `generate_handler!` in `lib.rs` now registers `commands::inspector::probe_route` alongside the 04-01 + 04-02 inspector commands.
- `tauri.conf.json` CSP gains `frame-src: ["http://localhost:*", "http://127.0.0.1:*"]` while preserving every Phase 1 directive (especially `blob:` in `script-src`, load-bearing for Monaco workers).
- `reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }` added to Cargo.toml — no OpenSSL pulled through our dep (verified via `cargo tree -p reqwest@0.12.28`, TLS branch goes `rustls → rustls-pki-types → rustls-webpki`).
- `PreviewTab.tsx` is now a four-state component:
  - `idle` — no node selected, or node with no `route` (shows "no route" message instead).
  - `probing` — probe in flight; renders `Checking {url}…`.
  - `unreachable` — probe returned false; renders "No dev server reachable at {url}" + Retry button.
  - `reachable` — iframe renders with URL bar + Reload button; `key={probeCount}` forces remount on Reload.
- Type-check (`npx tsc --noEmit`) and Rust-check (`cargo check`) both green at HEAD.

## Final CSP Object Shape (plan output spec §1)

```json
"csp": {
  "default-src": ["'self'"],
  "script-src": ["'self'", "blob:"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "asset:", "https://asset.localhost"],
  "connect-src": ["'self'", "ipc:", "https://ipc.localhost"],
  "frame-src": ["http://localhost:*", "http://127.0.0.1:*"]
}
```

Four directives preserved from Phase 1 unchanged; `frame-src` added. Both `localhost` and `127.0.0.1` listed because CSP host-match is literal — some Next.js setups bind only one and the other CSP entry is dead weight on the unused host (harmless).

## Reqwest Status at Plan Start (plan output spec §2)

The plan's Step 1 instructed to **verify** reqwest was already at line 37 of Cargo.toml, assuming plan authoring had captured it pre-existing. In fact it was **absent** entirely — no `reqwest` line in `[dependencies]` at plan start. The plan's own Step 1 fallback was explicit: *"If genuinely absent → add the canonical line to `[dependencies]`."*

Action: added the canonical form verbatim on a new line immediately after the `sqlx` line:

```toml
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
```

No pre-existing line to edit, no duplicate-key risk, `cargo check` clean first try. `grep -c "^reqwest"` returns `1`.

This is a plan-assumption drift, not an auto-fix deviation — the plan explicitly handled this path. The fact that another `reqwest` (v0.13.2) exists in the transitive tree (pulled by a Tauri plugin) is unrelated to our direct dependency; `cargo tree` disambiguation is `reqwest@0.12.28` for ours.

## Iframe Sandbox Tokens (plan output spec §3)

Stayed at the planned three: `allow-scripts allow-same-origin allow-forms`. No additional tokens were needed for the smoke test because the smoke test target was `python3 -m http.server` (static directory listing — zero JS, zero forms, zero XHR), and the planned three cover the listed needs (scripts for HTML render + hot reload, same-origin for Next.js dev XHR, forms for vercel/commerce checkout flows later).

Phase 4-04 UAT against live vercel/commerce may surface a need for `allow-popups` or `allow-downloads` if the commerce repo does OAuth redirects or CSV exports respectively — TBD in 04-04's human-verify checkpoint.

## Baseline Probe Latency (plan output spec §4)

Automated smoke test not run live (this plan is executor-only; the human-verify for localhost probe lives in 04-04). Rust `probe_route` timeout set to 1s via `reqwest::Client::builder().timeout(Duration::from_secs(1))`. For an already-listening dev server on the same machine over loopback, probe latency should be **< 50ms** in practice (reqwest handshake + single HTTP request against localhost). If 04-04 UAT records consistently < 100ms, the patience threshold for "probing" → "reachable" transitions can be lowered from "immediate" to "< 150ms total perceived latency."

Unreachable cases hit the 1s timeout cap (connection refused is near-instant on loopback; DNS-free localhost means no DNS latency).

## CORS / CSP Errors Encountered (plan output spec §5)

None surfaced during executor-level verification (cargo check + tsc --noEmit). The CSP change is forward-additive (added `frame-src`, touched no existing directive), so no Phase 1 / Phase 3 / Plan 04-02 surfaces should regress.

Live-browser verification (Phase 4 UAT) will confirm:
- No "Refused to load frame" errors for http://localhost:* URLs.
- Monaco workers still load (Phase 1 `blob:` in `script-src` preserved).
- No CORS errors because the frontend NEVER fetches the preview URL directly — all reachability checks route through Rust.

The Pitfall 6 CORS class is avoided by construction: `probeRoute(url)` is `invoke('probe_route', { url })` (Tauri IPC, same-process), and the iframe `src={previewUrl}` is a navigation (not a fetch), which CSP gates via `frame-src` — exactly the directive added.

## Task Commits

Each task was committed atomically:

1. **Task 1: probe_route Tauri command + frame-src CSP for preview iframe** — `f13267a` (feat)
2. **Task 2: live PreviewTab with iframe + dev-server probe + retry** — `51d6a5c` (feat)

## Files Created/Modified

### Created

None.

### Modified

- `contract-ide/src-tauri/Cargo.toml` — added `reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }` (one line, after sqlx entry; NOT present at plan start despite plan's Step 1 assumption).
- `contract-ide/src-tauri/Cargo.lock` — transitive resolution of reqwest 0.12 + its rustls-based TLS stack; zero OpenSSL/native-tls introduced through our dep (verified via `cargo tree -p reqwest@0.12.28`).
- `contract-ide/src-tauri/src/commands/inspector.rs` — appended `probe_route` async command at the end of the file; preserves 04-01's `read_file_content` + `open_in_editor` and 04-02's `hash_text` + `read_contract_frontmatter` untouched.
- `contract-ide/src-tauri/src/lib.rs` — added `commands::inspector::probe_route` line to `generate_handler!` (fully-qualified, consistent with Plan 01-02 rule).
- `contract-ide/src-tauri/tauri.conf.json` — added `"frame-src": ["http://localhost:*", "http://127.0.0.1:*"]` to `app.security.csp` while preserving the other five directives.
- `contract-ide/src/ipc/inspector.ts` — exported `probeRoute(url)` wrapper with CORS-rationale docstring.
- `contract-ide/src/components/inspector/PreviewTab.tsx` — overwrote the 04-01 placeholder with the 117-line four-state component (useEffect probe + cancellation flag, four render branches, retry-via-counter-bump).

## Decisions Made

- **Added reqwest rather than edit-in-place.** Plan assumed reqwest was present at Cargo.toml line 37; it was absent entirely. Plan's own Step 1 fallback handled this (add canonical form). No duplicate-key risk because no previous line existed.
- **default-features=false is load-bearing even on a passing dev build.** The dev machine's other dependencies (sqlx `runtime-tokio-native-tls`) already bring OpenSSL into the tree transitively, so omitting `default-features=false` wouldn't have *crashed* our build today. But on a clean CI or fresh-clone without the sqlx-native-tls crutch, reqwest's default `native-tls` feature would pull an *additional* OpenSSL path and conflict with Tauri's bundled TLS. Followed the plan's canonical form anyway because the flag is cheap and future-proofs against dep graph churn.
- **Frame-src narrowed to localhost + 127.0.0.1.** Not a wildcard, not even `http://localhost:3000` (port-specific) because dev servers frequently bind to ports 3001, 4000, 5173, etc. on port collisions. Plan's list of two hosts with wildcard ports is the right-sized aperture.
- **probe_route returns bool, not Result.** The frontend's UX question is "render iframe or show prompt?" — binary. Timeout / connection refused / DNS failure / 5xx all collapse to "unreachable." Preserving error text in a Result<bool, String> would force the frontend into either silently discarding it (pointless) or displaying "Probe failed: connection refused at http://localhost:3000" (noise for a known-possible state). Kept to the plan's signature.
- **Accept status < 500 as reachable.** A 404 at the specific route still means the dev server is listening — the user can navigate from there or fix the route. A 500 implies the server is up but crashing; still count as reachable per plan (the iframe will render the error page, which is informative during development).
- **PreviewTab iframe sandbox tokens unchanged from plan.** Three tokens — plan researched the minimum set for Next.js dev. No adventurism.
- **Retry is manual, not auto-poll.** Auto-poll would either burn CPU when the Preview tab is open but the user has tabbed away, or require visibility-detection plumbing. Manual button is self-documenting and keeps the state machine a pure function of (node.route, probeCount).
- **Iframe key={probeCount} for Reload.** The canonical alternative is `ref.current.contentWindow.location.reload()`, which requires a ref and same-origin access (sandbox has `allow-same-origin` so it'd work, but the key-bump trick is simpler and resets the iframe internal state completely).

## Deviations from Plan

### Plan-Assumption Drift

**1. [Assumption correction, NOT Rule 1-4] reqwest was absent from Cargo.toml**
- **Found during:** Task 1 Step 1 pre-flight.
- **Issue:** Plan Step 1 assumed `reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }` was already present at `Cargo.toml` line 37. Actual state: no `reqwest` line existed in `[dependencies]`.
- **Fix:** Followed the plan's own Step 1 fallback: *"If genuinely absent → add the canonical line to `[dependencies]`."* Added the canonical form verbatim.
- **Files modified:** `contract-ide/src-tauri/Cargo.toml`, `contract-ide/src-tauri/Cargo.lock`.
- **Committed in:** `f13267a` (Task 1 commit — same commit as the other Task 1 changes).
- **Why not a deviation rule:** The plan explicitly handled the absent case. This is a plan-assumption correction, not an auto-fix.

**Total deviations:** 0 auto-fixed, 1 plan-assumption drift handled per plan's fallback.
**Impact on plan:** None — plan anticipated this path. No scope expansion, no extra files touched.

### Auto-fixed Issues

None.

## Issues Encountered

- **Two reqwest versions in the transitive tree.** `cargo tree -p reqwest` errored with "multiple `reqwest` packages" — our direct `reqwest@0.12.28` plus `reqwest@0.13.2` pulled by some Tauri plugin. Disambiguated via `cargo tree -p reqwest@0.12.28` to confirm our dep uses rustls only (`rustls → rustls-pki-types → rustls-webpki` branch). The 0.13.2 is someone else's concern; our 0.12 is correctly configured.
- **Verification matrix is executor-only.** Live probe testing against a running `python3 -m http.server` + the live Tauri dev console CSP check is deferred to Plan 04-04's UAT checkpoint (the Phase 4 end-to-end human-verify). Executor gates here are `cargo check` + `tsc --noEmit` + the grep suite — all green.
- **Plan originally authored with a stale Cargo.toml snapshot.** The plan-time audit referenced a reqwest line at Cargo.toml line 37 that wasn't actually present. No impact because the plan's Step 1 decision tree covered both paths.

## Next Phase Readiness

Plan 04-04 (UAT end-to-end) can:

- Clone `vercel/commerce` (or any Next.js dev server) into a scratch directory, open it in the app, select a node with a `route` field set (e.g., `/search`).
- With dev server NOT running: switch to Preview tab → confirm "No dev server reachable…" + Retry button renders with the correct URL.
- Start the dev server (`npm run dev` in the target repo → expect http://localhost:3000).
- Click Retry → probe returns `true` within ~100ms → iframe renders the live page.
- Click Reload → iframe remounts and re-navigates (if Next.js HMR is live, the iframe picks up hot updates automatically without needing Reload).
- Open Tauri dev console → confirm zero `Refused to load frame` CSP errors. If `allow-popups` or `allow-downloads` are needed for any commerce page (OAuth, downloads), add to the sandbox attribute at that point.
- Confirm no Monaco worker regressions — load Code tab on the same node, expect no `blob:` CSP errors. The `blob:` directive survived the CSP update.

Phase 9 polish may:

- Add per-node `preview_port` override (currently hardcoded to 3000) for projects that bind elsewhere.
- Replace manual Retry with a small indicator that auto-retries once per 10s while the Preview tab is active AND focused (bail on blur/tab-switch via `document.visibilityState`).
- Widen `frame-src` to include `https://*.vercel.app` for preview-deployment targets.

## Self-Check: PASSED

Files verified on disk:
- `contract-ide/src-tauri/Cargo.toml` — FOUND (one `^reqwest` line, rustls-tls + json + default-features=false present).
- `contract-ide/src-tauri/src/commands/inspector.rs` — FOUND (probe_route present, hash_text + read_contract_frontmatter + read_file_content + open_in_editor all intact).
- `contract-ide/src-tauri/src/lib.rs` — FOUND (probe_route registered alongside other inspector commands).
- `contract-ide/src-tauri/tauri.conf.json` — FOUND (frame-src: localhost + 127.0.0.1; all Phase 1 directives preserved).
- `contract-ide/src/ipc/inspector.ts` — FOUND (probeRoute exported).
- `contract-ide/src/components/inspector/PreviewTab.tsx` — FOUND (real component, min_lines 60 satisfied at ~117 actual lines).

Commits verified in `git log`:
- `f13267a` — FOUND (Task 1: probe_route + frame-src CSP).
- `51d6a5c` — FOUND (Task 2: live PreviewTab).

Automated gates:
- `cargo check` — PASS.
- `npx tsc --noEmit` — PASS (zero output).
- `grep -c "^reqwest" contract-ide/src-tauri/Cargo.toml` → `1`.
- `grep rustls-tls contract-ide/src-tauri/Cargo.toml` → reqwest entry with default-features=false.
- `grep frame-src contract-ide/src-tauri/tauri.conf.json` → match including http://localhost:*.
- `grep probe_route contract-ide/src-tauri/src/lib.rs` → `commands::inspector::probe_route,`.
- `grep probeRoute contract-ide/src/ipc/inspector.ts` → export line present.

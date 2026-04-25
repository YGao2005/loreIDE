# Phase 1 Day-1 Integration Validation Record

**Test date:** 2026-04-24
**Host:** Yang's local dev machine (Apple Silicon, macOS Darwin 25.2.0)
**Tester:** human verifier driving the Day-1 Validation dev panel inside the Tauri app
**Gate reference:** ROADMAP.md Phase 1 success criterion (6) — all three subprocess/hook/sqlite checks must be green inside the Tauri app from BOTH launch modes; Monaco worker (Check D) bundled in as a 4th visual check

---

## Results Matrix — 8/8 PASS

| Check | Terminal launch (`npm run tauri dev`) | Finder launch (`open "Contract IDE.app"`) |
| ----- | ------------------------------------- | ----------------------------------------- |
| **A — claude subprocess via tauri-plugin-shell** | PASS | PASS |
| **B — PostToolUse hook fixture + transcript `input_tokens`** | PASS | PASS |
| **C — pkg-compiled better-sqlite3 binary (`day0-sqlite`)** | PASS | PASS |
| **D — Monaco worker in WKWebView (no "Could not create web worker")** | PASS | PASS |

**Phase 2 gate status:** GREEN

---

## Per-check detail

### Check A — claude subprocess (auth inheritance)

- **What runs:** Rust `test_claude_spawn` → `app.shell().command("claude").args(["-p", "say hello"]).output().await`
- **Terminal launch:** `claude` binary resolved via PATH at `/opt/homebrew/bin/claude`; stdout returned a model response within ~5s; `result.success = true`, `exit_code = 0`. Auth inherited — no manual `HOME` passthrough needed.
- **Finder launch:** Same binary, same stdout shape, same sub-5s response. **Pitfall-4 (env inheritance under Finder-launched .app) did NOT trigger on this machine.** Default tauri-plugin-shell `output()` inherited HOME + PATH correctly.
- **Workarounds applied:** NONE. The speculative fallback paths in the PLAN (hard-code HOME, absolute claude path, `zsh -l -c` wrapper) were all unnecessary.

### Check B — PostToolUse hook fixture + transcript `input_tokens`

- **What runs:** Rust `test_hook_payload_fixture` parses `day0/check2-hook-payload/captures/payload-*.json`, asserts the 5 required shape keys (`session_id`, `transcript_path`, `hook_event_name`, `tool_name`, `tool_input`), then resolves the referenced JSONL transcript (either at its literal path or by basename under `~/.claude/projects/*/*.jsonl`) and proves at least one match contains `input_tokens`.
- **Terminal launch:** Fixture parsed cleanly; `_resolved_transcript_path` pointed at a live JSONL under `~/.claude/projects/*/` containing `input_tokens`. Hard-fail path (absent JSONL / missing `input_tokens`) did not trigger.
- **Finder launch:** Same outcome — fixture and transcript resolution both worked with default env.

### Check C — pkg-compiled better-sqlite3 binary

- **What runs:** Rust `test_pkg_sqlite_binary` spawns `/Users/yang/lahacks/day0/check3-pkg-sqlite/bin/day0-sqlite` via tauri-plugin-shell.
- **Terminal launch:** Binary exists at hard-coded path, executed cleanly, `exit_code = 0`, stdout confirmed a successful SELECT. No module-not-found at runtime — the native `better_sqlite3.node` packaging that day0 proved in isolation also works when spawned from inside the Tauri process.
- **Finder launch:** Same PASS. Confirms the pkg-bundled sqlite layer survives subprocess spawn under both launch modes.

### Check D — Monaco worker (WKWebView)

- **What runs:** "Mount Monaco" button in the Day-1 panel dynamically imports `@monaco-editor/react` and renders a 200×100 editor; human opens the Tauri dev console (Cmd+Option+I) and watches for red `Could not create web worker` errors.
- **Terminal launch:** Editor rendered, dev console clean. Monaco CSP (`blob:` in `script-src` from Plan 01-01) + `vite-plugin-monaco-editor` are wired correctly.
- **Finder launch:** Same PASS. Workers spawn under the `.app` bundle's CSP as well.

---

## Build noise — DMG bundle failure (non-blocking)

`npm run tauri build -- --debug` produced the `.app` artifact (used for the Finder-launch leg) successfully, but the subsequent `bundle_dmg.sh` step failed. The `.app` is the artifact actually used to clear criterion (6), so this is noted as background noise, not a Phase 1 blocker. Action: none required for Phase 1 gate. A follow-up to stabilize DMG packaging is appropriate for Phase 9 polish when distribution surface is built, not earlier.

## Pitfall-4 outcome

RESEARCH.md flagged the subprocess-env-under-Finder-launch risk as the #1 de-risk target for this plan. On this machine, `tauri-plugin-shell`'s default `output()` call inherits HOME + PATH correctly even when the app launches from Finder. **No `HOME` passthrough, no absolute binary path, no `zsh -l -c` wrapper was needed.** Documenting this explicitly because the absence of a workaround is load-bearing — if the first Phase 8 build-machine surface-tests Check A and it suddenly fails, the first debug step is "which env var is missing under Finder launch on THIS machine" rather than "rebuild the whole subprocess pipeline."

---

## Sign-off

All 8 cells green. Phase 1 success criterion (6) is satisfied from both launch modes. Phase 2 planning is unblocked.

*Validation record: 2026-04-24*

---
phase: 09-mass-edit-non-coder-mode-demo-repo-seeding
plan: 04b
type: execute
wave: 2
depends_on:
  - "09-04"
files_modified:
  - contract-ide-demo/contract-uuid-plugin/index.ts
  - contract-ide-demo/contract-uuid-plugin/package.json
  - contract-ide-demo/next.config.ts
  - contract-ide-demo/.contracts/.spike/account-settings-spike-page.tsx
  - contract-ide-demo/.contracts/.spike/spike-atom.md
  - contract-ide/src-tauri/src/sidecar/jsx_align_validator.rs
  - contract-ide/src-tauri/src/sidecar/backend_section_validator.rs
  - contract-ide/src-tauri/src/sidecar/mod.rs
  - contract-ide/src-tauri/src/commands/repo.rs
  - contract-ide/src/lib/repo-load.ts
  - .planning/demo/contract-ide-demo-spec.md
autonomous: false
requirements:
  - BABEL-01
  - JSX-01
  - BACKEND-FM-01

must_haves:
  truths:
    - "Day-1 click-resolution spike (Task 1) PASSES before any other Phase 9 plan downstream of 09-04 commits — the spike validates the full chain end-to-end: plugin injects `data-contract-uuid` on a single JSX element, iframe loads it, click on the rendered region resolves to the correct UUID, inspector opens for that atom. If the spike fails (HMR / cross-origin / pan-zoom interference), the fallback is bounding-rect chip-overlay (chip layer in Tauri WebView queries iframe `getBoundingClientRect` via `postMessage` instead of DOM injection); the fallback decision is documented in 09-04b-SUMMARY.md and reflected in any Phase 13 chip layer plans"
    - "Babel/SWC plugin reads `.contracts/*.md` frontmatter at build time, identifies L4 atoms whose `code_ranges` point into `.tsx` files in the demo repo, and injects `data-contract-uuid=\"<uuid>\"` on the matched JSX element. Plugin runs in `next.config.ts` (default Next.js loader chain) and re-runs on every demo-repo build; HMR preserves the attribute mapping (verified by the spike)"
    - "After plugin runs against the seeded contract-ide-demo repo, every JSX element identified by an L4 contract's `code_ranges` carries the matching `data-contract-uuid` attribute — verifiable by `grep -rn 'data-contract-uuid' .next/` after `pnpm build` AND by inspecting rendered DOM in the iframe via `document.querySelectorAll('[data-contract-uuid]').length` ≥ count of L4 UI atoms"
    - "JSX-01 startup validator (jsx_align_validator.rs): on repo-open, walks every L4 contract whose kind is UI and parses the cited `code_ranges` line range as TypeScript/JSX AST (via `swc_ecma_parser` already in Cargo.toml or a new dep) — if the range covers more than one JSX element OR a partial JSX subtree (open tag without close), the IDE refuses to load the repo with a loud error containing the file path + offending range. Backend kinds (`API / lib / data / external / job / cron / event`) are EXEMPT from this check (they don't have JSX targets)"
    - "BACKEND-FM-01 startup validator (backend_section_validator.rs): on repo-open, walks every backend-kind contract (API / lib / data / external / job / cron / event) and confirms the body has `## Inputs`, `## Outputs`, AND `## Side effects` sections. Missing required sections produce a loud startup error with the file path. Section detection reuses Phase 8 PROP-01's `section_parser.rs` (single source of truth) — does NOT duplicate parser logic"
    - "Both validators run inside the existing repo-load command path (commands/repo.rs); failure is surfaced to the React UI as a non-toast error banner (so it's persistent, not dismissible) — pattern reuses the existing repo-load error display from Plans 02-04 / 06-NN"
    - "The 4 scenario L4 atoms (a1000000, b1000000, plus 2 atoms inside DangerZone scaffolds added during Beat 1 / Beat 4 — those are filled by the agent live, so the validator must permit empty `code_ranges` ON L4 atoms with empty bodies during demo execution) and the ambient L4 atoms in 09-04 all pass JSX-01"
    - "All backend ambient contracts authored in 09-04 (e.g., POST /api/account/delete, beginAccountDeletion lib function, db.user.update data atom, mailchimp.suppress external atom) pass BACKEND-FM-01 — populated `## Inputs` / `## Outputs` / `## Side effects` sections required by the validator are present in the seed"
    - "next.config.ts is committed to the contract-ide-demo repo at the locked SHA referenced in 09-04-SUMMARY.md, so 09-05's reset script restores the plugin configuration along with the rest of the demo repo state"
  artifacts:
    - path: "contract-ide-demo/contract-uuid-plugin/index.ts"
      provides: "Build-time plugin that reads .contracts/*.md frontmatter for L4 UI atoms and injects data-contract-uuid on matched JSX. Implementation strategy: lift the AST-walk pattern from `react-dev-inspector` (https://github.com/zthxxx/react-dev-inspector) or `click-to-component`, swap source-line metadata for .contracts frontmatter as the lookup table"
      exports: ["contractUuidPlugin"]
      min_lines: 80
    - path: "contract-ide-demo/contract-uuid-plugin/package.json"
      provides: "Local workspace package consumed by next.config.ts via relative path; depends on @swc/core (or @babel/parser if SWC plugin route proves heavy) + js-yaml for frontmatter parsing"
      contains: "contract-uuid-plugin"
    - path: "contract-ide-demo/next.config.ts"
      provides: "Next.js config loading the contract-uuid plugin via webpack rule (Babel transform path) or experimental.swcPlugins (SWC path); plugin runs on .tsx files only"
      contains: "contract-uuid-plugin"
    - path: "contract-ide/src-tauri/src/sidecar/jsx_align_validator.rs"
      provides: "AST-based validator: for each L4 UI contract, parse the cited file's content at the code_ranges line range; assert the range covers exactly one JSX element. Returns Vec<JsxAlignmentError>"
      exports: ["validate_jsx_alignment"]
      min_lines: 100
    - path: "contract-ide/src-tauri/src/sidecar/backend_section_validator.rs"
      provides: "Section validator: for each backend-kind contract, run section_parser.rs (Phase 8 PROP-01) and assert ## Inputs / ## Outputs / ## Side effects are all present. Returns Vec<MissingSectionError>"
      exports: ["validate_backend_sections"]
      min_lines: 60
    - path: "contract-ide/src-tauri/src/commands/repo.rs"
      provides: "EXTENDED — repo-load command runs validate_jsx_alignment + validate_backend_sections after the existing scan; on any error, returns a structured error to the frontend (which renders a persistent banner, not a toast)"
      contains: "validate_jsx_alignment"
    - path: ".planning/demo/contract-ide-demo-spec.md"
      provides: "EXTENDED — adds a 'BABEL-01 spike result' section noting whether the Day-1 spike passed (canonical Babel/SWC route) or fell back to bounding-rect chip-overlay; whichever is committed is the route Phase 13 builds against"
      contains: "BABEL-01 spike"
  key_links:
    - from: "contract-ide-demo/contract-uuid-plugin/index.ts"
      to: "contract-ide-demo/.contracts/*.md (L4 UI atoms with code_ranges)"
      via: "Plugin enumerates .contracts/*.md at build start, parses frontmatter, builds Map<filepath, Vec<{uuid, line_range}>>; during AST walk per .tsx file, when JSX element's source span overlaps a known line range AND that JSX element is the OUTERMOST element fully contained in the range, inject the data-contract-uuid attribute"
      pattern: "data-contract-uuid"
    - from: "contract-ide/src-tauri/src/sidecar/jsx_align_validator.rs"
      to: "contract-ide-demo/.contracts/*.md L4 UI atoms"
      via: "After repo-load scan populates nodes table, validator queries nodes WHERE level='L4' AND kind='UI', reads each contract's code_ranges, and re-parses the cited .tsx files via swc_ecma_parser to assert single-element coverage. Failures bubble through commands/repo.rs to the frontend banner"
      pattern: "validate_jsx_alignment"
    - from: "contract-ide/src-tauri/src/sidecar/backend_section_validator.rs"
      to: "contract-ide/src-tauri/src/sidecar/section_parser.rs (Phase 8 PROP-01)"
      via: "Reuses Phase 8's canonical section parser to detect ## Inputs / ## Outputs / ## Side effects — does NOT duplicate parser logic. validate_backend_sections invokes parse_sections() on each backend contract's body and asserts the three required keys exist"
      pattern: "section_parser|parse_sections"
    - from: "contract-ide-demo/next.config.ts"
      to: "contract-ide-demo/contract-uuid-plugin/index.ts"
      via: "next.config.ts imports the plugin via relative path (./contract-uuid-plugin); registers it on the webpack rule for .tsx (Babel transform path) or experimental.swcPlugins (SWC path); decision documented in 09-04b-SUMMARY.md"
      pattern: "contract-uuid-plugin"
---

<objective>
Land BABEL-01 + JSX-01 + BACKEND-FM-01: a build-time plugin in the demo repo that injects `data-contract-uuid` on JSX elements identified by L4 UI atom contracts, plus two AST-based startup validators in the IDE that refuse to load the repo if any L4 UI atom's `code_ranges` doesn't align to a single JSX element OR any backend-kind contract is missing required `## Inputs` / `## Outputs` / `## Side effects` sections.

Purpose: This plan is the load-bearing seam for Beat 1's *"PM clicks the rendered Danger Zone region in the iframe → inspector opens for that atom"* mechanic. Without `data-contract-uuid` on JSX, the click-to-atom resolution chain has nothing to dispatch on. The Day-1 spike (Task 1) is an explicit gate — if the Babel/SWC route proves fragile under HMR or cross-origin iframe constraints, this plan ships the bounding-rect chip-overlay fallback instead (chip layer in the Tauri WebView queries iframe `getBoundingClientRect` via `postMessage`; same UX, no DOM injection). Whichever wins becomes Phase 13's CHIP-01 dependency.

Output: Plugin in demo repo + 2 startup validators in IDE + Day-1 spike result documented in spec doc. NO Phase 13 chip rendering (CHIP-01/02/03 ships in Phase 13 — this plan only delivers the resolution primitive). NO contract-ide-demo provisioning beyond the plugin + next.config wiring (09-04 ships scaffold; 09-04c ships flow contracts).
</objective>

<execution_context>
@/Users/yang/.claude/get-shit-done/workflows/execute-plan.md
@/Users/yang/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/CANVAS-PURPOSE.md
@.planning/phases/09-mass-edit-non-coder-mode-demo-repo-seeding/09-RESEARCH.md
@.planning/phases/09-mass-edit-non-coder-mode-demo-repo-seeding/09-04-SUMMARY.md
@.planning/demo/scenario-criteria.md
@.planning/demo/presentation-script.md

# Phase 8 PROP-01 section parser dependency
@.planning/phases/08-agent-loop-receipts-posttooluse-hook-cherrypick-cross-level-propagation/08-01-PLAN.md

# Existing repo-load command this plan extends
@contract-ide/src-tauri/src/commands/repo.rs
@contract-ide/src-tauri/src/sidecar/section_parser.rs
</context>

<tasks>

<task type="auto" gate="blocking-spike">
  <name>Task 1: Day-1 click-resolution spike — gate before full plugin commit</name>
  <files>contract-ide-demo/.contracts/.spike/account-settings-spike-page.tsx, contract-ide-demo/.contracts/.spike/spike-atom.md, contract-ide-demo/contract-uuid-plugin/index.ts (minimal version), contract-ide-demo/next.config.ts (spike configuration)</files>
  <action>
    NOTE: Per ROADMAP.md:191 (Phase 9 planning notes), the Day-1 spike *must pass before committing the rest of Phase 9 plan work*. This task validates the full click-resolution chain end-to-end against a single contract atom on a single JSX element. If it fails, the spike result drives a fallback decision documented in 09-04b-SUMMARY.md before any other plan in 09-04b proceeds.

    1. **Verify 09-04 is complete.** Read `09-04-SUMMARY.md` and confirm:
       - `Locked SHA:` line present
       - `app/account/settings/page.tsx` scaffold exists with the Danger Zone section + heading + empty body (per 09-04 plan Step 5)
       - `pnpm dev` boots the demo repo

       If any check fails, halt and surface to user — 09-04 must be re-run before this spike.

    2. **Author a minimal spike contract** at `contract-ide-demo/.contracts/.spike/spike-atom.md`:
       ```markdown
       ---
       format_version: 3
       uuid: spike-0000-0000-4000-8000-000000000001
       kind: UI
       level: L4
       parent: a0000000-0000-4000-8000-000000000000
       code_ranges:
         - file: app/account/settings/page.tsx
           start_line: 60
           end_line: 80
       human_pinned: false
       ---

       ## Intent
       Spike contract to validate BABEL-01 click-resolution chain.

       ## Role
       Spike target. Removed after spike passes.
       ```

       Note: this points the same code_ranges as the production a1000000 DangerZone L4 atom. The spike is testing the *plugin mechanism*, not the contract content. The `.spike/` subdirectory keeps it scoped — committed in this task, removed in Task 2 once the canonical plugin is verified against all L4 atoms.

    3. **Build a minimal plugin** at `contract-ide-demo/contract-uuid-plugin/index.ts` (spike version — full plugin in Task 2):

       Implementation strategy: lift ~80% from `react-dev-inspector` (https://github.com/zthxxx/react-dev-inspector) and modify to read `.contracts/*.md` frontmatter as the lookup table instead of `__source` metadata. Two routes; pick at spike time based on which is less invasive:

       **Route A — Babel transform via Webpack rule (preferred for HMR robustness):**
       ```typescript
       // contract-uuid-plugin/index.ts
       import * as fs from 'node:fs';
       import * as path from 'node:path';
       import { parse } from 'yaml';

       interface AtomLookup { uuid: string; file: string; start: number; end: number }

       function loadAtoms(repoRoot: string): Map<string, AtomLookup[]> {
         // Walk .contracts/*.md (and .contracts/ambient/*.md), read frontmatter,
         // index by file path in code_ranges. Return Map<absolute_path, atoms[]>.
         // Filter to kind: UI && level: L4.
       }

       export function contractUuidPlugin(repoRoot: string) {
         const atomsByFile = loadAtoms(repoRoot);
         return {
           visitor: {
             JSXOpeningElement(jsxPath: any, state: any) {
               const filename = state.filename;  // absolute .tsx path
               const atoms = atomsByFile.get(filename);
               if (!atoms) return;
               const { line: startLine } = jsxPath.node.loc?.start ?? {};
               const { line: endLine } = jsxPath.node.loc?.end ?? {};
               const match = atoms.find(a =>
                 a.start <= startLine && endLine <= a.end &&
                 // Element is OUTERMOST contained in the range — parent is not contained
                 !atoms.some(b => b !== a && b.start <= a.start && a.end <= b.end &&
                                  jsxPath.parentPath?.node.type === 'JSXElement')
               );
               if (!match) return;
               // Inject data-contract-uuid="<uuid>"
               jsxPath.node.attributes.push({
                 type: 'JSXAttribute',
                 name: { type: 'JSXIdentifier', name: 'data-contract-uuid' },
                 value: { type: 'StringLiteral', value: match.uuid },
               });
             },
           },
         };
       }
       ```

       Wire in `next.config.ts` via webpack rule:
       ```typescript
       import type { NextConfig } from 'next';
       import path from 'node:path';
       import { contractUuidPlugin } from './contract-uuid-plugin';

       const config: NextConfig = {
         webpack: (config, { dev }) => {
           config.module.rules.push({
             test: /\.tsx$/,
             use: [
               {
                 loader: 'babel-loader',
                 options: {
                   plugins: [contractUuidPlugin(__dirname)],
                 },
               },
             ],
           });
           return config;
         },
       };
       export default config;
       ```

       **Route B — SWC plugin (canonical Next.js path; faster but heavier to author):**
       ```typescript
       // experimental.swcPlugins entry — requires Rust crate; spike Route A first
       ```

       Spike on Route A first because Babel-loader is simpler to debug and Route B requires authoring a Rust SWC plugin which is its own engineering project. Route B is a v2 polish if Route A's HMR has any latency.

    4. **Run the spike.** From `contract-ide-demo/`:
       ```bash
       pnpm install  # picks up contract-uuid-plugin if linked
       pnpm dev
       ```

       Open `http://localhost:3000/account/settings` in a browser (NOT the IDE iframe — testing raw plugin first). View source / inspect DOM:
       ```javascript
       // In browser console
       document.querySelectorAll('[data-contract-uuid]')
       ```
       Expect: at least 1 element with `data-contract-uuid="spike-0000-..."` corresponding to the Danger Zone section element.

       If injection succeeds → proceed to Step 5. If not, debug the plugin (typically: file-path mismatch between `state.filename` and `.contracts` `code_ranges.file` — code_ranges is repo-relative; state.filename is absolute; need to normalize).

    5. **Test HMR.** With `pnpm dev` running, edit `app/account/settings/page.tsx` (e.g., change a heading text). Save. Verify the page hot-reloads AND the `data-contract-uuid` attribute is still present after reload. If HMR strips the attribute or breaks injection, this is the documented Babel-fragility-under-HMR scenario.

    6. **Test in the IDE iframe.** Launch contract-ide (`cd ../contract-ide && npm run tauri dev`), open the demo repo, and trigger the L3 trigger card view (Phase 13's full L3 view ships in Phase 13 — for the spike, just verify that the Tauri WebView's iframe of `localhost:3000/account/settings` shows the same DOM via dev-tools or via a temporary `console.log(document.querySelectorAll('[data-contract-uuid]').length)` injected from the parent WebView via `postMessage`).

       Spike pass criteria:
       - At least 1 JSX element in the rendered iframe DOM has `data-contract-uuid="spike-..."` matching the spike contract.
       - Reading the attribute via `postMessage` from the parent WebView returns the UUID.
       - HMR preserves the attribute (verified in Step 5).

       If any criterion fails AND no fix is obvious, the canonical Babel route is FRAGILE. Document the failure mode in 09-04b-SUMMARY.md and proceed to the bounding-rect fallback (Task 2 fallback path).

    7. **Document spike result** in `.planning/demo/contract-ide-demo-spec.md` (extend existing spec doc):
       ```markdown
       ## BABEL-01 spike result

       **Route attempted:** Babel transform via webpack rule
       **Spike date:** <ISO timestamp>
       **Result:** PASS | FAIL — fell back to bounding-rect chip-overlay
       **HMR test:** PASS | FAIL
       **Iframe test:** PASS | FAIL
       **Failure mode (if any):** <describe>
       **Decision:** ship Route A (Babel) | ship Route B (SWC plugin) | ship fallback (getBoundingClientRect chip-overlay)
       ```

       The decision recorded here is the route Task 2 implements and what Phase 13's CHIP-01 will build against.

    8. **Cleanup spike artifacts before Task 2.** Remove `.contracts/.spike/` (or move to a `.archive/` subdir if useful for documentation). The plugin code stays — Task 2 extends it.
  </action>
  <verify>
    - Spike contract exists at `.contracts/.spike/spike-atom.md` (or was archived after spike).
    - `data-contract-uuid` attribute observable in rendered DOM at `http://localhost:3000/account/settings`.
    - HMR test passed: edit a file, attribute preserved on reload.
    - Iframe test passed (or fallback decision documented).
    - `.planning/demo/contract-ide-demo-spec.md` contains the BABEL-01 spike result section with PASS/FAIL + decision.
  </verify>
  <done>
    Day-1 spike PASSED with Route A (Babel webpack rule) — full plugin in Task 2 extends this; OR spike FAILED and fallback decision documented in spec doc + 09-04b-SUMMARY.md, in which case Task 2 implements bounding-rect chip-overlay instead. Either way, the route is locked before Task 2 begins.
  </done>
</task>

<task type="auto">
  <name>Task 2: Full plugin (or fallback) + JSX-01 validator + BACKEND-FM-01 validator + repo-load wiring</name>
  <files>contract-ide-demo/contract-uuid-plugin/index.ts, contract-ide-demo/contract-uuid-plugin/package.json, contract-ide-demo/next.config.ts, contract-ide/src-tauri/src/sidecar/jsx_align_validator.rs, contract-ide/src-tauri/src/sidecar/backend_section_validator.rs, contract-ide/src-tauri/src/sidecar/mod.rs, contract-ide/src-tauri/src/commands/repo.rs, contract-ide/src/lib/repo-load.ts</files>
  <action>
    NOTE: Branch on Task 1 spike result. If spike PASSED with Route A (Babel webpack rule), Steps 1-3 implement the full plugin against all L4 UI atoms. If spike FAILED, Steps 1-3 implement the bounding-rect fallback instead (chip overlay layer in Tauri WebView; no DOM injection). Steps 4-7 (validators + repo-load wiring) are unchanged regardless of route.

    1. **Full plugin implementation** (Babel route — assumes spike passed):

       Extend `contract-uuid-plugin/index.ts` from the spike version:
       - Walk `.contracts/*.md` AND `.contracts/ambient/*.md` (recursive) at module-load time
       - Cache the atoms-by-file Map in module scope (rebuilt only on plugin re-instantiation)
       - Filter to `kind: UI && level: L4` (other kinds + levels skipped — they don't have JSX targets)
       - For each `.tsx` file processed, walk JSX opening elements; for each element whose source range falls inside a known atom's `code_ranges`, inject the attribute
       - Disambiguation rule: when an atom's range covers nested JSX, inject on the OUTERMOST element fully contained in the range (per the JSX-01 single-element invariant)
       - Idempotent: if `data-contract-uuid` already exists on an element, skip (avoids double-injection on HMR re-render)
       - Edge case: empty range / range pointing to a deleted file → log a build-time warning, do not error (Beat 1's a1000000 starts with empty body and zero JSX inside Danger Zone — that's expected for the start-of-demo state)

    1'. **Fallback implementation** (only if spike failed):

       Replace plugin chain with a chip-overlay layer:
       - Tauri WebView parent listens for iframe `postMessage` events with rect data
       - On L3 trigger card mount, parent sends `postMessage({ type: 'request_rects', selectors: [...] })` to the iframe
       - A small inline script injected via `next.config.ts` `headers` or via a thin client component listens for the request, runs `document.querySelectorAll(selector).getBoundingClientRect()` for each contract atom's selector (heuristic: use file:line as a CSS selector via a build-time data attribute hack OR fall back to user-authored `data-contract-uuid` in the .tsx scaffolds — manually annotated, not plugin-injected)
       - Fallback is more brittle than the plugin route but is what unblocks the demo if Babel proves unworkable
       - Document the chosen disambiguation strategy in 09-04b-SUMMARY.md so Phase 13's CHIP-01 plan knows what to build against

    2. **Plugin package.json** at `contract-ide-demo/contract-uuid-plugin/package.json`:
       ```json
       {
         "name": "contract-uuid-plugin",
         "version": "0.1.0",
         "main": "./index.ts",
         "private": true,
         "dependencies": {
           "yaml": "^2.0.0"
         },
         "peerDependencies": {
           "@babel/core": "^7.0.0"
         }
       }
       ```
       From `contract-ide-demo/`: `pnpm install` to link the local workspace package.

    3. **next.config.ts wiring** — register the plugin per the route chosen in Task 1. If Babel route, the webpack rule from spike Step 3 is the production config. If SWC route, register in `experimental.swcPlugins`. If fallback, `next.config.ts` has no plugin entry and the chip-overlay is wired client-side.

       From `contract-ide-demo/`:
       - `pnpm build` succeeds.
       - `pnpm dev` boots; visiting `/account/settings` shows the rendered page with `data-contract-uuid` attributes on identified JSX elements (verify via browser dev-tools).
       - `grep -rn 'data-contract-uuid' .next/` shows the attributes in the build output.

    4. **JSX-01 validator** at `contract-ide/src-tauri/src/sidecar/jsx_align_validator.rs`. Integration point: existing `commands/repo.rs` repo-load command. Implementation:
       ```rust
       use serde::Serialize;

       #[derive(Debug, Serialize)]
       pub struct JsxAlignmentError {
           pub uuid: String,
           pub file: String,
           pub start_line: usize,
           pub end_line: usize,
           pub reason: String,  // "covers multiple JSX elements" | "covers partial JSX subtree" | "file not parseable"
       }

       /// For each L4 UI contract, parse the cited file as TS/JSX AST and assert
       /// the code_ranges line range covers exactly one JSX element. Backend kinds
       /// (API / lib / data / external / job / cron / event) are EXEMPT — JSX
       /// alignment doesn't apply.
       pub fn validate_jsx_alignment(
           repo_root: &std::path::Path,
           contracts: &[ContractRecord],
       ) -> Vec<JsxAlignmentError> {
           let mut errors = Vec::new();
           for c in contracts {
               if c.level != "L4" || c.kind != "UI" { continue; }
               for range in &c.code_ranges {
                   let file_path = repo_root.join(&range.file);
                   let Ok(source) = std::fs::read_to_string(&file_path) else {
                       errors.push(JsxAlignmentError { /* file not parseable */ });
                       continue;
                   };
                   match parse_and_check_single_jsx(&source, range.start_line, range.end_line) {
                       Ok(()) => {},
                       Err(reason) => errors.push(JsxAlignmentError {
                           uuid: c.uuid.clone(),
                           file: range.file.clone(),
                           start_line: range.start_line,
                           end_line: range.end_line,
                           reason,
                       }),
                   }
               }
           }
           errors
       }

       fn parse_and_check_single_jsx(source: &str, start: usize, end: usize) -> Result<(), String> {
           // Parse source as TS/JSX via swc_ecma_parser (already in Cargo.toml or add).
           // Walk AST, collect JSX opening elements whose span overlaps [start, end].
           // Assert: exactly one OUTERMOST JSX element fully contained in the range.
           // Returns Err("covers N JSX elements" | "covers partial JSX subtree") on violation.
       }
       ```
       SWC dependency: if `swc_ecma_parser` isn't already in `src-tauri/Cargo.toml`, add it. Common alternatives if SWC is heavy: `tree-sitter-typescript` (already lighter; common in editor tooling) or `oxc_parser` (Rust-native, fast). Pick whichever Phase 7 watcher already uses if any; if none, default to `swc_ecma_parser` since it's the spec-canonical TS/JSX parser.

       Empty-body exception: an L4 atom with empty contract body AND empty code_ranges — like a1000000 at the start of Beat 1 — passes the validator (no range to check). The validator only fires on non-empty ranges.

    5. **BACKEND-FM-01 validator** at `contract-ide/src-tauri/src/sidecar/backend_section_validator.rs`:
       ```rust
       use serde::Serialize;

       #[derive(Debug, Serialize)]
       pub struct MissingSectionError {
           pub uuid: String,
           pub file: String,
           pub missing: Vec<String>,  // ["Inputs", "Outputs", "Side effects"] — subset
       }

       const REQUIRED_SECTIONS: &[&str] = &["Inputs", "Outputs", "Side effects"];
       const BACKEND_KINDS: &[&str] = &["API", "lib", "data", "external", "job", "cron", "event"];

       /// For each backend-kind contract, run section_parser.rs (Phase 8 PROP-01)
       /// and assert the body has all three required sections. Section detection
       /// reuses the canonical parser — does NOT duplicate logic.
       pub fn validate_backend_sections(
           contracts: &[ContractRecord],
       ) -> Vec<MissingSectionError> {
           let mut errors = Vec::new();
           for c in contracts {
               if !BACKEND_KINDS.contains(&c.kind.as_str()) { continue; }
               // section_parser.rs::parse_sections returns Result<Sections, _>
               // where Sections is a HashMap<String, String> keyed by H2 section name.
               let Ok(sections) = crate::sidecar::section_parser::parse_sections(&c.body) else {
                   continue;  // parser error logged by Phase 8; not this validator's job
               };
               let missing: Vec<String> = REQUIRED_SECTIONS.iter()
                   .filter(|name| !sections.contains_key(&name.to_lowercase()))
                   .map(|n| n.to_string())
                   .collect();
               if !missing.is_empty() {
                   errors.push(MissingSectionError {
                       uuid: c.uuid.clone(),
                       file: c.source_file.clone(),
                       missing,
                   });
               }
           }
           errors
       }
       ```

       Note on case sensitivity: Phase 8 PROP-01 stores section names as lowercase keys (e.g., `inputs` not `Inputs`); the validator must match that convention. If the canonical parser preserves case, adjust the comparison. This needs spot-check against `section_parser.rs` at execution time — document the chosen comparison in 09-04b-SUMMARY.md.

    6. **Wire validators into commands/repo.rs** repo-load path:
       ```rust
       pub async fn load_repo(repo_path: String, ...) -> Result<LoadResult, RepoLoadError> {
           // Existing scan code
           let contracts = scan_contracts(&repo_path)?;
           insert_into_nodes_table(&contracts)?;

           // NEW: Phase 9 09-04b validators
           let jsx_errors = validate_jsx_alignment(&repo_root, &contracts);
           let section_errors = validate_backend_sections(&contracts);
           if !jsx_errors.is_empty() || !section_errors.is_empty() {
               return Err(RepoLoadError::ValidationFailed { jsx_errors, section_errors });
           }
           Ok(LoadResult { ... })
       }
       ```

       The frontend's `src/lib/repo-load.ts` (or equivalent existing path) handles `RepoLoadError::ValidationFailed` by displaying a persistent banner (NOT a toast — toasts dismiss too quickly; the user must fix the underlying contract before continuing). Reuse the existing repo-load error display from Plans 02-04 / 06-NN if any; otherwise add a small persistent error component.

    7. **Verify validators against the seeded demo repo.** From `/Users/yang/lahacks/`:
       ```bash
       cd contract-ide && npm run tauri dev
       # In the IDE: Cmd+O → /Users/yang/lahacks/contract-ide-demo
       # Expect: repo loads cleanly. All 4 scenario UI L4 atoms (a1000000, b1000000, plus the
       # ambient L4 UI atoms from 09-04) pass JSX-01. All backend ambient contracts
       # (API / lib / data / external) pass BACKEND-FM-01.
       ```

       Negative test: temporarily edit one ambient L4 UI atom's `code_ranges` to span 2 JSX elements (e.g., `start_line: 50, end_line: 200`). Re-open the repo; expect the persistent error banner to appear naming the offending atom + range. Restore the original range.

       Negative test 2: temporarily delete `## Inputs` from one ambient backend contract. Re-open; expect a banner naming the missing section. Restore.

    8. **Commit:**
       ```bash
       node /Users/yang/.claude/get-shit-done/bin/gsd-tools.cjs commit "feat(09-04b): contract-uuid plugin + JSX-01 + BACKEND-FM-01 startup validators" \
         --files contract-ide-demo/contract-uuid-plugin/index.ts \
                 contract-ide-demo/contract-uuid-plugin/package.json \
                 contract-ide-demo/next.config.ts \
                 contract-ide/src-tauri/src/sidecar/jsx_align_validator.rs \
                 contract-ide/src-tauri/src/sidecar/backend_section_validator.rs \
                 contract-ide/src-tauri/src/sidecar/mod.rs \
                 contract-ide/src-tauri/src/commands/repo.rs \
                 contract-ide/src/lib/repo-load.ts
       ```

       Demo repo commits (separate repo): `git commit -am "feat: add contract-uuid plugin + next.config.ts wiring"` from `contract-ide-demo/`. Update the locked SHA in `.planning/demo/contract-ide-demo-spec.md`.
  </action>
  <verify>
    From `contract-ide-demo/`:
    - `pnpm build` clean.
    - `pnpm dev` boots; `data-contract-uuid` attributes appear on identified JSX elements per the route chosen in Task 1.
    - Locked SHA in spec doc updated to include this plan's commits.

    From `contract-ide/`:
    - `cargo check` (or full `npm run tauri build` smoke) clean.
    - Open contract-ide-demo via Cmd+O — repo loads without error banner.
    - Negative test: introduce a JSX-01 violation → repo refuses to load with persistent banner naming the atom + range.
    - Negative test: introduce a missing `## Inputs` on a backend contract → repo refuses to load with persistent banner naming the missing section.
  </verify>
  <done>
    BABEL-01 plugin (Route A Babel webpack rule, OR Route B SWC plugin, OR bounding-rect fallback per Task 1 spike result) ships in contract-ide-demo. JSX-01 + BACKEND-FM-01 startup validators ship in contract-ide src-tauri. repo-load command refuses to load on validation failure with persistent banner. Negative tests confirm both validators fire on real violations. Locked SHA updated in spec doc.
  </done>
</task>

</tasks>

<verification>
- 09-04 dependency gate passed (09-04-SUMMARY.md with Locked SHA + scaffolds present).
- Day-1 spike result documented in `.planning/demo/contract-ide-demo-spec.md` (PASS Route A | PASS Route B | FAIL → fallback).
- contract-uuid-plugin (or fallback chip-overlay layer) ships in contract-ide-demo with next.config.ts wiring.
- `data-contract-uuid` attributes observable in rendered DOM at L4 UI atoms identified by .contracts/*.md frontmatter (Babel/SWC routes), OR chip-overlay layer renders against bounding-rect query (fallback route).
- HMR test passed during spike (Babel route only — fallback is HMR-independent).
- jsx_align_validator.rs + backend_section_validator.rs ship in src-tauri/src/sidecar/.
- repo-load command runs both validators after scan; on any error, refuses to load with persistent banner.
- All 4 scenario L4 UI atoms (a1000000, b1000000) and all ambient L4 UI atoms from 09-04 pass JSX-01.
- All ambient backend contracts (API / lib / data / external / job / cron / event) from 09-04 pass BACKEND-FM-01.
- Negative tests verified: JSX-01 violation → persistent banner; missing backend section → persistent banner.
- 09-04b-SUMMARY.md documents: spike route chosen, fallback decision (if any), validator parser dependency (swc vs tree-sitter vs oxc), section-name case-sensitivity convention.
</verification>

<success_criteria>
- BABEL-01: build-time plugin in contract-ide-demo injects `data-contract-uuid` on JSX elements identified by L4 UI atom `code_ranges`. HMR preserves attribute mapping. (Or fallback: bounding-rect chip-overlay achieves the same UX without DOM injection.)
- JSX-01: AST-based startup validator confirms every L4 UI contract's `code_ranges` covers exactly one JSX element; refuses to load repo on violation with persistent banner.
- BACKEND-FM-01: startup validator confirms every backend-kind contract has populated `## Inputs` / `## Outputs` / `## Side effects`; refuses to load on violation with persistent banner.
- Phase 13 CHIP-01 dependency: the resolution primitive (chip-to-atom mapping) is verified end-to-end via the Day-1 spike before any Phase 13 chip rendering plan begins.
- 4-beat demo unblock: Beat 1's "PM clicks the rendered Danger Zone region in the iframe → inspector opens" mechanic has its load-bearing seam shipped here.
</success_criteria>

<output>
After completion, create `.planning/phases/09-mass-edit-non-coder-mode-demo-repo-seeding/09-04b-SUMMARY.md` documenting:
- Day-1 spike result (PASS Route A | PASS Route B | FAIL → fallback) with timestamp + failure mode if applicable.
- Plugin route chosen (Babel webpack rule | SWC plugin | bounding-rect fallback) + rationale.
- AST parser chosen for JSX-01 validator (swc_ecma_parser vs tree-sitter-typescript vs oxc_parser) + rationale.
- Section-name case-sensitivity convention (verified against section_parser.rs at execution time).
- Whether the empty-range exception (a1000000 / b1000000 starting empty) caused validator false-positives + how resolved.
- Negative-test results (JSX-01 violation banner test + BACKEND-FM-01 missing-section banner test).
- Confirmed Locked SHA in `.planning/demo/contract-ide-demo-spec.md` reflects the demo repo state including the plugin + next.config.ts.
- Phase 13 CHIP-01 prerequisite confirmed: resolution chain works end-to-end against the seeded contracts.
</output>
</content>

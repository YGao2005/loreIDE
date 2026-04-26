---
phase: 14-codebase-to-contracts-bootstrap-skill-demo-application
plan: 01b
type: execute
wave: 1
depends_on: []
files_modified:
  - .agents/skills/codebase-to-contracts/package.json
  - .agents/skills/codebase-to-contracts/.gitignore
  - .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js
  - .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-package.json
  - .agents/skills/codebase-to-contracts/templates/next-config-snippet.ts
  - .agents/skills/codebase-to-contracts/scripts/helpers/deterministic-uuid.mjs
  - .agents/skills/codebase-to-contracts/scripts/helpers/claude-cli-bridge.mjs
  - .agents/skills/codebase-to-contracts/scripts/helpers/frontmatter-writer.mjs
  - .agents/skills/codebase-to-contracts/scripts/helpers/babel-parser-bridge.mjs
  - .agents/skills/codebase-to-contracts/scripts/helpers/__tests__/deterministic-uuid.test.mjs
  - .agents/skills/codebase-to-contracts/scripts/helpers/__tests__/frontmatter-writer.test.mjs
  - .agents/skills/codebase-to-contracts/scripts/helpers/__tests__/schema-rust-parity.test.mjs
autonomous: true
requirements:
  - BOOTSTRAP-01  # [proposed] Skill exists, invocable as /codebase-to-contracts <repo> — completes the foundation 14-01a started

must_haves:
  truths:
    - "Helper scripts produce deterministic UUIDv5 + round-trip-safe YAML frontmatter that matches contract-ide-demo seeded sidecars byte-for-byte"
    - "Babel webpack loader template is a verbatim copy of contract-ide-demo/contract-uuid-plugin/index.js (no rewrite)"
    - "Skill ships its own package.json with bundled deps (tinyglobby, js-yaml, @babel/parser, @babel/traverse) — pnpm install at the skill dir resolves dependencies regardless of target repo's package manager"
    - "Skill's node_modules is committed to repo (Yang ratification: bundled-deps strategy per RESEARCH Pattern 5) so the skill is self-contained at clone time, no setup step"
    - "Schema-vs-Rust parity smoke asserts every non-Option Rust field on Frontmatter struct appears in schemas/frontmatter.json required[] (Phase 14 revision Issue 12)"
  artifacts:
    - path: ".agents/skills/codebase-to-contracts/package.json"
      provides: "Skill's own dependency manifest — tinyglobby, js-yaml, @babel/parser, @babel/traverse, plus dev deps for tests"
      contains: "tinyglobby"
    - path: ".agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js"
      provides: "Verbatim copy of the Phase 9 spiked webpack loader; pnpm-store-fallback resolution preserved"
      min_lines: 300
    - path: ".agents/skills/codebase-to-contracts/scripts/helpers/deterministic-uuid.mjs"
      provides: "UUIDv5 from (repo_name, file_path, ast_anchor) — re-run idempotency primitive"
    - path: ".agents/skills/codebase-to-contracts/scripts/helpers/frontmatter-writer.mjs"
      provides: "YAML round-trip writer that matches Phase 2 serde_yaml_ng output exactly"
  key_links:
    - from: ".agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js"
      to: "contract-ide-demo/contract-uuid-plugin/index.js"
      via: "byte-for-byte copy + parameterized rootDir"
      pattern: "data-contract-uuid"
    - from: ".agents/skills/codebase-to-contracts/scripts/helpers/deterministic-uuid.mjs"
      to: "scripts/discover.mjs (Plan 14-03)"
      via: "import { deterministicUuid } — every node UUID generated through this single function"
      pattern: "deterministicUuid\\("
    - from: ".agents/skills/codebase-to-contracts/scripts/helpers/frontmatter-writer.mjs"
      to: "src-tauri/src/sidecar/frontmatter.rs (Phase 2 reader)"
      via: "round-trip parity — js-yaml output must parse cleanly through serde_yaml_ng"
      pattern: "format_version: 3"
    - from: ".agents/skills/codebase-to-contracts/package.json"
      to: ".agents/skills/codebase-to-contracts/node_modules/"
      via: "pnpm install — bundled deps committed for self-contained skill"
      pattern: "tinyglobby"
---

<objective>
The EXECUTABLE half of the skill foundation: helper modules (deterministic UUID, claude CLI bridge, frontmatter writer, Babel parser bridge), the verbatim Babel-plugin template, the package.json + bundled node_modules, and three parity test suites (UUID stability, frontmatter round-trip, Rust-vs-JSON-Schema parity). Plan 14-01a ships SKILL.md + schemas in parallel.

Purpose: BOOTSTRAP-01 — without these helpers, plans 14-03/04/05 have nothing to import. The Babel template + UUIDv5 + frontmatter writer are the three load-bearing primitives for re-run idempotency. Bundled deps (Phase 14 revision Issue 2) means the skill is self-contained at clone time — no `pnpm install` setup step, no "it worked on my machine" surprise.

Output: Four helper modules with unit tests, the verbatim Babel loader template + plugin package.json + next-config snippet, the skill's own package.json + .gitignore + committed node_modules, and three test suites (deterministic UUID, frontmatter round-trip, Rust-vs-JSON parity).
</objective>

<execution_context>
@/Users/yang/.claude/get-shit-done/workflows/execute-plan.md
@/Users/yang/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/STATE.md
@.planning/phases/14-codebase-to-contracts-bootstrap-skill-demo-application/14-RESEARCH.md

# The Babel loader to copy verbatim (Phase 9 09-04b)
@contract-ide-demo/contract-uuid-plugin/index.js
@contract-ide-demo/contract-uuid-plugin/package.json
@contract-ide-demo/next.config.ts

# Round-trip parity exemplar
@contract-ide-demo/.contracts/a1000000-0000-4000-8000-000000000000.md

# Source of truth for Rust-vs-JSON parity (Phase 14 revision Issue 12)
@contract-ide/src-tauri/src/sidecar/frontmatter.rs

# 14-01a's schemas (parity smoke target)
@.agents/skills/codebase-to-contracts/schemas/frontmatter.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create skill package.json + .gitignore + run pnpm install + commit node_modules (bundled-deps strategy)</name>
  <files>
    .agents/skills/codebase-to-contracts/package.json
    .agents/skills/codebase-to-contracts/.gitignore
  </files>
  <action>
    **Phase 14 revision Issue 2 fix:** the skill needs runtime deps (tinyglobby, js-yaml, @babel/parser, @babel/traverse) that downstream plans (14-03/04/05) import. Without a package.json + installed node_modules, those scripts ENOENT at runtime. This task ships them.

    **package.json** — create at `.agents/skills/codebase-to-contracts/package.json`:

    ```json
    {
      "name": "@contract-ide/codebase-to-contracts-skill",
      "private": true,
      "version": "0.1.0",
      "description": "Bootstrap a .contracts/ tree from any Next.js + Prisma + TS repo. Skill ships its own deps so it's self-contained at clone time.",
      "type": "module",
      "scripts": {
        "test": "node --test scripts/helpers/__tests__/ scripts/__tests__/"
      },
      "dependencies": {
        "tinyglobby": "^0.2.0",
        "js-yaml": "^4.1.0",
        "@babel/parser": "^7.24.0",
        "@babel/traverse": "^7.24.0",
        "@babel/generator": "^7.24.0"
      }
    }
    ```

    Pin major versions only; let pnpm pick the latest patch. The same dep versions are also resolved by the target repo's pnpm tree at runtime (babel-parser-bridge.mjs in Task 3 falls back to those if the skill's bundled copies aren't present), so a small version drift between the skill and target is acceptable.

    **.gitignore** — at `.agents/skills/codebase-to-contracts/.gitignore`. **DECISION (Yang's discretion area, RESEARCH Open Question on bundled deps): commit node_modules.** Per the bundled-deps strategy explicitly recommended in RESEARCH Pattern 5 ("skill is self-contained at clone time"), we COMMIT node_modules so cloning the contract-ide repo immediately yields a working skill — no `pnpm install` setup step. .gitignore content:

    ```gitignore
    # Skill ships bundled deps per Phase 14 RESEARCH Pattern 5 + revision Issue 2.
    # node_modules IS committed — DO NOT add it here.
    # Only ignore transient build/test artifacts:
    .DS_Store
    *.log
    .vscode/
    ```

    **Run pnpm install** at the skill directory:

    ```bash
    cd /Users/yang/lahacks/.agents/skills/codebase-to-contracts && pnpm install --prod=false
    ```

    Expected size: tinyglobby (~50KB) + js-yaml (~150KB) + @babel/parser+traverse+generator (~3MB) ≈ 4MB total. Acceptable to commit.

    **Verify the install succeeded** by listing the resolved dependencies:

    ```bash
    cd /Users/yang/lahacks/.agents/skills/codebase-to-contracts && ls node_modules | head -10 && cat pnpm-lock.yaml | head -5
    ```

    Should show `tinyglobby`, `js-yaml`, `@babel`, etc. in the listing and a valid pnpm-lock.yaml.

    **Anti-pattern guard:** Do NOT add `node_modules/` to the project root .gitignore. The skill subdirectory's node_modules is intentionally tracked. Verify after the install:

    ```bash
    cd /Users/yang/lahacks && git check-ignore .agents/skills/codebase-to-contracts/node_modules
    ```

    Should print nothing (= file is NOT ignored). If it IS ignored, edit the parent .gitignore to add a negation: `!.agents/skills/codebase-to-contracts/node_modules/`.
  </action>
  <verify>
    `cat .agents/skills/codebase-to-contracts/package.json | node -e "JSON.parse(require('fs').readFileSync(0))"` succeeds (valid JSON).
    `cat .agents/skills/codebase-to-contracts/package.json | grep -E '"tinyglobby"|"js-yaml"|"@babel/parser"|"@babel/traverse"'` matches all 4 deps.
    `ls .agents/skills/codebase-to-contracts/node_modules/tinyglobby/package.json` exists (pnpm install completed).
    `ls .agents/skills/codebase-to-contracts/node_modules/js-yaml/package.json` exists.
    `ls .agents/skills/codebase-to-contracts/node_modules/@babel/parser/package.json` exists.
    `ls .agents/skills/codebase-to-contracts/pnpm-lock.yaml` exists.
    `cd /Users/yang/lahacks && git check-ignore .agents/skills/codebase-to-contracts/node_modules` prints nothing (deps NOT ignored).
    `cd .agents/skills/codebase-to-contracts && node -e "import('tinyglobby').then(m => console.log(typeof m.glob))"` prints "function" (deps importable).
  </verify>
  <done>
    Skill has its own package.json declaring 5 runtime deps (tinyglobby, js-yaml, @babel/parser, @babel/traverse, @babel/generator). pnpm install executed at skill dir, node_modules populated (~4MB), pnpm-lock.yaml committed. .gitignore explicitly notes node_modules is COMMITTED per bundled-deps strategy. Project root .gitignore audit passes — skill's deps are tracked. Plans 14-03/04/05 can `import` these deps without setup steps.
  </done>
</task>

<task type="auto">
  <name>Task 2: Helper scripts (deterministic-uuid, claude-cli-bridge, frontmatter-writer, babel-parser-bridge)</name>
  <files>
    .agents/skills/codebase-to-contracts/scripts/helpers/deterministic-uuid.mjs
    .agents/skills/codebase-to-contracts/scripts/helpers/claude-cli-bridge.mjs
    .agents/skills/codebase-to-contracts/scripts/helpers/frontmatter-writer.mjs
    .agents/skills/codebase-to-contracts/scripts/helpers/babel-parser-bridge.mjs
  </files>
  <action>
    **scripts/helpers/deterministic-uuid.mjs** — UUIDv5 from `(repo_name, file_path, ast_anchor)` per Pattern 3 in RESEARCH.md. Use Node built-in `crypto.createHash('sha1')` with the standard URL namespace `6ba7b810-9dad-11d1-80b4-00c04fd430c8` (RFC 4122 §C.2). Export `deterministicUuid(repoName, filePath, astAnchor) -> string`. Format must be valid UUIDv5 (version digit '5' at position 14, variant bits 10xx at position 19). DO NOT use `crypto.randomUUID()`.

    Concrete implementation (RFC 4122 §4.3 reference):

    ```javascript
    // scripts/helpers/deterministic-uuid.mjs
    import { createHash } from 'node:crypto';

    // RFC 4122 §C.2 URL namespace (constant — copy verbatim)
    const NAMESPACE_URL = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

    function uuidStrToBytes(uuid) {
      return Buffer.from(uuid.replace(/-/g, ''), 'hex');
    }

    export function deterministicUuid(repoName, filePath, astAnchor) {
      const name = `${repoName}::${filePath}::${astAnchor}`;
      const namespaceBytes = uuidStrToBytes(NAMESPACE_URL);
      const hash = createHash('sha1');
      hash.update(namespaceBytes);
      hash.update(name);
      const digest = hash.digest();

      // Set version (5) and variant (RFC 4122)
      digest[6] = (digest[6] & 0x0f) | 0x50;
      digest[8] = (digest[8] & 0x3f) | 0x80;

      const hex = digest.toString('hex').slice(0, 32);
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
    }
    ```

    **scripts/helpers/claude-cli-bridge.mjs** — Wraps `claude -p --output-format json --json-schema <path> --append-system-prompt <inline>` invocation as a Node async function. Signature: `async function callClaude({ schemaPath, systemPrompt, userPrompt, allowedTools = ['Read'], temperature = 0, model }) -> Promise<{ structured_output, raw }>`. Use `child_process.spawn` (NOT `execSync` — long-running calls); pipe userPrompt via stdin; collect stdout JSON; parse and return `structured_output` field per Phase 11 RESEARCH.md verified pattern. On non-zero exit, throw `Error('claude -p failed: ' + stderr)`. Pin model via env var `BOOTSTRAP_CLAUDE_MODEL` (default `claude-sonnet-4-6` — pinned per Pitfall 1). Set `temperature: 0` always.

    Test mode hook: if `process.env.BOOTSTRAP_TEST_MODE === '1'`, return a canned `{ structured_output: {}, raw: '{}' }` immediately without spawning the subprocess. Tests in 14-03/04/05 use this to mock the CLI.

    **scripts/helpers/frontmatter-writer.mjs** — Round-trip-safe YAML frontmatter writer matching `src-tauri/src/sidecar/frontmatter.rs` (serde_yaml_ng) output exactly. Use `js-yaml` (now a real dep — Task 1 installed it). Function signature: `function writeFrontmatter(frontmatterObj, body) -> string`. Format: `---\n<yaml>---\n\n<body>`. Key ordering MUST match Phase 2 Plan 02-01 close-fence guard: open `---\n`, body of YAML, then `\n---\n` (newline on both sides — Pitfall 6 in Phase 2 RESEARCH). Empty `code_ranges: []` should serialize as `code_ranges: []` not `code_ranges:\n` (use `js-yaml` dump options: `flowLevel: -1` globally; force flow-style for empty arrays via custom replacer or post-process the output).

    **scripts/helpers/babel-parser-bridge.mjs** — Loads `@babel/parser` and `@babel/traverse` from the SKILL'S OWN node_modules first (bundled deps from Task 1), with fallback to the TARGET repo's node_modules via pnpm-store resolution mirroring `contract-ide-demo/contract-uuid-plugin/index.js`. Function signature: `async function loadBabel(targetRepoRoot) -> { parse, traverse }`.

    Resolution order (revised per Issue 2 — bundled deps are now first-class):
    1. **Skill's own node_modules** (preferred — known-good versions). `import('@babel/parser')` from this module's directory.
    2. **Target repo's node_modules** (fallback — for cases where the skill's bundle was tampered with). Use `createRequire(import.meta.url)` + `require.resolve('@babel/parser', { paths: [targetRoot] })`.
    3. **Target repo's pnpm virtual store** (deepest fallback). Mirror `resolvePnpmDep()` from `contract-ide-demo/contract-uuid-plugin/index.js` (read it, copy the function pattern verbatim).

    Document the resolution order in inline comments. The skill's bundled deps (Task 1) make path #1 the common case.
  </action>
  <verify>
    `node -e "import('./.agents/skills/codebase-to-contracts/scripts/helpers/deterministic-uuid.mjs').then(m => console.log(m.deterministicUuid('test-repo', 'app/page.tsx', 'JSXElement@L60-65')))"` prints a valid UUIDv5 (matches `/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`).
    `node -e "import('./.agents/skills/codebase-to-contracts/scripts/helpers/frontmatter-writer.mjs').then(m => console.log(m.writeFrontmatter({format_version: 3, uuid: 'a-b-c'}, 'body')))"` prints `---\nformat_version: 3\nuuid: a-b-c\n---\n\nbody`.
    `node -e "import('./.agents/skills/codebase-to-contracts/scripts/helpers/babel-parser-bridge.mjs').then(m => m.loadBabel('/Users/yang/lahacks/contract-ide-demo')).then(b => console.log(typeof b.parse, typeof b.traverse))"` prints "function function".
    `BOOTSTRAP_TEST_MODE=1 node -e "import('./.agents/skills/codebase-to-contracts/scripts/helpers/claude-cli-bridge.mjs').then(m => m.callClaude({systemPrompt:'',userPrompt:''})).then(r => console.log(r.structured_output))"` prints `{}` (test mode short-circuits subprocess).
  </verify>
  <done>
    Four helper modules exist + are importable. deterministicUuid produces valid UUIDv5. frontmatter-writer produces correct delimiter format. babel-parser-bridge resolves through 3-tier fallback (skill's bundled -> target's node_modules -> pnpm store). claude-cli-bridge has BOOTSTRAP_TEST_MODE=1 escape hatch for downstream tests. All four helpers documented with JSDoc signatures + the rationale for the resolution / serialization choices.
  </done>
</task>

<task type="auto">
  <name>Task 3: Babel webpack loader template (verbatim copy from Phase 9 09-04b) + plugin package.json + next-config snippet</name>
  <files>
    .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js
    .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-package.json
    .agents/skills/codebase-to-contracts/templates/next-config-snippet.ts
  </files>
  <action>
    **templates/contract-uuid-plugin-loader.js**: Copy `contract-ide-demo/contract-uuid-plugin/index.js` BYTE-FOR-BYTE. The Phase 9 spike PASSED with this exact loader; do NOT rewrite (Pitfall 3 in RESEARCH: pnpm-store-fallback resolution is the gotcha; the existing implementation solved it). Use `Read` then `Write` — confirm via `diff` that the copy is byte-identical (`diff contract-ide-demo/contract-uuid-plugin/index.js .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js` returns empty). The only allowed deviation: a single header comment block `// Source: contract-ide-demo/contract-uuid-plugin/index.js — copied verbatim per Phase 14 Plan 14-01b / RESEARCH.md Pitfall 3` at top. Do NOT parameterize repo-root — the existing loader uses `process.cwd()` which works for any target; we install it INTO the target repo so `process.cwd()` becomes the target.

    **templates/contract-uuid-plugin-package.json**: Copy `contract-ide-demo/contract-uuid-plugin/package.json` byte-for-byte. Same header comment.

    **templates/next-config-snippet.ts**: An insertion-ready snippet showing how to wire the loader into the target's `next.config.ts`. Reference how contract-ide-demo's next.config.ts does it — read it (`/Users/yang/lahacks/contract-ide-demo/next.config.ts`) and produce a TYPED snippet that the emit script (Plan 14-05) splices into the target's existing next.config. Include the import line, the webpack hook, and explicit comments marking insertion points (`// BOOTSTRAP-INSERT-START` / `// BOOTSTRAP-INSERT-END`) so re-runs can find and replace the snippet idempotently.

    Sync-strategy doc inline in `templates/contract-uuid-plugin-loader.js` header: "When the source plugin in contract-ide-demo evolves (bug fix, perf), re-copy via `cp contract-ide-demo/contract-uuid-plugin/index.js .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js && diff` to verify. CI step (future): assert hash matches on every commit." (Open Question 6 in RESEARCH — Yang to ratify symlink-vs-copy strategy. For v1, copy + manual sync.)
  </action>
  <verify>
    `diff contract-ide-demo/contract-uuid-plugin/index.js .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js` returns ONLY the prepended header comment lines (one diff hunk at top).
    `diff contract-ide-demo/contract-uuid-plugin/package.json .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-package.json` returns ONLY the header comment.
    `grep "BOOTSTRAP-INSERT" .agents/skills/codebase-to-contracts/templates/next-config-snippet.ts` matches both START and END markers.
    `wc -l .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js` returns the same line count as the source plus ~3 (header comment).
  </verify>
  <done>
    The Babel webpack loader template is a byte-identical copy of contract-ide-demo's, with only a one-line provenance comment added. Plugin package.json copied likewise. The next-config-snippet has clearly delineated insertion markers so Plan 14-05's emit script can splice and re-splice without producing duplicate insertions on re-runs.
  </done>
</task>

<task type="auto">
  <name>Task 4: Three parity test suites (UUID stability, frontmatter round-trip, Rust-vs-JSON Schema parity)</name>
  <files>
    .agents/skills/codebase-to-contracts/scripts/helpers/__tests__/deterministic-uuid.test.mjs
    .agents/skills/codebase-to-contracts/scripts/helpers/__tests__/frontmatter-writer.test.mjs
    .agents/skills/codebase-to-contracts/scripts/helpers/__tests__/schema-rust-parity.test.mjs
  </files>
  <action>
    **scripts/helpers/__tests__/deterministic-uuid.test.mjs** — Node `node --test` runner suite:
    - `deterministicUuid('demo-repo', 'app/page.tsx', 'JSXElement@L60-65')` returns the SAME string on every call (deterministic).
    - Different `astAnchor` produces different UUIDs.
    - Output passes UUIDv5 regex `/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`.

    **scripts/helpers/__tests__/frontmatter-writer.test.mjs** — Round-trip parity test (Phase 14 revision Issue 12 — fixture parity against real seeded sidecar):
    - Read `contract-ide-demo/.contracts/a1000000-0000-4000-8000-000000000000.md` (the Phase 9 exemplar).
    - Parse its frontmatter (manual extraction of YAML between `---` blocks; use js-yaml.load).
    - Write it back via `writeFrontmatter()`.
    - Assert byte-equality with the original (modulo trailing-newline differences which are documented).
    - **Add second fixture round-trip** against `contract-ide-demo/.contracts/ambient/api-account-delete-001.md` (a backend kind with full Inputs / Outputs / Side effects sections — exercises the BACKEND-FM-01 shape).

    **scripts/helpers/__tests__/schema-rust-parity.test.mjs** (NEW per Phase 14 revision Issue 12):
    - Read the Rust source: `contract-ide/src-tauri/src/sidecar/frontmatter.rs`
    - Parse the `Frontmatter` struct fields via regex (look for `pub <field_name>:` lines + `#[serde(...)]` attributes).
    - For each non-`Option<T>` field that doesn't have `#[serde(default)]`: assert the field name appears in `schemas/frontmatter.json` `required[]`.
    - For each `Option<T>` field: assert the field appears in `properties` (but NOT necessarily in `required`).
    - Print a parity table at test-end: `| Rust field | required in JSON | match? |`
    - This test catches drift if Phase 9's Rust struct gains a new required field but the JSON Schema misses it (e.g., a future `priority` field added to `Frontmatter` should fail the parity test until added to the schema).

    Tests run via: `cd .agents/skills/codebase-to-contracts && pnpm test` (the `node --test` runner is wired in package.json's `scripts.test`).
  </action>
  <verify>
    `cd .agents/skills/codebase-to-contracts && pnpm test` — all three suites pass; output shows `# pass <N>` with N matching the assertion count.
    `cd .agents/skills/codebase-to-contracts && node --test scripts/helpers/__tests__/schema-rust-parity.test.mjs 2>&1 | grep -E "Rust field|required in JSON"` shows the parity table.
    Spot-check: temporarily delete `format_version` from the schema's `required[]`; run the parity test; verify it FAILS with a clear "format_version is required in Rust but missing from JSON Schema required[]" message; restore the schema.
  </verify>
  <done>
    Three test suites pass under `node --test`. Round-trip parity test on TWO real Phase 9 exemplar contracts (UI L4 + backend L3) demonstrates the YAML writer emits byte-identical output to what the Rust serde_yaml_ng reader expects. Deterministic UUIDv5 helper is the single source for all UUID generation across the skill. Schema-vs-Rust parity smoke catches future struct drift before it breaks the validator gate at Stage 5b.
  </done>
</task>

</tasks>

<verification>
**Plan-level checks:**

1. `cd .agents/skills/codebase-to-contracts && pnpm test` exits 0
2. `diff contract-ide-demo/contract-uuid-plugin/index.js .agents/skills/codebase-to-contracts/templates/contract-uuid-plugin-loader.js` shows ONLY a header-comment hunk
3. `find .agents/skills/codebase-to-contracts -type f -not -path '*/node_modules/*' | wc -l` returns >=11 (4 helpers + 3 tests + 3 templates + package.json + .gitignore)
4. `ls .agents/skills/codebase-to-contracts/node_modules/tinyglobby/package.json .agents/skills/codebase-to-contracts/node_modules/@babel/parser/package.json .agents/skills/codebase-to-contracts/node_modules/js-yaml/package.json` all exist
5. `node -e "JSON.parse(require('fs').readFileSync('.agents/skills/codebase-to-contracts/package.json', 'utf8'))"` succeeds

**No subprocess execution this plan** — Plan 14-01b lays apparatus; nothing in this plan calls `claude -p`. Plans 14-03/04/05 do that.
</verification>

<success_criteria>
1. Skill has its own package.json + node_modules (4 deps: tinyglobby, js-yaml, @babel/parser, @babel/traverse, @babel/generator) — Phase 14 revision Issue 2 closed
2. Four helper scripts (deterministic-uuid, claude-cli-bridge, frontmatter-writer, babel-parser-bridge) with documented signatures
3. Babel webpack loader template is BYTE-IDENTICAL to `contract-ide-demo/contract-uuid-plugin/index.js` modulo a one-line provenance header
4. Three test suites pass via `pnpm test`: deterministic-uuid stability + frontmatter-writer round-trip parity (TWO exemplars: UI L4 + backend L3) + Schema-vs-Rust parity smoke (Phase 14 revision Issue 12 closed)
5. babel-parser-bridge.mjs uses 3-tier resolution (skill's bundled deps -> target's node_modules -> target's pnpm-store fallback); skill is self-contained at clone time
6. .gitignore explicitly notes node_modules IS committed (bundled-deps strategy)
7. Project root .gitignore audit confirms skill's node_modules is NOT ignored
8. BOOTSTRAP-01 [proposed] satisfied — skill is invocable as `/codebase-to-contracts <repo-path>` (combined with 14-01a's SKILL.md)
</success_criteria>

<output>
After completion, create `.planning/phases/14-codebase-to-contracts-bootstrap-skill-demo-application/14-01b-SUMMARY.md`. Document:
- pnpm install outcome (dep tree depth, total node_modules size in MB)
- Helper script unit-test results (pass count per suite)
- Schema-vs-Rust parity test outcome — print the parity table for posterity
- Babel loader copy method (Read + Write, or `cp` shell command — note for future re-syncs)
- Open Question 6 (symlink vs copy for plugin sync) — note current approach (copy + manual sync), defer Yang's ratification
- Whether the .gitignore audit revealed any pre-existing rule that needed a negation override
</output>

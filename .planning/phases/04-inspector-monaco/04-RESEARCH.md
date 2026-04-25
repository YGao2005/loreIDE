# Phase 4: Inspector + Monaco — Research

**Researched:** 2026-04-24
**Domain:** Monaco editor in Tauri/WKWebView, code-range decorations, Tauri file-open IPC, iframe preview, drift hash detection, local contract dirty state
**Confidence:** HIGH for Monaco/Tauri plumbing (Phase 1 already validated workers); MEDIUM for range-dimming pattern (verified via multiple community sources); HIGH for opener plugin API (official Tauri docs verified)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INSP-01 | Clicking a graph node opens inspector with Contract/Code/Preview/Receipts tabs; Code tab renders Monaco read-only scoped to `code_ranges` with surrounding context dimmed + GitHub-diff-style expand handles; workers confirmed active in Tauri dev console | §Standard Stack Monaco, §Architecture Pattern 2 (range-scoped Monaco), §Pitfall 1 (WKWebView workers already validated in Phase 1), §Code Examples §Monaco Read-Only Range |
| INSP-02 | Inspector shows live localhost preview iframe at node's `route`; "Start dev server" prompt when unreachable | §Architecture Pattern 4 (preview iframe), §Pitfall 4 (iframe CSP), §Code Examples §Dev Server Probe |
| INSP-03 | User edits contract directly; edit preserved locally; node marked "contract dirty" without overwriting human-authored text | §Architecture Pattern 3 (contract dirty state), §Standard Stack (editor store already exists), §Pitfall 3 (human_pinned guard) |
| INSP-04 | Inspector shows drift indicator (contract hash vs. code hash mismatch) with reconcile affordance | §Architecture Pattern 5 (drift indicator), §Code Examples §Drift Detection Read, §Don't Hand-Roll §hashing |
| INSP-05 | Code tab exposes `[⌘R Reveal in Finder]` and `[⌘O Open in External Editor]`; verified against two-file code_ranges node | §Standard Stack (tauri-plugin-opener), §Architecture Pattern 6 (escape hatch actions), §Code Examples §Reveal + Open External |
</phase_requirements>

---

## Summary

Phase 4 builds on a validated base: `vite-plugin-monaco-editor` and the `blob:` CSP are already in `vite.config.ts` and `tauri.conf.json` from Phase 1, and the worker issue was confirmed passing in Day-1 validation. The inspector shell with four tabs already exists in `Inspector.tsx` but every non-Contract tab currently renders a placeholder. Phase 4 replaces those placeholders with real functionality.

The technically hardest piece is the Code tab's range-scoped Monaco view: Monaco has no first-class "show only lines X–Y" API. The correct pattern uses a combination of `editor.setHiddenAreas()` (hides surrounding context lines without removing them), `createDecorationsCollection()` with a dim CSS class for the visible fringe, and a separate `changeViewZones()` "expand handle" overlay that reveals hidden lines on click. This is a well-established pattern in the Monaco community (used by GitHub's diff viewer approach) but requires coordinating three separate Monaco APIs. The implementation is non-trivial but fully achievable in one plan.

The preview iframe (INSP-02) is the second risk area: Tauri's WKWebView loads the app from `tauri://localhost`, while the preview target is `http://localhost:3000`. The same-origin policy does NOT block this iframe load (different origins are fine as long as the target server doesn't send `X-Frame-Options: DENY`). The risk is that Next.js dev servers send `X-Frame-Options: SAMEORIGIN` by default, which would block the iframe. The solution is a Rust probe command that fetches the `route` URL without the X-Frame header check — if reachable, we show the iframe directly (WebKit ignores X-Frame-Options for apps using `allowsInlineMediaPlayback` and local iframes with no sandbox attr). vercel/commerce requires real Shopify credentials to run; for the demo, credentials must be captured and committed to `.env.local` before the Phase 4 success criterion passes.

The contract-dirty state, drift indicator, and escape-hatch actions (INSP-03/04/05) are all straightforward given the existing infrastructure: the editor store (`useEditorStore`) already tracks `isDirty`; the `ContractNode` IPC type already carries `code_hash` and `contract_hash`; `tauri-plugin-opener` (already in `Cargo.toml` and capabilities) provides `revealItemInDir()` and `openPath()` with `with` parameter for a specific editor binary.

**Primary recommendation:** Ship Phase 4 in three plans: Plan 04-01 wires node selection to inspector (graph → inspector IPC, tab structure, Monaco Code tab with range decorations + hidden areas + worker verification); Plan 04-02 adds contract editor with dirty/save/human-pinned flow, drift indicator, and escape-hatch buttons; Plan 04-03 adds the preview iframe with dev-server probe + vercel/commerce bootstrap.

---

## Standard Stack

### Core (already installed — verify no additional installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@monaco-editor/react` | 4.7.0 | Monaco React wrapper with `onMount` callback for editor instance | Already installed in Phase 1 |
| `monaco-editor` | 0.55.1 | Core Monaco; `setHiddenAreas`, `createDecorationsCollection`, `revealLineInCenter` | Already installed; 0.55.x is current stable |
| `vite-plugin-monaco-editor` | installed | Worker bundling for WKWebView | Already in `vite.config.ts` — workers confirmed passing Day-1 |
| `@tauri-apps/plugin-opener` | 2.x | `revealItemInDir()` + `openPath(with)` | Already in `package.json` + `Cargo.toml` (Plan 01-01 retained it) |
| `zustand` | 5.0.12 | `useGraphStore` for `selectedNodeUuid`, `useEditorStore` for dirty state | Already installed |

### New Dependencies for Phase 4

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| No new deps | — | All required libraries are already installed | Phase 4 is pure wiring; no new npm or Cargo installs |

### New Rust Capabilities Required

| Permission | Why |
|------------|-----|
| `opener:allow-reveal-item-in-dir` | `[⌘R Reveal in Finder]` — not yet in `capabilities/default.json` |
| `opener:allow-open-path` | `[⌘O Open in External Editor]` — not yet in capabilities |

**Installation:** No new npm/Cargo installs. Add two opener permissions to `capabilities/default.json`.

---

## Architecture Patterns

### Recommended Project Structure (Phase 4 additions)

```
src/
├── components/
│   ├── layout/
│   │   └── Inspector.tsx           # Replace placeholder tabs with real impl
│   └── inspector/
│       ├── ContractTab.tsx         # Contract editor (move from Inspector.tsx inline)
│       ├── CodeTab.tsx             # Monaco range-scoped view — the hard part
│       ├── PreviewTab.tsx          # Iframe + dev-server probe
│       └── ReceiptsTab.tsx         # Stub with "coming in Phase 8" note
├── store/
│   └── editor.ts                   # Extend: add selectedNode, contractDirty, saveToSidecar
└── ipc/
    ├── inspector.ts                # New: read_file_range, probe_route, open_external
    └── contracts.ts                # Extend: updateContractDirty (marks human_pinned=true)

src-tauri/src/commands/
├── inspector.rs                    # New: read_file_range, probe_route commands
└── contracts.rs                    # Extend: already has write_contract
```

### Pattern 1: Node Selection → Inspector Wiring

**What:** Graph `onNodeClick` (single-click, not double-click which drills in) sets `selectedNodeUuid`; Inspector reads it from the store and loads the node's data.

**Current state:** `GraphCanvasInner.tsx` only handles `onNodeDoubleClick` (drill-in). Single-click selection is NOT wired yet — `selectNode` exists in `useGraphStore` but is never called. Phase 4 must add `onNodeClick` to the ReactFlow canvas.

**Pattern:**
```typescript
// GraphCanvasInner.tsx — add alongside onNodeDoubleClick
const selectNode = useGraphStore((s) => s.selectNode);

const onNodeClick = useCallback(
  (_evt: unknown, node: Node) => {
    selectNode(node.id);
    // Inspector listens to selectedNodeUuid via useGraphStore
  },
  [selectNode]
);

// In <ReactFlow ...>
onNodeClick={onNodeClick}
```

```typescript
// Inspector.tsx — derive the selected node from store
const selectedNodeUuid = useGraphStore((s) => s.selectedNodeUuid);
const nodes = useGraphStore((s) => s.nodes);
const selectedNode = nodes.find((n) => n.uuid === selectedNodeUuid) ?? null;
```

**Critical:** `onNodeClick` fires on SINGLE click; `onNodeDoubleClick` fires on double click. Both can coexist. Single-click opens inspector; double-click drills into the graph. Do NOT merge into one handler.

### Pattern 2: Monaco Range-Scoped View (INSP-01 — the hard piece)

**What:** Load the full file content into Monaco; hide surrounding lines with `setHiddenAreas`; apply a dim CSS class to the N-line context fringe above/below the range; add a "view zone" expand button that un-hides on click.

**Why not just set Monaco value to the range lines:** The line numbers would start at 1, losing file context. Monaco's `setHiddenAreas` preserves true line numbers while hiding the content.

**API facts (verified via official Monaco changelog + community sources):**
- `editor.setHiddenAreas(ranges: IRange[])` — hides lines in the editor viewport without removing them from the model; line numbers remain accurate. The `ranges` are `monaco.Range` objects.
- `editor.createDecorationsCollection(decorations: IModelDeltaDecoration[])` — current API (replaces deprecated `deltaDecorations`). Returns an `IEditorDecorationsCollection` with `.set()`, `.clear()`, `.getDecorations()`.
- `editor.revealLineInCenter(lineNumber: number)` — scroll to center the first line of the code_range after mount.
- `editor.changeViewZones(callback)` — adds overlay DOM nodes (expand handles) that live in the gutter layer.
- `readOnly: true` in editor options — prevents all edits; no need to intercept keys.

**Approach for multi-range nodes:** If `code_ranges` has multiple entries (possibly different files), show each range in a separate Monaco instance stacked vertically, or show a file-selector pill that switches the model. Recommended: separate Monaco per file (simpler, avoids model-switching complexity in Phase 4).

**CSS for dimming:**
```css
/* src/styles/monaco-range.css */
.monaco-context-dim {
  opacity: 0.35;
}
```

**Full implementation pattern:**
```typescript
// CodeTab.tsx — condensed pattern
// Source: monaco-editor setHiddenAreas API + community dim pattern

import Editor, { useMonaco } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';

interface CodeTabProps {
  codeRanges: CodeRange[];   // from ContractNode
  repoPath: string;
}

function RangeView({ filePath, startLine, endLine, repoPath }: {
  filePath: string; startLine: number; endLine: number; repoPath: string;
}) {
  const monaco = useMonaco();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const [fileContent, setFileContent] = useState<string>('');

  // 1. Load file content via Tauri IPC
  useEffect(() => {
    invoke<string>('read_file_content', { path: `${repoPath}/${filePath}` })
      .then(setFileContent)
      .catch(() => setFileContent(`// Could not load ${filePath}`));
  }, [repoPath, filePath]);

  const handleMount = useCallback((ed: MonacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = ed;
    if (!monaco) return;

    const lineCount = ed.getModel()?.getLineCount() ?? 0;
    const CONTEXT_LINES = 3; // lines of fringe to show dimmed

    // 2. Hide everything EXCEPT the range + CONTEXT_LINES fringe
    const hiddenTop = startLine - CONTEXT_LINES - 1;
    const hiddenBottom = endLine + CONTEXT_LINES + 1;

    const hiddenAreas: MonacoEditor.IRange[] = [];
    if (hiddenTop > 0) {
      hiddenAreas.push(new monaco.Range(1, 1, hiddenTop, 1));
    }
    if (hiddenBottom <= lineCount) {
      hiddenAreas.push(new monaco.Range(hiddenBottom, 1, lineCount, 1));
    }
    ed.setHiddenAreas(hiddenAreas);

    // 3. Dim the fringe lines with a decoration
    const dimDecorations: MonacoEditor.IModelDeltaDecoration[] = [];
    for (let l = Math.max(1, startLine - CONTEXT_LINES); l < startLine; l++) {
      dimDecorations.push({
        range: new monaco.Range(l, 1, l, 1),
        options: { isWholeLine: true, className: 'monaco-context-dim' },
      });
    }
    for (let l = endLine + 1; l <= Math.min(lineCount, endLine + CONTEXT_LINES); l++) {
      dimDecorations.push({
        range: new monaco.Range(l, 1, l, 1),
        options: { isWholeLine: true, className: 'monaco-context-dim' },
      });
    }
    ed.createDecorationsCollection(dimDecorations);

    // 4. Scroll to first line of range
    ed.revealLineInCenter(startLine);
  }, [monaco, startLine, endLine]);

  return (
    <Editor
      value={fileContent}
      language={detectLanguage(filePath)}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        fontSize: 12,
      }}
      onMount={handleMount}
      theme="vs-dark"
    />
  );
}
```

**Expand handle (GitHub-diff-style):** Use `editor.changeViewZones()` to inject a DOM button between the hidden area boundary and the visible range. On click: call `editor.setHiddenAreas([])` with the adjusted list that removes that hidden area.

```typescript
// Expand handle via view zone — simplified
editor.changeViewZones((accessor) => {
  const domNode = document.createElement('div');
  domNode.className = 'monaco-expand-handle';
  domNode.textContent = '↕ Show more';
  domNode.onclick = () => {
    // Remove the hidden area for this boundary
    const current = hiddenAreas.filter(/* not this one */);
    editor.setHiddenAreas(current);
  };
  accessor.addZone({
    afterLineNumber: hiddenTop,
    heightInLines: 1,
    domNode,
  });
});
```

### Pattern 3: Contract Editor — Dirty State + Human-Pinned Guard (INSP-03)

**What:** Extend `useEditorStore` to track the selected node UUID and persist contract edits via `write_contract` IPC. Mark `human_pinned: true` on first manual edit so derivation never overwrites.

**Current state of `useEditorStore`:** Has `contractText`, `isDirty`, `setContractText`, `saveContract` (Phase 1 stub — just `set({ isDirty: false })`). Phase 4 must wire `saveContract` to call `write_contract` IPC and set `human_pinned: true` in the frontmatter.

**Key design decision:** The `contractText` in the editor is the SOURCE OF TRUTH for what the user typed. The `contract_hash` stored in the sidecar is the hash of the saved version. "Contract dirty" in the inspector context means `isDirty === true` in the editor store (unsaved edits), NOT drift (which is `contract_hash !== code_hash`). These are two distinct states displayed separately.

```typescript
// store/editor.ts — Phase 4 extension
interface EditorState {
  contractText: string;
  isDirty: boolean;
  selectedNodeUuid: string | null;   // NEW
  loadNode: (node: ContractNode) => void;  // NEW — called when inspector opens
  setContractText: (text: string) => void;
  saveContract: (repoPath: string, node: ContractNode) => Promise<void>;  // wire to IPC
  resetEditor: () => void;
}

// saveContract implementation:
saveContract: async (repoPath, node) => {
  const { contractText } = get();
  // Compute new contract_hash
  const newContractHash = await invoke<string>('hash_text', { text: contractText });
  // Build updated frontmatter with human_pinned: true
  const fm: ContractFrontmatter = {
    ...nodeToFrontmatter(node),
    contract_hash: newContractHash,
    human_pinned: true,   // INSP-03: mark as human-authored, never overwrite
  };
  await writeContract({ repoPath, uuid: node.uuid, frontmatter: fm, body: contractText });
  set({ isDirty: false });
},
```

**Note on SHELL-05 autosave:** STATE.md documents that Phase 4 should replace blur-only autosave with debounced typing-while-saving cadence. Use a `useEffect` with `setTimeout(300ms)` debounce on `contractText` changes to trigger `saveContract`. The existing `onBlur` autosave remains as a fallback.

### Pattern 4: Preview Iframe — Dev Server Probe (INSP-02)

**What:** A Rust IPC command `probe_route` makes an HTTP GET to `http://localhost:PORT/route` with a timeout. Frontend renders an iframe on success, "Start dev server" prompt on failure.

**The X-Frame-Options problem:** Next.js dev servers (including vercel/commerce) send `X-Frame-Options: SAMEORIGIN` by default. Tauri's WKWebView is NOT a browser — it does not enforce `X-Frame-Options` for content loaded in `<iframe>` elements within the WKWebView app context. This has been verified by multiple Tauri users embedding localhost iframes. The iframe WILL render as long as the dev server is reachable.

**CSP caveat:** The current `tauri.conf.json` CSP does not include `frame-src` directive. Tauri's default CSP inherits `default-src: 'self'` which BLOCKS iframes to external origins including `http://localhost:3000`. Must add `"frame-src": ["http://localhost:*"]` to the CSP.

**Probe command (Rust):**
```rust
// src-tauri/src/commands/inspector.rs
#[tauri::command]
pub async fn probe_route(url: String) -> Result<bool, String> {
    // Simple reachability check — 1 second timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1))
        .build()
        .map_err(|e| e.to_string())?;
    match client.get(&url).send().await {
        Ok(resp) => Ok(resp.status().is_success() || resp.status().as_u16() == 404),
        Err(_) => Ok(false),  // not reachable
    }
}
```

**Frontend:**
```typescript
// PreviewTab.tsx
const [reachable, setReachable] = useState<boolean | null>(null);  // null = probing

useEffect(() => {
  if (!node?.route) return;
  const url = `http://localhost:3000${node.route}`;
  invoke<boolean>('probe_route', { url })
    .then(setReachable)
    .catch(() => setReachable(false));
}, [node?.route]);

return reachable === null ? <Spinner /> :
       reachable ? <iframe src={`http://localhost:3000${node.route}`} className="w-full h-full border-0" /> :
       <DevServerPrompt />;
```

**reqwest dependency:** Not yet in `Cargo.toml`. Required for the probe command. Add: `reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json"] }`.

### Pattern 5: Drift Indicator (INSP-04)

**What:** Compare `selectedNode.contract_hash` vs `selectedNode.code_hash` in the frontend. No new IPC needed — both fields are already in `ContractNode`. Display a visible banner + reconcile button when they differ.

**Hash presence logic:**
- Both `null` → node not yet derived → show "Not derived" state (neutral)
- `code_hash` is not null, `contract_hash` is not null, and they differ → DRIFTED → show red banner
- Both set and equal → SYNCED → show green dot
- `code_hash` is null (no code attached) → show neutral state

```typescript
// In Inspector.tsx or a DriftBanner component
function driftState(node: ContractNode): 'synced' | 'drifted' | 'untracked' {
  if (!node.code_hash || !node.contract_hash) return 'untracked';
  return node.code_hash === node.contract_hash ? 'synced' : 'drifted';
}
```

**Reconcile affordance (INSP-04 minimum viable):** A button "Reconcile" that opens the reconcile panel (Phase 7 will build the full panel — Phase 4 ships the button as a placeholder that emits a console.log or opens a toast). The drift INDICATOR is the Phase 4 requirement; the full reconcile flow is Phase 7.

### Pattern 6: Escape Hatch Actions (INSP-05)

**What:** Two buttons in the Code tab toolbar using `tauri-plugin-opener`.

**Reveal in Finder:**
```typescript
import { revealItemInDir } from '@tauri-apps/plugin-opener';

// For a node with multiple code_ranges, reveal the first file
const firstRange = node.code_ranges[0];
if (firstRange) {
  await revealItemInDir(`${repoPath}/${firstRange.file}`);
}
```

**Open in External Editor:**
```typescript
import { openPath } from '@tauri-apps/plugin-opener';

// tauri-plugin-opener cannot pass --goto file:line directly.
// Strategy: open the file with the default editor. For line-jump,
// use a Rust command that reads $EDITOR and invokes it via shell.
// Phase 4 minimum viable: open with default app (no line number).
// Full line-jump via shell command is a Phase 4 stretch or Phase 9 polish.
await openPath(`${repoPath}/${firstRange.file}`);
```

**Line-number open (Rust shell approach — if needed for demo):**
```rust
// For VS Code / Cursor: `code --goto file.ts:42`
// For vim: `vim +42 file.ts`
// Detect from $EDITOR env var and dispatch
#[tauri::command]
pub async fn open_in_editor(app: tauri::AppHandle, path: String, line: u32) -> Result<(), String> {
    let editor = std::env::var("EDITOR").unwrap_or_else(|_| "open".to_string());
    let shell = app.shell();
    if editor.contains("code") || editor.contains("cursor") {
        shell.command(&editor)
             .args(["--goto", &format!("{path}:{line}")])
             .spawn()
             .map_err(|e| e.to_string())?;
    } else {
        // Fallback: use opener for default app (no line number)
        app.opener().open_path(&path, None::<&str>).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

**Permissions to add in `capabilities/default.json`:**
```json
"opener:allow-reveal-item-in-dir",
{
  "identifier": "opener:allow-open-path",
  "allow": [{ "path": "**" }]
}
```

### Anti-Patterns to Avoid

- **Using `deltaDecorations` instead of `createDecorationsCollection`:** `deltaDecorations` is soft-deprecated in Monaco 0.50+. Use `createDecorationsCollection` which returns a collection object with `.set()` and `.clear()` methods.
- **Setting Monaco `value` to only the range lines:** Loses line-number context. Always load the full file and use `setHiddenAreas` to hide the rest.
- **Calling `editor.setHiddenAreas()` before the model is set:** Must call in the `onMount` callback or after `editor.setModel()` completes. Calling before mount silently no-ops.
- **Loading file content via `@tauri-apps/plugin-fs` from the frontend:** Correct approach is a Rust IPC command that reads the file and returns the string. This keeps file access in the single-writer/single-reader Rust layer and avoids scope issues with `fs:allow-read-text-file` needing path-specific grants.
- **Two Monaco instances for multi-range in same file:** If both ranges are in the same file, use ONE Monaco instance with two visible islands (two `setHiddenAreas` calls are additive — pass all hidden ranges at once).
- **Setting `frame-src` on the wrong side:** The CSP in `tauri.conf.json` app.security.csp must have `"frame-src": ["http://localhost:*"]`. Setting it only in a meta tag won't work with Tauri's native CSP enforcement.
- **Assuming X-Frame-Options blocks iframes in Tauri:** It does not. WKWebView does not enforce X-Frame-Options headers for iframe src URLs loaded within the native app context. Only the Tauri CSP `frame-src` directive matters.
- **`human_pinned: false` on contract saves:** Every `write_contract` from the inspector must set `human_pinned: true`. If you read the old frontmatter and pass it through unchanged, `human_pinned` may be `false` and derivation (Phase 6) will overwrite the user's edit.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Monaco worker bundling | Custom `MonacoEnvironment.getWorker` | `vite-plugin-monaco-editor` (already installed) | Already validated in Day-1 verification; workers confirmed |
| File-in-Finder reveal | Custom Rust `open` shell call | `tauri-plugin-opener` `revealItemInDir()` | Already in Cargo.toml; handles macOS/Linux/Windows differences |
| HTTP reachability probe | `fetch()` from frontend | Rust `reqwest` probe command | `fetch()` to `http://localhost:*` from Tauri's `tauri://localhost` is cross-origin and gets CORS-blocked; Rust has no such restriction |
| Text content hashing | Custom hash function | `sha2` crate (already in Cargo.toml) | SHA-256 via `sha2::Sha256::digest(text.as_bytes())` + `hex::encode()` — pattern already established in the project |
| Contract dirty detection | Custom edit tracker | `useEditorStore.isDirty` (already exists) | zundo temporal middleware + `isDirty` flag already wired in Phase 1 |
| dim/highlight CSS | Inline styles | CSS class `monaco-context-dim { opacity: 0.35 }` + `className` decoration option | Monaco decoration system requires CSS classes, not inline styles |

**Key insight:** Phase 4 is almost entirely integration work. Every building block exists — the risk is wiring them together correctly in the right order (especially the Monaco `onMount` callback sequence).

---

## Common Pitfalls

### Pitfall 1: Monaco Workers in WKWebView — Already Mitigated
**What goes wrong:** "Could not create web worker" in Tauri dev console.
**Status:** ALREADY FIXED in Phase 1. `vite-plugin-monaco-editor` is in `vite.config.ts` with the `.default({...})` ESM workaround; `blob:` is in `script-src`. Day-1 validation confirmed workers pass.
**Action for Phase 4:** Run `cargo tauri dev`, open Monaco in the Code tab, check Tauri console (NOT browser devtools) for ANY worker errors. This is the verification step, not a new fix.
**Warning signs:** Error appears in Tauri console (not browser). Fix: confirm `vite.config.ts` still has `(monacoEditor as any).default({...})` — the `.default` wrapper is critical.

### Pitfall 2: `setHiddenAreas` Called Before `onMount`
**What goes wrong:** `setHiddenAreas` silently does nothing; all lines appear.
**Why it happens:** Calling `setHiddenAreas` during React render (not inside `onMount` callback) runs before Monaco has a model attached.
**How to avoid:** ALL Monaco decoration/hidden-area calls go inside the `onMount` callback or inside a `useEffect` that checks `editorRef.current !== null`.
**Warning signs:** All file lines visible; no dimming; no hidden sections. Check if `setHiddenAreas` is called in render vs onMount.

### Pitfall 3: Missing `human_pinned: true` on Contract Save
**What goes wrong:** User edits contract, it saves. Phase 6 derivation runs, overwrites the user's edit because `human_pinned: false`.
**Why it happens:** Forgetting to update `human_pinned` when writing the frontmatter. The Rust `write_contract` takes the frontmatter as a parameter — it does what JS tells it.
**How to avoid:** In `saveContract()`, always build the frontmatter with `human_pinned: true` regardless of the incoming value.
**Warning signs:** Contract resets to LLM-generated text after a re-derive (Phase 6 symptom). Catch by reading the sidecar .md after a manual edit and verifying `human_pinned: true` is in the YAML.

### Pitfall 4: iframe CSP Blocking Preview
**What goes wrong:** Preview iframe is blank/blocked. No visible error in the UI.
**Why it happens:** `tauri.conf.json` CSP `default-src: 'self'` covers iframes; `http://localhost:3000` is not `'self'` (different origin). Without explicit `frame-src`, the iframe is blocked by Tauri's native CSP enforcement.
**How to avoid:** Add `"frame-src": ["http://localhost:*"]` to the CSP in `tauri.conf.json`.
**Warning signs:** Blank iframe + error in Tauri dev console `Refused to load frame ... because it violates CSP`.

### Pitfall 5: `reqwest` TLS Feature Flag
**What goes wrong:** Build fails with `reqwest` SSL backend errors on macOS (native-tls vs rustls conflict).
**Why it happens:** `reqwest` default features include `native-tls` which requires OpenSSL; on macOS this can conflict with Tauri's bundled TLS.
**How to avoid:** Use `reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json"] }` in `Cargo.toml`. `rustls-tls` is pure Rust, no OpenSSL dependency.
**Warning signs:** Build error mentioning `openssl-sys` or `native-tls`; or linker error on macOS.

### Pitfall 6: `fetch()` for Dev Server Probe Fails Due to CORS
**What goes wrong:** Frontend `fetch('http://localhost:3000')` returns a CORS error even though the server is running.
**Why it happens:** Tauri app loads from `tauri://localhost`; fetching `http://localhost:3000` is cross-origin. Next.js dev server does NOT send CORS headers for arbitrary origins.
**How to avoid:** Probe via Rust `reqwest` command (Rust-side HTTP has no CORS restriction). Do NOT use `fetch()` from the frontend for the probe.
**Warning signs:** `fetch` returns a CORS error in the browser console; server IS running but probe returns false.

### Pitfall 7: `openPath` Without Scope Grant
**What goes wrong:** `revealItemInDir` or `openPath` throws "not allowed" error.
**Why it happens:** `opener:allow-open-path` requires a path scope glob in capabilities.
**How to avoid:** Use `{ "identifier": "opener:allow-open-path", "allow": [{ "path": "**" }] }` (broad; for a dev tool this is fine).
**Warning signs:** Runtime error from the opener plugin with "permission denied" or "not allowed."

### Pitfall 8: Monaco `language` Detection for TypeScript JSX Files
**What goes wrong:** Monaco renders `.tsx` files without syntax highlighting.
**Why it happens:** Monaco uses `"typescript"` for `.ts` but `.tsx` needs `"typescript"` too (Monaco's TS worker handles both). `.jsx` → `"javascript"`.
**How to avoid:** In `detectLanguage(filepath)`: `tsx|ts → 'typescript'`, `jsx|js → 'javascript'`, `css|scss → 'css'`, `json → 'json'`, fallback `'plaintext'`.

---

## Code Examples

### Read File Content Rust Command

```rust
// src-tauri/src/commands/inspector.rs
// Source: Tauri v2 docs — Calling Rust from Frontend
#[tauri::command]
pub async fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}
```

Register in `src-tauri/src/lib.rs` `generate_handler!` list.

### Hash Text Rust Command (for contract_hash computation on save)

```rust
// src-tauri/src/commands/inspector.rs
use sha2::{Sha256, Digest};

#[tauri::command]
pub fn hash_text(text: String) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}
```

Note: `sha2` and `hex` are already in `Cargo.toml`.

### Dev Server Probe (Rust)

```rust
// src-tauri/src/commands/inspector.rs
// reqwest must be added to Cargo.toml:
// reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
#[tauri::command]
pub async fn probe_route(url: String) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1))
        .danger_accept_invalid_certs(false)
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    matches!(
        client.get(&url).send().await,
        Ok(r) if r.status().as_u16() < 500
    )
}
```

### Reveal in Finder + Open in External Editor (TypeScript)

```typescript
// CodeTab.tsx — escape hatch buttons
// Source: https://v2.tauri.app/plugin/opener/

import { revealItemInDir, openPath } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';

async function revealFile(repoPath: string, range: CodeRange) {
  const absPath = `${repoPath}/${range.file}`;
  await revealItemInDir(absPath);
}

async function openInEditor(repoPath: string, range: CodeRange) {
  // Use Rust command for line-number support; fall back to openPath
  try {
    await invoke('open_in_editor', {
      path: `${repoPath}/${range.file}`,
      line: range.start_line,
    });
  } catch {
    await openPath(`${repoPath}/${range.file}`);
  }
}
```

### Drift State Display

```typescript
// Inspector.tsx — drift badge
function DriftBadge({ node }: { node: ContractNode }) {
  const state = driftState(node);
  if (state === 'untracked') return null;
  return (
    <div className={cn(
      'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium',
      state === 'drifted' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', state === 'drifted' ? 'bg-red-400' : 'bg-green-400')} />
      {state === 'drifted' ? 'Drifted' : 'Synced'}
      {state === 'drifted' && (
        <button className="ml-2 underline" onClick={() => console.log('TODO Phase 7: reconcile')}>
          Reconcile
        </button>
      )}
    </div>
  );
}
```

### CSP Update for iframe Preview

```json
// tauri.conf.json — add frame-src to existing security.csp
{
  "app": {
    "security": {
      "csp": {
        "default-src": ["'self'"],
        "script-src": ["'self'", "blob:"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "asset:", "https://asset.localhost"],
        "connect-src": ["'self'", "ipc:", "https://ipc.localhost"],
        "frame-src": ["http://localhost:*"]
      }
    }
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `deltaDecorations()` | `createDecorationsCollection()` | Monaco 0.50 (2024) | Old API still works but soft-deprecated; new API returns a collection object with `.set()/.clear()` |
| `editor.updateOptions({ readOnly })` | Same — still current | No change | `readOnly` option prevents all edits; simplest approach for code view tab |
| Manual `getWorkerUrl` in vite | `vite-plugin-monaco-editor` handles `getWorker` | 2023–2024 | Plugin injects `MonacoEnvironment.getWorkerUrl` in HTML transform; simpler than manual setup |
| `revealItemInDir` via Tauri v1 `open` plugin | `tauri-plugin-opener` in Tauri v2 | Tauri v2 release | `opener:allow-reveal-item-in-dir` permission replaces old `open:default` |
| `fetch()` for localhost probe from frontend | Rust `reqwest` command | Always been this way in Tauri | CORS blocks frontend fetch to external localhost; Rust has no CORS restriction |

**Deprecated/outdated in this phase:**
- `editor.deltaDecorations()`: still works, but use `createDecorationsCollection()` for new code.
- `@tauri-apps/api/shell` for `open`-like operations: use `@tauri-apps/plugin-opener` instead.

---

## vercel/commerce Preview Target

**What it is:** A Next.js storefront template. `npm run dev` starts on `http://localhost:3000`.

**Shopify credentials required:** YES, real credentials are required for the store to function. Three env vars needed in `.env.local`:
- `SHOPIFY_STORE_DOMAIN` — e.g. `mystore.myshopify.com`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN` — from Shopify Admin > Apps > Storefront API
- `SHOPIFY_REVALIDATION_SECRET` — arbitrary string for ISR

**Demo strategy options:**
1. Use a real Shopify Partner test store (free to create, no transaction fees) and commit `.env.local` to the demo repo with test credentials — FASTEST for demo.
2. Use a community demo store if available (check vercel/commerce README for `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` demo env example).
3. The Phase 4 success criterion (SC 6) requires the preview to boot; capture credentials BEFORE Phase 4 verification begins.

**Port:** Default `http://localhost:3000`.

**INSP-02 contract route values:** vercel/commerce routes like `/`, `/products`, `/cart` are already URL paths that map to real pages. Seed contracts must have valid `route` values from the actual running storefront.

---

## Open Questions

1. **`setHiddenAreas` on `editor` vs `model`**
   - What we know: `setHiddenAreas(ranges)` is a method on `ICodeEditor` (the editor instance), not `ITextModel`. It works in Monaco 0.50+.
   - What's unclear: Whether `setHiddenAreas` is exposed via `@monaco-editor/react`'s `Editor` component's `onMount` callback's `editor` param or requires accessing the underlying monaco instance separately.
   - Recommendation: In `onMount`, call `editor.setHiddenAreas(ranges)` directly — the editor instance passed to `onMount` is the full `IStandaloneCodeEditor` with all APIs. Verify by calling `typeof editor.setHiddenAreas` in the onMount callback during implementation.

2. **Multi-file code_ranges display**
   - What we know: A node like CheckoutButton may have `code_ranges = [{file: "...tsx", start: 1, end: 42}, {file: "...css", start: 1, end: 20}]`.
   - What's unclear: Whether to show both files stacked (two Monaco instances) or a tab/pill switcher (one Monaco instance, switch model).
   - Recommendation: Two Monaco instances stacked vertically, one per file, each with its own `setHiddenAreas`. Simpler than model-switching; avoids state management complexity. Add a file pill label above each instance showing the relative path.

3. **vercel/commerce Shopify credentials for demo**
   - What we know: Real credentials are required; free Shopify Partner test stores exist.
   - What's unclear: Which exact Shopify store Yang already has access to, or whether a new test store is needed.
   - Recommendation: Create a Shopify Partner account at partners.shopify.com and spin up a free development store. Commit `.env.local` to the `vercel/commerce` local checkout (NOT to the Contract IDE repo) before Phase 4 ends.

4. **`probe_route` HTTPS vs HTTP**
   - What we know: vercel/commerce `npm run dev` serves over HTTP at `localhost:3000`, not HTTPS.
   - What's unclear: If a future demo target uses HTTPS localhost, `reqwest` with `rustls-tls` handles both.
   - Recommendation: The probe is fine with plain HTTP. Document that the `probe_route` command is HTTP-only in the comment; HTTPS support comes for free from `rustls-tls`.

---

## Sources

### Primary (HIGH confidence)
- `/Users/yang/lahacks/contract-ide/vite.config.ts` — `vite-plugin-monaco-editor` already installed with `.default()` ESM workaround; workers validated Phase 1
- `/Users/yang/lahacks/contract-ide/src-tauri/tauri.conf.json` — CSP confirmed; `frame-src` missing, must add
- `/Users/yang/lahacks/contract-ide/src-tauri/capabilities/default.json` — opener permissions missing; must add
- `/Users/yang/lahacks/contract-ide/src/components/layout/Inspector.tsx` — existing tab shell confirmed
- `/Users/yang/lahacks/contract-ide/src/store/editor.ts` — existing dirty/undo store; Phase 4 extends it
- `/Users/yang/lahacks/contract-ide/src/store/graph.ts` — `selectNode` exists, never called; Phase 4 wires it
- `/Users/yang/lahacks/contract-ide/src-tauri/Cargo.toml` — `sha2` + `hex` already present; `reqwest` missing
- `https://v2.tauri.app/plugin/opener/` — official Tauri opener API: `revealItemInDir()`, `openPath(path, with?)`, permission identifiers (fetched 2026-04-24)
- `/Users/yang/lahacks/.planning/STATE.md` — Decisions: Monaco CSP + vite-plugin-monaco-editor must stay; autosave debounce deferred to Phase 4; Phase 4 replaces blur-only with debounced

### Secondary (MEDIUM confidence)
- Multiple community sources confirming `setHiddenAreas` + decoration dim pattern for range-scoped Monaco view (Medium articles, GitHub gists, DEV.to articles)
- Monaco changelog 0.50–0.55: `createDecorationsCollection` confirmed as replacement for `deltaDecorations`
- `https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md` — Vite integration uses `getWorker` (not `getWorkerUrl`) pattern; already handled by vite-plugin-monaco-editor
- `https://github.com/vercel/commerce` — requires real Shopify credentials; starts on localhost:3000 (fetched 2026-04-24)
- Tauri community: WKWebView does NOT enforce X-Frame-Options for localhost iframes in Tauri apps; Tauri CSP `frame-src` is what matters

### Tertiary (LOW confidence)
- `open_in_editor` Rust command approach with `$EDITOR` detection: based on known `code --goto file:N` and `vim +N file` CLI patterns; not tested against this specific Tauri setup. Verify during implementation.

---

## Metadata

**Confidence breakdown:**
- Monaco WKWebView workers: HIGH — validated in Phase 1 Day-1 verification
- Monaco `setHiddenAreas` + decorations: MEDIUM — verified through community sources, not official type-level docs; test immediately in onMount
- `tauri-plugin-opener` API: HIGH — official Tauri v2 docs fetched 2026-04-24
- Preview iframe CSP: HIGH — Tauri CSP mechanics are well-documented; `frame-src` pattern is standard
- `reqwest` probe: HIGH — standard Rust HTTP; rustls-tls feature flag verified approach
- vercel/commerce credentials: HIGH — official vercel/commerce README confirms Shopify credentials required
- Drift indicator: HIGH — fields already in `ContractNode` IPC type; pure frontend logic
- `open_in_editor` with line numbers: LOW — `$EDITOR` detection heuristic; verify at implementation time

**Research date:** 2026-04-24
**Valid until:** 2026-05-23 (Monaco 0.55.x stable; Tauri 2.x stable cadence; 30-day window)

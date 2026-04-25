# Phase 2: Contract Data Layer — Research

**Researched:** 2026-04-24
**Domain:** Sidecar `.md` frontmatter, SQLite migration v2, tauri-plugin-fs watch, folder picker, UUID-stable identity, startup scanner, IPC for real data
**Confidence:** HIGH (primary APIs verified via official Tauri v2 docs, plugin source, crates.io; file-watcher via plugin raw source on GitHub)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SHELL-02 | User opens a repository via folder picker and the app indexes it into the contract cache | Architecture Patterns §Folder Picker (tauri-plugin-dialog open() with directory:true); §Startup Scanner Flow |
| DATA-01 | Contracts persist as `.contracts/<uuid>.md` sidecar files with YAML frontmatter: `format_version`, `uuid`, `kind`, `level`, `parent`, `neighbors`, `code_ranges` (list of `{file, start_line, end_line}`), `code_hash`, `contract_hash`, `human_pinned`, `route`, `derived_at` | Architecture Patterns §Sidecar Frontmatter Schema; Standard Stack §serde-yaml-ng; Code Examples §Sidecar Round-Trip |
| DATA-02 | On startup, the app scans `.contracts/` and populates SQLite cache (nodes, edges, node_flows, drift_state, receipts, receipt_nodes) | Architecture Patterns §Startup Scanner Flow; §Migration v2 (code_ranges column) |
| DATA-03 | A file watcher keeps the SQLite cache in sync as sidecar files change on disk | Architecture Patterns §File Watcher Integration; Standard Stack §tauri-plugin-fs watch feature |
| DATA-04 | Node identity is stable under rename/move — sidecar UUID is canonical, filename and `code_ranges.file` are metadata | Architecture Patterns §UUID Stability Under Rename; Common Pitfalls §UUID in Filename vs. Frontmatter |
| DATA-05 | Canonical + reference model — shared nodes have one sidecar (`is_canonical=1`); ghost references are SQLite-only rows linked by `canonical_uuid`, regenerated from `node_flows` membership on rebuild | Architecture Patterns §Canonical vs. Ghost Reference Model |
| DATA-06 | Schema changes after Phase 1 ship as numbered `tauri-plugin-sql` migration files — no manual DB deletions during parallel development | Architecture Patterns §Migration v2; Don't Hand-Roll §migration runner; Code Examples §Migration v2 SQL |
</phase_requirements>

---

## Summary

Phase 2 has six distinct subproblems: (1) define the sidecar `.md` frontmatter schema and make it round-trip through `serde-yaml-ng`, (2) add a SQLite migration v2 that adds `code_ranges TEXT` and `kind TEXT` columns to `nodes` (Phase 1 left `file_path` as placeholder), (3) implement a startup scanner that walks `.contracts/` and populates SQLite, (4) wire the `tauri-plugin-fs` watch feature to keep the cache live on disk changes, (5) implement the folder picker (`tauri-plugin-dialog`) so users can open a repo, and (6) make `get_nodes` return real data so Phase 3's graph canvas has something to render.

The file-watcher story is simpler than expected: `tauri-plugin-fs` v2.5.0 already ships a `watch` feature that wraps `notify` + `notify-debouncer-full` behind a JS-callable API with `delayMs` (defaults to 2000ms). This matches the 2-second update target in DATA-03's success criterion exactly. No raw `notify` crate needed — the plugin handles debouncing and event routing to the frontend automatically.

The YAML frontmatter strategy is: read the `.md` file in Rust, split on the `---` fence, parse just the frontmatter block with `serde-yaml-ng` (the active fork of deprecated `serde_yaml`), and upsert into SQLite. All sidecar writes go through a Rust IPC command (single-writer rule), never directly from JS or MCP. UUID stability is enforced by making the UUID live only in the frontmatter `uuid:` field — the filename is `<uuid>.md` for human readability but is never used as an identifier in SQLite.

**Primary recommendation:** Use `tauri-plugin-fs` watch feature (not raw notify), `serde-yaml-ng` for YAML parsing, `walkdir` for startup scan, `uuid` crate with v4 generation for new sidecars, and deliver the `open_repo` IPC command + `get_nodes` real-data path as the integration seam Phase 3 depends on.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tauri-plugin-fs` | 2.5.0 | File watching with built-in debounce + `watch` feature flag | Wraps `notify` + `notify-debouncer-full`; JS callback API; 2s default debounce matches DATA-03 target; already in Tauri plugin ecosystem |
| `tauri-plugin-dialog` | 2.7.0 | Folder picker (SHELL-02) | Official Tauri plugin; `open({directory: true})` returns path string; `dialog:allow-open` permission |
| `serde-yaml-ng` | 0.10.0 | YAML frontmatter parse/serialize | Active fork of deprecated `serde_yaml` (0.9.34+deprecated); same API; 3M+ downloads; `from_str()` + `to_string()` with `#[derive(Serialize, Deserialize)]` |
| `walkdir` | 2.5.0 | Recursive `.contracts/` scan at startup | Industry standard for recursive directory traversal in Rust; handles symlinks, errors gracefully |
| `uuid` | 1.23.1 | Generate v4 UUIDs for new sidecar files | Official `uuid` crate; `Uuid::new_v4()` with `v4` feature; stable |
| `sha2` | 0.11.0 | Compute `code_hash` and `contract_hash` from file content | `Sha256` hasher; hex-encoded digest; used for drift detection in Phases 6–7 |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `notify-debouncer-full` | (pulled by tauri-plugin-fs) | Debounced file events | Already a transitive dep of `tauri-plugin-fs watch`; don't add separately |
| `@tauri-apps/plugin-fs` | 2.x JS | JS-side watch subscription + unwatch | Frontend: `watch(path, cb, {recursive: true, delayMs: 2000})` returns `UnwatchFn` |
| `@tauri-apps/plugin-dialog` | 2.x JS | Frontend folder picker | `open({directory: true, multiple: false})` returns `string | null` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tauri-plugin-fs` watch | Raw `notify` + `notify-debouncer-mini` in Rust | Raw notify gives more control but requires manual Tauri event emission wiring; plugin already handles the emit plumbing; use plugin |
| `serde-yaml-ng` | `serde_yaml` (0.9.34) | `serde_yaml` is deprecated (`+deprecated` in version string); same API, use the ng fork |
| `walkdir` | `std::fs::read_dir` recursive | `read_dir` needs manual recursion + error handling; walkdir handles all edge cases |
| `uuid` v4 | nanoid or ulid | UUID v4 is the standard for stable identity; no sortability needed; use uuid |

**Installation (additions to Phase 1):**

```bash
# Frontend JS plugins
npm install @tauri-apps/plugin-fs @tauri-apps/plugin-dialog
```

```toml
# src-tauri/Cargo.toml additions
tauri-plugin-fs = { version = "2", features = ["watch"] }
tauri-plugin-dialog = "2"
serde-yaml-ng = "0.10"
walkdir = "2"
uuid = { version = "1", features = ["v4"] }
sha2 = "0.11"
hex = "0.4"
```

---

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)

```
contract-ide/
├── src/
│   ├── ipc/
│   │   ├── types.ts               # EXTEND: add code_ranges, kind; update ContractNode
│   │   ├── nodes.ts               # EXTEND: getNodes() returns real data
│   │   └── repo.ts                # NEW: openRepo(), getRepoPath() typed wrappers
│   └── components/
│       └── layout/
│           └── GraphPlaceholder.tsx  # UPDATE: remove ?force-error; wire openRepo
│
├── src-tauri/
│   └── src/
│       ├── commands/
│       │   ├── nodes.rs           # EXTEND: real SQLite SELECT in get_nodes
│       │   └── repo.rs            # NEW: open_repo (picker + scan + watch), get_repo_path
│       ├── db/
│       │   ├── migrations.rs      # EXTEND: add Migration { version: 2, ... }
│       │   └── scanner.rs         # NEW: scan_contracts_dir(), upsert_node()
│       ├── sidecar/
│       │   └── frontmatter.rs     # NEW: ContractFrontmatter struct + parse/write helpers
│       └── watcher.rs             # NEW: setup_watcher(), handle_watch_event()
```

### Pattern 1: Sidecar Frontmatter Schema

**What:** A `.contracts/<uuid>.md` file with a YAML frontmatter block followed by free-form contract body text
**When to use:** Every contract node persists as one of these files; the frontmatter is the source of truth for identity and metadata

```markdown
---
format_version: 1
uuid: "550e8400-e29b-41d4-a716-446655440000"
kind: "UI"
level: "L2"
parent: "parent-uuid-here"
neighbors:
  - "neighbor-uuid-1"
  - "neighbor-uuid-2"
code_ranges:
  - file: "src/components/CheckoutButton.tsx"
    start_line: 1
    end_line: 42
  - file: "src/components/CheckoutButton.css"
    start_line: 1
    end_line: 20
code_hash: "abc123def456..."
contract_hash: "def456abc123..."
human_pinned: false
route: "/cart"
derived_at: "2026-04-24T12:00:00Z"
---

The checkout button component handles payment submission. It validates cart state before proceeding and shows a loading spinner during async payment processing.
```

```rust
// src-tauri/src/sidecar/frontmatter.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodeRange {
    pub file: String,
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContractFrontmatter {
    pub format_version: u32,
    pub uuid: String,
    pub kind: String,
    pub level: String,
    pub parent: Option<String>,
    #[serde(default)]
    pub neighbors: Vec<String>,
    #[serde(default)]
    pub code_ranges: Vec<CodeRange>,
    pub code_hash: Option<String>,
    pub contract_hash: Option<String>,
    #[serde(default)]
    pub human_pinned: bool,
    pub route: Option<String>,
    pub derived_at: Option<String>,
}

/// Parse a sidecar .md file into (frontmatter, body_text).
/// Returns Err if the file doesn't start with --- or frontmatter is invalid YAML.
pub fn parse_sidecar(content: &str) -> anyhow::Result<(ContractFrontmatter, String)> {
    let content = content.trim_start();
    if !content.starts_with("---") {
        anyhow::bail!("sidecar missing YAML frontmatter fence");
    }
    let rest = &content[3..];
    let end = rest.find("\n---").ok_or_else(|| anyhow::anyhow!("frontmatter closing --- not found"))?;
    let yaml = &rest[..end];
    let body = rest[end + 4..].trim_start().to_string();
    let fm: ContractFrontmatter = serde_yaml_ng::from_str(yaml)?;
    Ok((fm, body))
}

/// Serialize frontmatter + body back to sidecar string.
pub fn write_sidecar(fm: &ContractFrontmatter, body: &str) -> anyhow::Result<String> {
    let yaml = serde_yaml_ng::to_string(fm)?;
    Ok(format!("---\n{}---\n\n{}", yaml, body))
}
```

### Pattern 2: Migration v2 — Add `code_ranges` and `kind` Columns

**What:** Numbered migration (version 2) that adds the Phase 2 columns to `nodes` without touching the immutable v1 migration
**When to use:** Add to `get_migrations()` vec in `src-tauri/src/db/migrations.rs`

```rust
// src-tauri/src/db/migrations.rs — append to the vec
Migration {
    version: 2,
    description: "add_code_ranges_and_kind",
    sql: r#"
-- Phase 2: DATA-01 adds code_ranges (JSON array of {file, start_line, end_line})
-- and kind (UI | API | data | job) to nodes. file_path is deprecated but kept
-- for backward compat until all rows are migrated to code_ranges.
ALTER TABLE nodes ADD COLUMN code_ranges TEXT;
ALTER TABLE nodes ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown';
"#,
    kind: MigrationKind::Up,
}
```

**Critical:** `ALTER TABLE ... ADD COLUMN` is safe in SQLite for nullable or DEFAULT-bearing columns. Never `DROP` or `RENAME` columns in a migration — SQLite pre-3.35 doesn't support it; use a new column + data migration instead.

### Pattern 3: Startup Scanner Flow

**What:** On `open_repo` command, walk `.contracts/`, parse each sidecar, upsert into SQLite
**When to use:** Called once when user opens a repository; watcher takes over after

```rust
// src-tauri/src/db/scanner.rs
use walkdir::WalkDir;
use tauri_plugin_sql::DbPool;

pub async fn scan_contracts_dir(
    repo_path: &std::path::Path,
    db: &sqlx::Pool<sqlx::Sqlite>,  // obtained from DbInstances state
) -> anyhow::Result<ScanResult> {
    let contracts_dir = repo_path.join(".contracts");
    if !contracts_dir.exists() {
        return Ok(ScanResult::empty());
    }

    let mut seen_uuids: std::collections::HashSet<String> = Default::default();
    let mut errors: Vec<String> = Vec::new();

    for entry in WalkDir::new(&contracts_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
    {
        let content = std::fs::read_to_string(entry.path())?;
        match crate::sidecar::frontmatter::parse_sidecar(&content) {
            Ok((fm, body)) => {
                // Duplicate UUID detection (DATA-02 success criterion 5)
                if seen_uuids.contains(&fm.uuid) {
                    errors.push(format!("Duplicate UUID {} in {}", fm.uuid, entry.path().display()));
                    continue;
                }
                seen_uuids.insert(fm.uuid.clone());
                upsert_node(db, &fm, &body).await?;
            }
            Err(e) => {
                errors.push(format!("Parse error {}: {}", entry.path().display(), e));
            }
        }
    }

    Ok(ScanResult { node_count: seen_uuids.len(), errors })
}

async fn upsert_node(
    db: &sqlx::Pool<sqlx::Sqlite>,
    fm: &crate::sidecar::frontmatter::ContractFrontmatter,
    body: &str,
) -> anyhow::Result<()> {
    let code_ranges_json = serde_json::to_string(&fm.code_ranges)?;
    let neighbors_json = serde_json::to_string(&fm.neighbors)?;
    sqlx::query!(
        r#"
        INSERT INTO nodes (uuid, level, name, kind, code_ranges, parent_uuid,
                           code_hash, contract_hash, human_pinned, route,
                           derived_at, contract_body, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, datetime('now'))
        ON CONFLICT(uuid) DO UPDATE SET
            level=excluded.level, kind=excluded.kind,
            code_ranges=excluded.code_ranges, parent_uuid=excluded.parent_uuid,
            code_hash=excluded.code_hash, contract_hash=excluded.contract_hash,
            human_pinned=excluded.human_pinned, route=excluded.route,
            derived_at=excluded.derived_at, contract_body=excluded.contract_body,
            updated_at=datetime('now')
        "#,
        fm.uuid, fm.level, /* name from first code_range or uuid */ fm.uuid,
        fm.kind, code_ranges_json, fm.parent,
        fm.code_hash, fm.contract_hash, fm.human_pinned as i32,
        fm.route, fm.derived_at, body,
    ).execute(db).await?;
    Ok(())
}
```

**Getting the DB pool from managed state:**

```rust
// In a #[tauri::command] that needs the DB pool:
use tauri_plugin_sql::DbInstances;

#[tauri::command]
pub async fn open_repo(
    app: tauri::AppHandle,
    repo_path: String,
) -> Result<ScanResult, String> {
    let instances = app.state::<DbInstances>();
    let db_instances = instances.0.read().await;
    let db = db_instances
        .get("sqlite:contract-ide.db")
        .ok_or("DB not loaded")?;
    
    let path = std::path::Path::new(&repo_path);
    crate::db::scanner::scan_contracts_dir(path, db)
        .await
        .map_err(|e| e.to_string())
}
```

**Note:** `DbInstances` is registered by `tauri-plugin-sql` as managed state. Access via `app.state::<DbInstances>()`. The inner type is `Arc<RwLock<HashMap<String, DbPool>>>`.

### Pattern 4: File Watcher Integration (tauri-plugin-fs)

**What:** Use `tauri-plugin-fs` watch feature (not raw notify) to watch `.contracts/` directory and re-scan changed files into SQLite
**When to use:** Called immediately after `open_repo`; the JS side sets up the watcher and emits to Zustand

```rust
// src-tauri/Cargo.toml
tauri-plugin-fs = { version = "2", features = ["watch"] }
```

```typescript
// src/ipc/repo.ts — JS-side watcher setup
import { watch } from '@tauri-apps/plugin-fs';

let unwatchFn: (() => void) | null = null;

export async function watchContractsDir(
  contractsPath: string,
  onChanged: (changedPaths: string[]) => void
): Promise<void> {
  if (unwatchFn) unwatchFn(); // stop previous watcher
  unwatchFn = await watch(
    contractsPath,
    (event) => {
      // event.type: 'any' | {create: ...} | {modify: ...} | {remove: ...} | {rename: ...}
      // event.paths: string[] of affected paths
      onChanged(event.paths);
    },
    { recursive: true, delayMs: 2000 }
  );
}

export function stopWatcher(): void {
  if (unwatchFn) { unwatchFn(); unwatchFn = null; }
}
```

```typescript
// WatchEvent type from @tauri-apps/plugin-fs
interface WatchEvent {
  type: 'any' | 'other' | WatchEventKindObject;
  paths: string[];
  attrs: unknown;
}
// On file change, invoke a Rust command to re-parse the changed sidecar files:
// invoke('refresh_nodes', { paths: event.paths })
```

**Alternative (Rust-side watch):** The plugin exposes watch via JS only; Rust-side watching still requires the raw `notify` crate. For Phase 2, the JS-side watch → Rust `refresh_nodes` invoke pattern is simpler and sufficient.

### Pattern 5: Folder Picker (SHELL-02)

**What:** `tauri-plugin-dialog` `open({directory: true})` returns the selected repo path; then call `open_repo` IPC
**When to use:** User clicks "Open Repository" in UI (GraphPlaceholder empty state or menu)

```typescript
// src/ipc/repo.ts
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

export async function pickAndOpenRepo(): Promise<ScanResult | null> {
  const folder = await open({ multiple: false, directory: true });
  if (!folder) return null;  // user cancelled
  return invoke<ScanResult>('open_repo', { repoPath: folder });
}
```

```json
// src-tauri/capabilities/default.json — add to permissions array
"fs:allow-watch",
"fs:allow-read-text-file",
"dialog:allow-open"
```

**Note:** `dialog:default` would grant more than needed. Use `dialog:allow-open` for minimal surface. For file read access, we need `fs:allow-read-text-file` or `fs:read-all`. Watch requires `fs:allow-watch` explicitly (not in `fs:default`).

### Pattern 6: UUID Stability Under Rename/Move

**What:** UUID lives in frontmatter only; `code_ranges[].file` is metadata that updates without UUID change
**When to use:** When a source file is renamed/moved, the watcher fires; the scanner re-reads the sidecar whose `code_ranges[].file` now points to the new path; SQLite `code_ranges` column is updated via upsert (same UUID = UPDATE, not INSERT)

```
File rename scenario:
  User moves src/Button.tsx → src/components/Button.tsx
  
  Watcher fires on .contracts/550e8400-...md (sidecar content is unchanged)
  OR: User updates the sidecar code_ranges.file manually
  Scanner re-reads sidecar → UUID same → ON CONFLICT(uuid) DO UPDATE sets new code_ranges
  
  Result: SQLite row has updated code_ranges; UUID unchanged; edge history intact
```

**The filename `<uuid>.md` is NOT the identity source.** The `uuid:` field in frontmatter is. If someone renames the `.md` file itself, the scanner reads frontmatter UUID (not the filename) and maps correctly.

### Pattern 7: Canonical vs. Ghost Reference Model (DATA-05)

**What:** Nodes shared across multiple flows have exactly one sidecar (`is_canonical=1`); ghost references are SQLite-only rows in `node_flows` with `is_canonical=0` and `canonical_uuid` pointing to the sidecar's UUID
**When to use:** When the scanner encounters a node referenced in multiple `node_flows` entries

```rust
// Ghost references are generated from node_flows during scan rebuild:
// 1. Sidecar exists → INSERT/UPDATE nodes row with is_canonical=1
// 2. Flow membership defined via node_flows.flow_uuid entries
// 3. Ghost refs → INSERT nodes row with is_canonical=0, canonical_uuid=<sidecar_uuid>
//    (these have no sidecar on disk; they are derived from node_flows membership)

// Ghost nodes in SQLite:
// uuid: "ghost-{canonical_uuid}-{flow_uuid}", is_canonical: 0, canonical_uuid: <canonical_uuid>
// On rebuild: DELETE WHERE is_canonical=0 first, then re-derive from node_flows
```

**Simplification for Phase 2:** Phase 2 can seed `is_canonical=1` for all directly-scanned sidecars and leave ghost generation for Phase 3 (graph canvas needs ghosts to render multi-flow membership). This is not a correctness issue; Phase 3 will add a `rebuild_ghost_refs()` call.

### Pattern 8: `get_nodes` Real Data Path

**What:** Replace Phase 1's `Ok(Vec::new())` stub with a real SQLite SELECT
**When to use:** Phase 2 completion — this is the integration seam Phase 3 depends on

```rust
// src-tauri/src/commands/nodes.rs
use tauri_plugin_sql::DbInstances;

#[tauri::command]
pub async fn get_nodes(
    app: tauri::AppHandle,
    level: Option<String>,
    parent_uuid: Option<String>,
) -> Result<Vec<ContractNode>, String> {
    let instances = app.state::<DbInstances>();
    let db_map = instances.0.read().await;
    let db = db_map.get("sqlite:contract-ide.db").ok_or("DB not loaded")?;

    // Build query dynamically or use multiple query paths:
    let nodes = sqlx::query_as!(
        ContractNodeRow,
        "SELECT uuid, level, name, kind, file_path, code_ranges, parent_uuid,
                is_canonical, canonical_uuid, code_hash, contract_hash,
                human_pinned, route, derived_at, contract_body, tags
         FROM nodes
         WHERE (?1 IS NULL OR level = ?1)
           AND (?2 IS NULL OR parent_uuid = ?2)",
        level, parent_uuid
    )
    .fetch_all(db)
    .await
    .map_err(|e| e.to_string())?;

    nodes.into_iter().map(|r| r.try_into()).collect::<Result<Vec<_>, _>>()
        .map_err(|e: anyhow::Error| e.to_string())
}
```

**Note:** `app: tauri::AppHandle` must be added to the command signature in Phase 2 (Phase 1 stub did not need it). The `#[allow(unused_variables)]` annotation should be removed when real logic is added.

### Anti-Patterns to Avoid

- **Writing sidecars from JS directly:** All sidecar file writes go through a Rust IPC command. JS calls `invoke('write_contract', {uuid, frontmatter, body})`; Rust does the atomic write (temp + rename). Never `@tauri-apps/plugin-fs` write from JS for sidecar content.
- **Using filename as UUID:** Never do `path.stem()` to get the UUID. Always parse frontmatter `uuid:` field. A renamed `.md` file would break identity.
- **Modifying migration v1 SQL:** Any schema change ships as `Migration { version: 2, ... }`. The v1 `create_core_tables` string is immutable — editing it creates a mismatch between applied DB state and source code.
- **Re-scanning all of `.contracts/` on every watch event:** The watcher fires per-file. Re-scan only the changed file (`event.paths`), not the whole directory. Full rescan only on `open_repo`.
- **Blocking the Tauri main thread with walkdir:** Wrap `scan_contracts_dir` in `tauri::async_runtime::spawn_blocking(|| ...)` if `walkdir` is synchronous, then `.await` the result. Don't call synchronous I/O directly inside an `async fn` that runs on Tokio's executor.
- **Storing ghost refs as sidecars:** Ghost references have no `.md` file on disk. They exist only in SQLite. Attempting to write a ghost sidecar would create an orphaned file that the scanner would try to re-import.
- **Emitting watch events as raw paths to React without debouncing:** `tauri-plugin-fs` watch already debounces; don't add a second debounce layer in Zustand.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File watching with debounce | Custom `notify` + mpsc loop + timer | `tauri-plugin-fs` watch feature | Plugin already wires `notify-debouncer-full` + Tauri event emission; 2s default matches DATA-03 target |
| YAML parsing | Custom frontmatter regex parser | `serde-yaml-ng` | YAML has many edge cases (multiline strings, special chars, bare vs. quoted values); use the library |
| Directory traversal | `std::fs::read_dir` recursive impl | `walkdir` crate | Handles symlinks, errors, depth limits, cross-platform; battle-tested |
| SQLite migrations | Manual version checks in Rust code | `tauri-plugin-sql` `Migration { version: N }` | Plugin tracks applied versions in `_sqlx_migrations` table; ordering, atomicity, fail-fast all handled |
| UUID generation | Custom random hex string | `uuid` crate `Uuid::new_v4()` | Standard format, no collisions, accepted by all tooling |
| File hashing | Custom SHA impl | `sha2` crate | Constant-time, well-audited; one-liner: `Sha256::digest(bytes)` |
| Folder picker UI | Custom file tree component | `tauri-plugin-dialog` `open({directory: true})` | Native OS folder picker; no permission footprint beyond `dialog:allow-open` |

**Key insight:** Every piece of Phase 2's infrastructure is a solved problem. The novel work is the scanner logic, the frontmatter schema design, and the SQLite upsert that connects them. Don't spend time on file watching or YAML parsing from scratch.

---

## Common Pitfalls

### Pitfall 1: `DbInstances` Access Pattern in Rust Commands

**What goes wrong:** `tauri_plugin_sql::DbInstances` is a newtype wrapping `Arc<RwLock<HashMap<String, DbPool>>>`. Calling `.read()` returns a `RwLockReadGuard` that must be held for the duration of the DB query; dropping it early (e.g., by cloning the `DbPool` with a simple `.clone()`) may panic or give a stale reference.
**Why it happens:** Developers try to get the pool out of the lock before the async query, then the lock guard is dropped.
**How to avoid:** Keep the `db_map` guard alive until after `fetch_all()` completes. Pattern: `let db_map = instances.0.read().await; let db = db_map.get("sqlite:contract-ide.db")?;` — both `db_map` and `db` stay in scope through the query.
**Warning signs:** Compiler error about lifetimes when trying to use `db` after `db_map` is dropped; or runtime panic on `.get()`.

### Pitfall 2: `ALTER TABLE ADD COLUMN` with NOT NULL Constraint

**What goes wrong:** SQLite `ALTER TABLE ADD COLUMN` fails if the column is declared `NOT NULL` without a `DEFAULT` clause. The migration errors out: "Cannot add a NOT NULL column with no default value."
**Why it happens:** Developers write `ADD COLUMN kind TEXT NOT NULL` without a default, but existing rows can't provide a value.
**How to avoid:** Add `DEFAULT 'unknown'` (or similar sentinel) to every NOT NULL column added via `ALTER TABLE`. Document the sentinel as a Phase 6 derivation target.
**Warning signs:** Migration fails at startup with "not null constraint" error; `_sqlx_migrations` shows version 2 not applied.

### Pitfall 3: Duplicate UUID Detection Timing

**What goes wrong:** Two sidecar files with the same `uuid:` in frontmatter. The scanner silently last-one-wins on upsert if duplicate detection isn't done first, corrupting the graph.
**Why it happens:** Copy-paste of a sidecar file during demo seeding; or a developer duplicates a `.md` file manually.
**How to avoid:** Track `seen_uuids: HashSet<String>` in the scanner. Before upsert, check membership; if duplicate found, push to `errors` vec and surface as a visible error (success criterion 5 in Phase 2 ROADMAP).
**Warning signs:** Graph shows one node where two should exist; no error surfaced to user.

### Pitfall 4: Watch Fires Before Scanner Completes

**What goes wrong:** The watcher starts immediately on `open_repo`. While the startup scan is processing files, the watcher fires events for the same files (because the scan itself may touch timestamps or because fast-editors write the files). The watcher tries to upsert while the scanner is also upserting — potential SQLite write conflict.
**Why it happens:** No coordination between scanner and watcher start.
**How to avoid:** Start the watcher only AFTER the startup scan completes. Return `ScanResult` from `open_repo`, then JS calls `startWatcher(contractsPath)` as a separate step. Or: use a Rust-side `Arc<Mutex<bool>>` "scan_in_progress" flag that the watcher's callback checks before processing.
**Warning signs:** Duplicate processing log entries; occasional SQLite "database is locked" errors during startup.

### Pitfall 5: `serde_yaml` vs. `serde-yaml-ng` Naming

**What goes wrong:** Installing `serde_yaml` (deprecated, `0.9.34+deprecated`) instead of `serde-yaml-ng` (active fork, `0.10.0`).
**Why it happens:** `serde_yaml` is the historically-known name; easy to add without noticing the deprecation marker.
**How to avoid:** In `Cargo.toml`, use `serde-yaml-ng = "0.10"`. The API is identical (same crate structure, same `from_str`/`to_string` functions). Import as `use serde_yaml_ng;` in Rust.
**Warning signs:** `cargo tree` shows `serde_yaml v0.9.34+deprecated`; crates.io page shows the `+deprecated` badge.

### Pitfall 6: YAML Multiline Strings in Contract Body

**What goes wrong:** If the contract body (free-form text below `---`) contains `---` itself (e.g., a markdown horizontal rule), the frontmatter parser can incorrectly split on it.
**Why it happens:** Simple `find("\n---")` parsing doesn't distinguish between end-of-frontmatter and mid-body occurrences.
**How to avoid:** The closing frontmatter fence is `\n---\n` (newline before AND after). After splitting on the first `\n---\n`, treat everything else as body. The body is never passed to the YAML parser.
**Warning signs:** `parse_sidecar` returns `Ok` but the `body` is truncated; the remainder shows up as a second phantom frontmatter.

### Pitfall 7: `tauri-plugin-fs` Watch Requires JS-Side Setup

**What goes wrong:** Thinking the watch setup can be done entirely in Rust (like raw `notify`). The `tauri-plugin-fs` watch feature exposes watch registration via JS only — there is no Rust-side `FsExt::watch()` that emits Tauri events.
**Why it happens:** Plugin source shows JS bindings, but developers assume Rust-side API mirrors it.
**How to avoid:** The watcher must be started from JS (via `watch()` from `@tauri-apps/plugin-fs`). The callback receives `WatchEvent`; the JS handler then calls `invoke('refresh_nodes', { paths })` to drive the Rust upsert. This is the intended pattern.
**Warning signs:** No TypeScript type errors, but the watcher never fires; checking the Rust side for a `watch` command that doesn't exist.

### Pitfall 8: `get_nodes` Signature Change Breaks Phase 3

**What goes wrong:** Adding `app: tauri::AppHandle` to `get_nodes` changes the invoke signature. Phase 3 components calling `getNodes()` may fail if the TS wrapper isn't updated simultaneously.
**Why it happens:** Rust command signature change isn't reflected in the typed TS wrapper.
**How to avoid:** Update `src/ipc/nodes.ts` wrapper in the same commit that modifies `get_nodes` in Rust. The wrapper already uses `invoke<ContractNode[]>('get_nodes', params)` — the `AppHandle` is injected by Tauri automatically and is NOT part of the JS-callable params.
**Warning signs:** `invoke('get_nodes')` starts returning unexpected errors after Phase 2.

---

## Code Examples

Verified patterns from official sources and architecture decisions:

### Migration v2 — Full SQL

```rust
// Source: tauri-plugin-sql migration system (v2.tauri.app/plugin/sql/)
Migration {
    version: 2,
    description: "add_code_ranges_and_kind",
    sql: r#"
-- DATA-01: code_ranges replaces flat file_path for fragment coverage support.
-- code_ranges is a JSON TEXT column containing [{file, start_line, end_line}].
ALTER TABLE nodes ADD COLUMN code_ranges TEXT;

-- kind encodes node type: UI | API | data | job (Phase 4 renders these distinctly).
-- DEFAULT 'unknown' satisfies NOT NULL without breaking existing rows.
ALTER TABLE nodes ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown';
"#,
    kind: MigrationKind::Up,
}
```

### Sidecar Round-Trip Test

```rust
// Verify frontmatter survives parse → serialize → parse round-trip:
let raw = r#"---
format_version: 1
uuid: "550e8400-e29b-41d4-a716-446655440000"
kind: "UI"
level: "L2"
parent: null
neighbors: []
code_ranges:
  - file: "src/Button.tsx"
    start_line: 1
    end_line: 42
code_hash: null
contract_hash: null
human_pinned: false
route: null
derived_at: null
---

The checkout button component.
"#;
let (fm, body) = parse_sidecar(raw).unwrap();
assert_eq!(fm.uuid, "550e8400-e29b-41d4-a716-446655440000");
assert_eq!(fm.code_ranges[0].file, "src/Button.tsx");
assert_eq!(body, "The checkout button component.");
let serialized = write_sidecar(&fm, &body).unwrap();
let (fm2, body2) = parse_sidecar(&serialized).unwrap();
assert_eq!(fm.uuid, fm2.uuid);
assert_eq!(body, body2);
```

### Tauri Emit to Frontend (for watcher progress or error events)

```rust
// Source: v2.tauri.app/develop/calling-frontend/ — Emitter trait
use tauri::Emitter;  // bring the trait into scope

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ContractsUpdatedPayload {
    node_uuids: Vec<String>,
    error: Option<String>,
}

// In watcher callback or scan complete:
app_handle.emit("contracts:updated", ContractsUpdatedPayload {
    node_uuids: updated_uuids,
    error: None,
}).unwrap();
```

```typescript
// Frontend listener (already established pattern from Phase 1 research):
import { listen } from '@tauri-apps/api/event';

useEffect(() => {
  const unlisten = listen<{ nodeUuids: string[]; error?: string }>(
    'contracts:updated',
    (event) => graphStore.getState().refreshNodes(event.payload.nodeUuids)
  );
  return () => { unlisten.then(f => f()); };
}, []);
```

### AppHandle Injection in Tauri Commands

```rust
// AppHandle is automatically injected by Tauri — NOT passed from JS.
// No change needed to JS invoke() call when adding AppHandle to a command.
#[tauri::command]
pub async fn open_repo(
    app: tauri::AppHandle,   // injected by Tauri runtime
    repo_path: String,       // passed from JS invoke('open_repo', { repoPath: '...' })
) -> Result<ScanResult, String> { ... }
```

### Capabilities JSON Update

```json
// src-tauri/capabilities/default.json — Phase 2 additions
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "shell:allow-execute",
    "shell:allow-spawn",
    "sql:default",
    "fs:allow-read-text-file",
    "fs:allow-watch",
    "dialog:allow-open"
  ]
}
```

---

## Phase 1 Inheritance — What Phase 2 Extends

| Phase 1 Asset | Phase 2 Use | Change Required |
|---------------|-------------|-----------------|
| `src-tauri/src/db/migrations.rs` | Add `Migration { version: 2 }` | Append to vec; DO NOT touch version 1 |
| `src-tauri/src/commands/nodes.rs` | `get_nodes` returns real data | Add `app: AppHandle`; replace `Ok(Vec::new())` with SQLite SELECT |
| `src/ipc/types.ts` | `ContractNode` needs `code_ranges`, `kind` | Add new fields; update TS interface |
| `src/ipc/nodes.ts` | `getNodes()` wrapper unchanged | No change to JS invoke signature |
| `src-tauri/capabilities/default.json` | Add fs + dialog permissions | Append three new permission strings |
| `src-tauri/src/lib.rs` | Register new plugins + commands | Add `tauri-plugin-fs`, `tauri-plugin-dialog`; register `open_repo`, `refresh_nodes`, `write_contract` |
| `src/components/layout/GraphPlaceholder.tsx` | Remove `?force-error` override; add "Open Repo" button | Per-spec cleanup deferred from Phase 1 |
| SQLite schema (live DB) | Migration v2 runs on next launch | No manual action; plugin applies automatically |

**Key constraint:** The `nodes` table in the live DB has `file_path TEXT` but NOT `code_ranges` or `kind`. Phase 2's migration v2 adds both via `ALTER TABLE`. Existing rows get `code_ranges = NULL` and `kind = 'unknown'` — acceptable defaults for the Phase 2 startup scanner to overwrite.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `serde_yaml` crate | `serde-yaml-ng` (active fork) | serde_yaml deprecated 2024 | Same API; use `serde-yaml-ng` in Cargo.toml; import as `serde_yaml_ng` in Rust |
| Raw `notify` crate in Tauri | `tauri-plugin-fs` watch feature | tauri-plugin-fs v2.2+ | Watch + debounce built in; JS-callable; no Rust wiring needed |
| `notify-debouncer-mini` | `notify-debouncer-full` (used by plugin) | Plugin uses `full` variant | `full` provides richer event types (AccessKind, CreateKind, ModifyKind); `mini` is simpler but less informative |

**Deprecated/outdated:**
- `serde_yaml v0.9.34+deprecated`: explicitly deprecated. Use `serde-yaml-ng`.
- Raw `notify` crate + manual Tauri event wiring: still works but adds boilerplate that `tauri-plugin-fs` eliminates for Phase 2's use case.

---

## Open Questions

1. **Rust-side watch initiation vs. JS-side**
   - What we know: `tauri-plugin-fs` watch is JS-side only; Rust raw notify still possible but adds complexity
   - What's unclear: Whether we need Rust-initiated watching (e.g., for non-window contexts like MCP sidecar in Phase 5)
   - Recommendation: Phase 2 uses JS-side watch (simpler); Phase 7 (drift detection) may need Rust-side `notify` for the code file watcher that lives outside the `.contracts/` directory. Phase 2 scope is `.contracts/` only — JS-side is fine.

2. **`DbInstances` access in `tauri-plugin-sql` v2.4 vs. v2.3**
   - What we know: `app.state::<DbInstances>()` works per plugin source code; the `DbInstances` struct is `pub`
   - What's unclear: Whether this is a stable public API or an implementation detail; docs only show JS-side usage
   - Recommendation: Use it — it's the only Rust-side path to the pool. If the plugin version bumps and breaks this, the fix is contained to `scanner.rs` and `nodes.rs`. Flag this as MEDIUM confidence.

3. **`code_ranges` JSON column vs. normalized table**
   - What we know: `code_ranges TEXT` (JSON blob) is what we chose; alternative is a `code_range_entries` normalized table
   - What's unclear: Whether Phase 9 FTS5 search needs to index individual file paths in `code_ranges`
   - Recommendation: Stay with JSON blob for Phase 2. Phase 9's FTS5 search is over `contract_body` and `name`, not over individual file paths in `code_ranges`. If path-indexed search is needed later, a migration can add a denormalized `file_paths TEXT` column.

4. **Ghost ref generation timing**
   - What we know: DATA-05 requires ghost refs in SQLite; they're derived from `node_flows` membership
   - What's unclear: Whether Phase 2 scanner should generate ghost refs or defer to Phase 3 graph canvas
   - Recommendation: Phase 2 scanner populates `nodes` + `node_flows` from sidecar frontmatter only (canonical nodes). Ghost ref generation (`is_canonical=0` rows) can be a `rebuild_ghost_refs()` call added in Phase 3 when the graph canvas actually renders them. Phase 2 success criterion 1 says "`get_nodes` returning real data" — returning canonical nodes satisfies this; ghost refs are needed only when Phase 3 renders multi-flow membership.

---

## Sources

### Primary (HIGH confidence)

- `https://v2.tauri.app/plugin/sql/` — Migration struct, `add_migrations()`, `preload` config, version tracking, transaction atomicity
- `https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/fs/guest-js/index.ts` — `watch()` and `watchImmediate()` exact TypeScript signatures, `WatchEvent` type structure, `DebouncedWatchOptions` (recursive, delayMs default 2000ms)
- `https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/Cargo.toml` — `[features] watch = ["notify", "notify-debouncer-full"]` — watch is optional; must add `features = ["watch"]`
- `https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/src/lib.rs` — `DbInstances` managed state; `instances.0.read().await` pattern for Rust-side pool access
- `https://v2.tauri.app/develop/calling-frontend/` — `app.emit("event-name", payload)` via `tauri::Emitter` trait; `app.emit_to("webview-label", ...)` for targeted emit; payload must implement `Serialize + Clone`
- `https://v2.tauri.app/plugin/dialog/` — `open({directory: true})` JS API; `blocking_pick_folder()` Rust API; `dialog:allow-open` permission; returns `string | null`
- `https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/permissions/autogenerated/reference.md` — `fs:allow-watch`, `fs:allow-read-text-file`, `fs:read-all` permission identifiers
- `https://docs.rs/serde-yaml-ng/latest/serde_yaml_ng/` — `from_str()`, `to_string()` API; Serde derive compatibility
- `https://docs.rs/notify-debouncer-mini/latest/notify_debouncer_mini/` — `new_debouncer(Duration, handler)` signature; `DebouncedEvent` structure (for reference if raw notify needed)
- crates.io API — Version checks: `serde_yaml 0.9.34+deprecated`, `serde-yaml-ng 0.10.0`, `tauri-plugin-fs 2.5.0`, `tauri-plugin-dialog 2.7.0`, `walkdir 2.5.0`, `uuid 1.23.1`, `sha2 0.11.0`

### Secondary (MEDIUM confidence)

- Phase 1 `01-RESEARCH.md` + `01-02-SUMMARY.md` — Confirmed DB path (`~/Library/Application Support/com.contract-ide.app/contract-ide.db`); WAL mode active; `_sqlx_migrations` tracking format; `generate_handler!` fully-qualified path requirement
- Phase 1 `01-VERIFICATION.md` — Confirmed live schema: `nodes`, `edges`, `node_flows`, `drift_state`, `receipts`, `receipt_nodes`; all 6 indexes present; FTS5 `nodes_fts` table ready

### Tertiary (LOW confidence)

- `DbInstances` as public API for Rust-side pool access — Not officially documented; inferred from plugin source; marked as potentially unstable across minor plugin versions

---

## Metadata

**Confidence breakdown:**
- Standard stack (serde-yaml-ng, walkdir, uuid, sha2): HIGH — version-pinned from crates.io; APIs are stable
- tauri-plugin-fs watch API: HIGH — verified from raw TypeScript source file in official plugins-workspace repo
- tauri-plugin-dialog folder picker: HIGH — verified from official v2 Tauri docs
- DbInstances Rust access pattern: MEDIUM — inferred from plugin source code; not publicly documented
- Ghost ref generation timing (deferred to Phase 3): MEDIUM — design decision, not a technical question
- SQLite `ALTER TABLE ADD COLUMN` behavior: HIGH — well-documented SQLite behavior; tested pattern

**Research date:** 2026-04-24
**Valid until:** 2026-05-22 (30 days — stable Tauri ecosystem; plugin versions match Phase 1 locked minor)
**Critical validation before Phase 2 ends:** Confirm `app.state::<DbInstances>()` compiles with the exact `tauri-plugin-sql` version in Cargo.lock (currently resolves to `2.4.0` from `tauri-plugin-sql = "2"` semver).

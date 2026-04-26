# #FF0000 Design-System Thread — Verification Checklist

**Purpose:** Verify the new "PM declares a design rule → distiller captures → Sync publishes → developer-side agent applies" thread runs end-to-end before filming. Each step has an explicit pass/fail with how to observe.

**Why this exists:** Three load-bearing seams sit between the PM's keystroke and the red Delete-Workspace button on stage. Each can fail silently. Walk this list at least once after every code change to the distiller / retrieval / Sync paths.

**Run from:** `/Users/yang/lahacks/contract-ide`. Assumes the app builds (`cd src-tauri && cargo check`) and the MCP sidecar built (`cd mcp-sidecar && npm run build`).

---

## 0 — Reset DB and seed fixtures

```bash
./demo/reset-demo.sh
```

**Pass:** script exits 0, prints "seeded N substrate rows".

**Then verify migration v10 + backfill:**

```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contract-ide.db \
  "SELECT COUNT(*) AS total, COUNT(published_at) AS published FROM substrate_nodes;"
```

**Pass:** `total` and `published` are equal (every seeded row backfilled to a published timestamp). If they differ, the seed's tail UPDATE didn't run — re-check `demo/seeds/substrate.sqlite.seed.sql`.

---

## 1 — Distiller captures the PM message as a Constraint

Synthetic episode that mimics the Beat 1 PM follow-up. Save as `/tmp/ff0000-episode.txt`:

```
[User]: Looking at the danger zone on Account Settings — customer Maya R. clicked Delete and got charged the next month. Need a Delete Account button there with email confirmation and 30-day grace.
[Assistant]: Understood — I'll wire up the danger-zone button with the soft-delete + email confirmation flow.
[User]: And per the design system — destructive primary actions use #FF0000, not a Tailwind red variant. Treat that as a team rule going forward.
[Assistant]: Got it. I'll apply #FF0000 to the new button and capture the rule.
```

Run the distiller against this synthetic episode. The easiest path is to insert the episode into the `episodes` table and let the watcher auto-fire:

```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contract-ide.db <<'SQL'
INSERT INTO sessions (session_id, cwd_key, started_at, last_seen_at, ingested_at)
  VALUES ('test-pm-ff0000', 'test', datetime('now'), datetime('now'), datetime('now'))
  ON CONFLICT DO NOTHING;
INSERT INTO episodes (episode_id, session_id, start_line, end_line, filtered_text, content_hash, created_at)
  VALUES ('ep-ff0000-test', 'test-pm-ff0000', 1, 4, readfile('/tmp/ff0000-episode.txt'), 'hash-ff0000', datetime('now'));
SQL
```

In a running app, the listener fires automatically. Watch the app log for `[distiller]` lines or check `distiller_dead_letters` for failures.

After the distiller runs:

```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contract-ide.db \
  "SELECT uuid, node_type, text, published_at FROM substrate_nodes WHERE source_session_id = 'test-pm-ff0000';"
```

**Pass:** at least one row whose `text` contains the substance "destructive" + "#FF0000". `published_at` is **NULL**. `node_type = 'constraint'`.

**Fail modes:**
- Zero rows → distiller rejected the message. Re-read `distiller/prompt.rs` carve-out clause; the message phrasing may still read as a session-specific aside. Strengthen the message to be unambiguously a team commitment ("Going forward, every destructive primary action across the product uses #FF0000.").
- Row exists with `published_at NOT NULL` → migration v10 didn't take effect on new writes; re-check `distiller/pipeline.rs` INSERT column list.
- Dead-letter row in `distiller_dead_letters` → `claude -p` failed; check the error_kind.

---

## 2 — Retrieval does NOT surface the unpublished rule

Before Sync, the rule should be invisible to retrieval. Test directly via SQL (mirroring the candidates.rs query):

```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contract-ide.db <<'SQL'
SELECT s.uuid, s.text
FROM substrate_nodes_fts fts
JOIN substrate_nodes s ON s.uuid = fts.uuid
WHERE substrate_nodes_fts MATCH '"destructive" OR "delete" OR "button"'
  AND s.invalid_at IS NULL
  AND s.published_at IS NOT NULL
LIMIT 10;
SQL
```

**Pass:** the `ff0000` row from step 1 does NOT appear.

**Fail mode:** if it does appear, the retrieval filter wasn't added to one of the SQL sites. `grep -rn "AND .*published_at IS NOT NULL" src-tauri/src mcp-sidecar/src` should show 7+ matches across `retrieval/candidates.rs` (3), `commands/substrate.rs` (4), and the three MCP tools. Anything missing is the broken site.

---

## 3 — Sync publishes the rule

In the app, click the **Pull incoming changes** button on the Sync Review surface. (Or call the IPC directly from the dev console: `await window.__TAURI__.core.invoke('publish_pending_substrate')`.)

**Pass:** the IPC returns `{ published_count: ≥1, published_uuids: [...] }`. The `console.info` in `SyncReviewPanel.tsx` logs the count.

```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contract-ide.db \
  "SELECT uuid, published_at FROM substrate_nodes WHERE source_session_id = 'test-pm-ff0000';"
```

**Pass:** `published_at` is now a non-NULL timestamp.

**Fail mode:** `published_count = 0` after click → the IPC didn't see any pending rows; re-run step 1. IPC errors → check the Tauri devtools console for the `[SyncReview]` warn line.

---

## 4 — Retrieval now surfaces the rule

Re-run the same SQL from step 2. **Pass:** the `ff0000` row IS in the result set now.

For a higher-fidelity check, run the delegate composer directly. From a node in the developer's surface (e.g. select Team Settings > Delete Workspace contract atom in the canvas, then click Delegate to agent and inspect the composed prompt in the receipt). The "Substrate Rules (top-5 retrieved...)" block should include the #FF0000 rule.

**Pass:** the rule appears in the top-5 with `applies_when` referencing destructive UI actions.

**Fail mode:** rule exists but isn't in top-5 → either the rerank deprioritized it, or the anchored_uuids JOIN excluded it. Loosen the anchored set (broader fallback already kicks in if scoped < 3 hits — see `candidates.rs` ScopeUsed::Broad). If still not surfacing, strengthen the rule's `applies_when` text via the Refine button in the substrate trust surface.

---

## 5 — Agent applies the exact hex (not a variant)

Run the actual workspace-delete prompt against the dev-side agent path. Either:

- **Through the IDE:** open Cmd+P, find Team Settings > Delete Workspace, click Delegate to agent.
- **Through bare claude with MCP:** `claude -p "add a delete-workspace button to the team settings page" --mcp-config <path-to-mcp-server>`

Inspect the agent's diff for the new button.

**Pass:** the className uses literally `#FF0000` (e.g. `className="bg-[#FF0000]"`, `style={{ background: '#FF0000' }}`, or a CSS variable initialized to `#FF0000`).

**Fail modes:**
- Agent picks `bg-red-600` / `bg-red-500` / `text-red-700` → composer prompt's "exact values are exact" clause didn't bind. Either the prompt change didn't ship to the running build, or the rule text needs to be more imperative ("Use the literal hex `#FF0000` — not a Tailwind utility."). Update the seeded rule text via Refine.
- Agent invents a CSS variable name without setting it → rule is ambiguous; strengthen.

---

## 6 — Reset path is clean

Re-run `./demo/reset-demo.sh`. Step 0 should pass again — fixtures backfill, the test rule from step 1 is gone (the DELETE clauses in the seed prefix wipe `dec-%`/`con-%`/`open-q-%` rows; the test rule was named with the `substrate-` prefix from the distiller, so it survives reset unless we explicitly DELETE it).

**Optional cleanup before next rehearsal:**
```bash
sqlite3 ~/Library/Application\ Support/com.contract-ide.app/contract-ide.db \
  "DELETE FROM substrate_nodes WHERE source_session_id = 'test-pm-ff0000'; DELETE FROM episodes WHERE session_id = 'test-pm-ff0000'; DELETE FROM sessions WHERE session_id = 'test-pm-ff0000';"
```

---

## When all six pass

The thread is verified. Lock the PM message wording in `scenario-criteria.md` § Beat 1 Committed Scenario so future script edits don't accidentally change the phrasing in a way that fails distillation.

## Demo-day pre-flight (10 minutes before filming)

Run steps 0 → 1 → 2 → 3 → 4 → 5 in sequence on the demo laptop. Total time ≤ 5 minutes. Any fail = abort and fix; do not film with a yellow light on this thread.

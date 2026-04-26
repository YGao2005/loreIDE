use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A single file range inside a node's `code_ranges`. Multiple ranges
/// support fragment coverage (e.g. an L4 atom spanning one line of a
/// larger file) and multi-file nodes (L2 component + its CSS).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodeRange {
    pub file: String,
    pub start_line: u32,
    pub end_line: u32,
}

/// One entry in a rollup_inputs list. Records which sections of a child node
/// were included in the rollup hash computation (PROP-02).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RollupInput {
    pub child_uuid: String,
    pub sections: Vec<String>,
}

/// Full Phase 2+ sidecar frontmatter (REQUIREMENTS.md DATA-01).
///
/// Field order is deliberately stable: `format_version` first (migration
/// hinge), `uuid` second (identity), then structural fields, then hashes,
/// then user state (`human_pinned`), then presentation (`route`), then
/// bookkeeping (`derived_at`), then Phase 8 propagation fields at the end.
///
/// The Phase 8 fields use `serde(default)` + `skip_serializing_if` so that:
/// - Reading a v2 sidecar still works (missing fields get serde defaults).
/// - Writing an L0 sidecar (no rollup) omits the four rollup_* fields.
/// - section_hashes omits itself when empty (v2 write path).
///
/// LAZY MIGRATION (Pitfall 7): the read path NEVER writes section_hashes back
/// to disk. section_hashes is computed in memory when needed. The format_version: 3
/// and section_hashes persistence ONLY happens on a real write through
/// write_contract, write_derived_contract, or update_contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
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

    /// Optional author-supplied display name. When present, takes precedence
    /// over every scanner-side derivation. Absent on legacy sidecars; the
    /// scanner falls back to route → first-sentence → file basename →
    /// "untitled-<8>" (never the bare UUID).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    // -------------------------------------------------------------------------
    // Phase 8 propagation fields (format_version: 3).
    // These five fields appear LAST so v2-written sidecars round-trip
    // byte-identically (existing fields keep their YAML position).
    // -------------------------------------------------------------------------

    /// Per-section SHA-256 hashes. Keys are lowercased H2 section names,
    /// alphabetically sorted (BTreeMap invariant). Set on every write once
    /// format_version: 3; absent on v2 sidecars (serde defaults to empty).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub section_hashes: BTreeMap<String, String>,

    /// Which child-node sections fed the rollup hash (L1/L2/L3 only).
    /// Empty for L0/L4 nodes and on first write before rollup runs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rollup_inputs: Vec<RollupInput>,

    /// The most recently computed rollup hash (L1/L2/L3 only).
    /// None for L0 nodes and before the first rollup run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollup_hash: Option<String>,

    /// Rollup freshness state: `"fresh"` | `"stale"` | `"untracked"`.
    /// None for L0 nodes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollup_state: Option<String>,

    /// Monotonic counter incremented on every rollup write. Used as the
    /// optimistic-locking primitive to detect concurrent rollup writes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollup_generation: Option<u64>,

    // -------------------------------------------------------------------------
    // Phase 9 FLOW-01 field (format_version: 5).
    // Present ONLY on kind == "flow" contracts.  Absent on all other kinds.
    // serde(default) + skip_serializing_if ensures v1-v4 sidecars round-trip
    // without modification (None serializes as absent key).
    // -------------------------------------------------------------------------

    /// Ordered list of member UUIDs for a flow contract.
    ///
    /// First element is the flow's trigger (its kind determines L3 render mode
    /// in Phase 13: UI iframe vs. structured backend card).  Subsequent elements
    /// are participants in invocation order.
    ///
    /// Required when `kind == "flow"`; absent (None) on all other kinds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<String>>,
}

/// Validate that a flow contract has a non-empty members list and that every
/// UUID in that list exists in the provided set of loaded contract UUIDs.
///
/// Returns a vec of human-readable error strings (empty = all OK).
/// Called by the scanner/repo-load path after all contracts are parsed so
/// that cross-contract UUID references can be checked.
pub fn validate_flow_members(
    contracts: &[(ContractFrontmatter, String)],
) -> Vec<String> {
    let all_uuids: std::collections::HashSet<&str> = contracts
        .iter()
        .map(|(fm, _)| fm.uuid.as_str())
        .collect();

    let mut errors = Vec::new();
    for (fm, _) in contracts {
        if fm.kind != "flow" {
            continue;
        }
        match &fm.members {
            None => {
                errors.push(format!(
                    "Flow contract {} has no members — every kind:flow contract \
                     requires at least one member (the trigger).",
                    fm.uuid
                ));
            }
            Some(v) if v.is_empty() => {
                errors.push(format!(
                    "Flow contract {} has no members — every kind:flow contract \
                     requires at least one member (the trigger).",
                    fm.uuid
                ));
            }
            Some(members) => {
                for member_uuid in members {
                    if !all_uuids.contains(member_uuid.as_str()) {
                        errors.push(format!(
                            "Flow contract {} references member {} which is not \
                             present in the loaded contracts.",
                            fm.uuid, member_uuid
                        ));
                    }
                }
            }
        }
    }
    errors
}

/// Split a sidecar into (frontmatter, body). Expects a leading `---\n` fence,
/// a YAML block, and a closing `\n---\n` fence. The body is everything
/// AFTER the closing fence, trimmed of leading whitespace.
///
/// Pitfall 6 in 02-RESEARCH.md: match on `\n---\n` (newline on BOTH sides)
/// so a `---` horizontal rule in the body is NOT misread as the closing fence.
pub fn parse_sidecar(content: &str) -> anyhow::Result<(ContractFrontmatter, String)> {
    let trimmed = content.trim_start_matches('\u{feff}');
    let rest = trimmed
        .strip_prefix("---\n")
        .or_else(|| trimmed.strip_prefix("---\r\n"))
        .ok_or_else(|| anyhow::anyhow!("sidecar missing opening --- fence"))?;

    // Find the closing \n---\n (or \n---\r\n) — newline on both sides.
    let end = rest
        .find("\n---\n")
        .or_else(|| rest.find("\n---\r\n"))
        .ok_or_else(|| anyhow::anyhow!("sidecar missing closing --- fence"))?;

    let yaml = &rest[..end];

    // After end we have "\n---\n..." — skip past the closing fence line.
    // end points to the \n before ---, so end+1 skips that \n,
    // then we find the next \n (end of ---) and skip past it too.
    let after_newline = &rest[end + 1..]; // starts with "---\n..." or "---\r\n..."
    let body = after_newline
        .find('\n')
        .map(|i| &after_newline[i + 1..])
        .unwrap_or("")
        .trim_start_matches(['\n', '\r'])
        .to_string();

    let fm: ContractFrontmatter = serde_yaml_ng::from_str(yaml)
        .map_err(|e| anyhow::anyhow!("YAML parse error: {e}"))?;
    Ok((fm, body))
}

/// Read and parse a sidecar by UUID against a repo root. Convenience wrapper
/// around `std::fs::read_to_string` + `parse_sidecar`. The path layout is
/// `<repo>/.contracts/<uuid>.md` per Phase 2 invariant (DATA-01).
///
/// Used by Plans 08-02 (rollup engine), 08-05 (cherrypick), and 08-06
/// (reconcile) which all need a one-call `(repo, uuid) → (frontmatter, body)` API.
pub fn read_sidecar_file(
    repo: &std::path::Path,
    uuid: &str,
) -> anyhow::Result<(ContractFrontmatter, String)> {
    let path = repo.join(".contracts").join(format!("{uuid}.md"));
    let content = std::fs::read_to_string(&path)
        .map_err(|e| anyhow::anyhow!("read sidecar {}: {e}", path.display()))?;
    parse_sidecar(&content)
}

/// Serialize a frontmatter + body pair into sidecar .md string form.
///
/// Writers MUST route through here (single-writer rule in 02-RESEARCH.md
/// anti-patterns): JS never writes a sidecar directly; the write_contract
/// Rust IPC in Plan 02-02 uses this.
pub fn write_sidecar(fm: &ContractFrontmatter, body: &str) -> anyhow::Result<String> {
    let yaml = serde_yaml_ng::to_string(fm)?;
    let body_clean = body.trim_start_matches('\n');
    Ok(format!("---\n{yaml}---\n\n{body_clean}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL_SIDECAR: &str = r#"---
format_version: 1
uuid: 550e8400-e29b-41d4-a716-446655440000
kind: UI
level: L2
parent: 11111111-1111-1111-1111-111111111111
neighbors:
  - 22222222-2222-2222-2222-222222222222
  - 33333333-3333-3333-3333-333333333333
code_ranges:
  - file: src/components/CheckoutButton.tsx
    start_line: 1
    end_line: 42
  - file: src/components/CheckoutButton.css
    start_line: 1
    end_line: 20
code_hash: abc123def456
contract_hash: def456abc123
human_pinned: false
route: /cart
derived_at: 2026-04-24T12:00:00Z
---

The checkout button component. Handles payment submission and shows a loading spinner during async flow.

---

Second paragraph after a markdown horizontal rule — this MUST survive parsing.
"#;

    #[test]
    fn round_trip_preserves_every_field() {
        let (fm, body) = parse_sidecar(FULL_SIDECAR).expect("parse");
        assert_eq!(fm.format_version, 1);
        assert_eq!(fm.uuid, "550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(fm.kind, "UI");
        assert_eq!(fm.level, "L2");
        assert_eq!(
            fm.parent.as_deref(),
            Some("11111111-1111-1111-1111-111111111111")
        );
        assert_eq!(fm.neighbors.len(), 2);
        assert_eq!(fm.code_ranges.len(), 2);
        assert_eq!(
            fm.code_ranges[0].file,
            "src/components/CheckoutButton.tsx"
        );
        assert_eq!(fm.code_ranges[0].start_line, 1);
        assert_eq!(fm.code_ranges[0].end_line, 42);
        assert_eq!(fm.code_hash.as_deref(), Some("abc123def456"));
        assert_eq!(fm.contract_hash.as_deref(), Some("def456abc123"));
        assert!(!fm.human_pinned);
        assert_eq!(fm.route.as_deref(), Some("/cart"));
        assert_eq!(fm.derived_at.as_deref(), Some("2026-04-24T12:00:00Z"));

        // Phase 8 fields must default to empty/None when reading a v2 sidecar.
        assert!(fm.section_hashes.is_empty(), "section_hashes must default empty for v2");
        assert!(fm.rollup_inputs.is_empty(), "rollup_inputs must default empty for v2");
        assert!(fm.rollup_hash.is_none(), "rollup_hash must default None for v2");
        assert!(fm.rollup_state.is_none(), "rollup_state must default None for v2");
        assert!(fm.rollup_generation.is_none(), "rollup_generation must default None for v2");

        // Body must include the horizontal rule AND the paragraph after it (Pitfall 6).
        assert!(body.contains("checkout button"));
        assert!(body.contains("Second paragraph after a markdown horizontal rule"));

        let serialized = write_sidecar(&fm, &body).expect("serialize");
        let (fm2, body2) = parse_sidecar(&serialized).expect("re-parse");
        assert_eq!(fm.uuid, fm2.uuid);
        assert_eq!(fm.code_ranges, fm2.code_ranges);
        assert_eq!(fm.neighbors, fm2.neighbors);
        assert_eq!(body.trim(), body2.trim());
    }

    #[test]
    fn missing_opening_fence_is_an_error() {
        let bad = "no fence here\nuuid: foo";
        assert!(parse_sidecar(bad).is_err());
    }

    #[test]
    fn defaults_apply_for_optional_fields() {
        let minimal = "---\nformat_version: 1\nuuid: abc\nkind: UI\nlevel: L0\n---\n\nbody\n";
        let (fm, body) = parse_sidecar(minimal).expect("parse");
        assert_eq!(fm.neighbors.len(), 0);
        assert_eq!(fm.code_ranges.len(), 0);
        assert!(!fm.human_pinned);
        assert_eq!(body.trim(), "body");
    }

    #[test]
    fn reads_existing_sidecar_round_trip() {
        // Write a fixture sidecar via write_sidecar, then load it back via
        // read_sidecar_file and assert frontmatter + body match.
        let dir = tempfile::tempdir().expect("create temp dir");
        let contracts_dir = dir.path().join(".contracts");
        std::fs::create_dir_all(&contracts_dir).expect("create .contracts dir");

        let uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        let fm = ContractFrontmatter {
            format_version: 2,
            uuid: uuid.to_string(),
            kind: "API".to_string(),
            level: "L3".to_string(),
            parent: None,
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: Some("/api/test".to_string()),
            derived_at: Some("2026-04-24T00:00:00Z".to_string()),
            name: None,
            section_hashes: BTreeMap::new(),
            rollup_inputs: vec![],
            rollup_hash: None,
            rollup_state: None,
            rollup_generation: None,
            members: None,
        };
        let body = "## Intent\n\nTest contract for read_sidecar_file.\n";
        let sidecar_content = write_sidecar(&fm, body).expect("write_sidecar");

        // Write to .contracts/<uuid>.md
        std::fs::write(contracts_dir.join(format!("{uuid}.md")), &sidecar_content)
            .expect("write sidecar file");

        // Read back via read_sidecar_file
        let (fm2, body2) = read_sidecar_file(dir.path(), uuid).expect("read_sidecar_file");

        assert_eq!(fm.uuid, fm2.uuid);
        assert_eq!(fm.kind, fm2.kind);
        assert_eq!(fm.level, fm2.level);
        assert_eq!(fm.route, fm2.route);
        assert_eq!(fm.derived_at, fm2.derived_at);
        assert_eq!(body.trim(), body2.trim());
    }

    // -------------------------------------------------------------------------
    // Phase 8 v3 round-trip tests
    // -------------------------------------------------------------------------

    /// Helpers to build a v3 L3 frontmatter with all 5 Phase 8 fields populated.
    fn make_v3_l3_frontmatter() -> ContractFrontmatter {
        let mut section_hashes = BTreeMap::new();
        section_hashes.insert("examples".to_string(), "aabbcc".to_string());
        section_hashes.insert("intent".to_string(), "ddeeff".to_string());
        section_hashes.insert("role".to_string(), "112233".to_string());

        ContractFrontmatter {
            format_version: 3,
            uuid: "11111111-1111-1111-1111-111111111111".to_string(),
            kind: "API".to_string(),
            level: "L3".to_string(),
            parent: Some("00000000-0000-0000-0000-000000000001".to_string()),
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: None,
            derived_at: Some("2026-04-24T00:00:00Z".to_string()),
            name: None,
            section_hashes,
            rollup_inputs: vec![
                RollupInput {
                    child_uuid: "aaaa0001-0000-0000-0000-000000000001".to_string(),
                    sections: vec!["intent".to_string(), "examples".to_string()],
                },
            ],
            rollup_hash: Some("deadbeef01".to_string()),
            rollup_state: Some("fresh".to_string()),
            rollup_generation: Some(1),
            members: None,
        }
    }

    #[test]
    fn frontmatter_v3_round_trip_l3() {
        let fm = make_v3_l3_frontmatter();
        let body = "## Intent\n\nThis is an L3 contract.\n";
        let serialized = write_sidecar(&fm, body).expect("serialize");
        let (fm2, body2) = parse_sidecar(&serialized).expect("re-parse");

        assert_eq!(fm.format_version, fm2.format_version);
        assert_eq!(fm.uuid, fm2.uuid);
        assert_eq!(fm.section_hashes, fm2.section_hashes);
        assert_eq!(fm.rollup_inputs, fm2.rollup_inputs);
        assert_eq!(fm.rollup_hash, fm2.rollup_hash);
        assert_eq!(fm.rollup_state, fm2.rollup_state);
        assert_eq!(fm.rollup_generation, fm2.rollup_generation);
        assert_eq!(body.trim(), body2.trim());
    }

    #[test]
    fn frontmatter_v2_reads_without_persisting() {
        // Load a sidecar file with format_version: 2 and no Phase 8 fields.
        // Assert section_hashes is empty BTreeMap (lazy migration — read does NOT write back).
        let dir = tempfile::tempdir().expect("create temp dir");
        let contracts_dir = dir.path().join(".contracts");
        std::fs::create_dir_all(&contracts_dir).expect("create .contracts dir");

        let uuid = "v2testxx-0000-0000-0000-000000000001";
        let v2_content = format!(
            "---\nformat_version: 2\nuuid: {uuid}\nkind: UI\nlevel: L2\n---\n\n## Intent\n\nV2 contract.\n"
        );

        let path = contracts_dir.join(format!("{uuid}.md"));
        std::fs::write(&path, &v2_content).expect("write v2 sidecar");

        // Record mtime before reading.
        let mtime_before = std::fs::metadata(&path)
            .expect("stat")
            .modified()
            .expect("mtime");

        // Parse via read_sidecar_file.
        let (fm, _body) = read_sidecar_file(dir.path(), uuid).expect("read_sidecar_file");

        // Record mtime after reading.
        let mtime_after = std::fs::metadata(&path)
            .expect("stat after")
            .modified()
            .expect("mtime after");

        // Lazy migration: section_hashes is empty, NOT computed and written back.
        assert!(
            fm.section_hashes.is_empty(),
            "v2 read must not populate section_hashes in-memory lazily here (caller responsibility)"
        );

        // The file on disk must NOT have been modified.
        assert_eq!(
            mtime_before, mtime_after,
            "reading a v2 sidecar must NOT write back to disk (lazy migration)"
        );

        // Re-read raw file and confirm content is byte-identical.
        let content_after = std::fs::read_to_string(&path).expect("re-read");
        assert_eq!(v2_content, content_after, "v2 sidecar file must be byte-identical after read");
    }

    #[test]
    fn frontmatter_l0_omits_rollup_fields() {
        // Build an L0 frontmatter. Rollup fields are None/empty.
        let fm = ContractFrontmatter {
            format_version: 3,
            uuid: "l0000001-0000-0000-0000-000000000001".to_string(),
            kind: "UI".to_string(),
            level: "L0".to_string(),
            parent: None,
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: Some("/".to_string()),
            derived_at: None,
            name: None,
            section_hashes: BTreeMap::new(),
            rollup_inputs: vec![],  // empty → skip_serializing_if
            rollup_hash: None,      // None → skip_serializing_if
            rollup_state: None,     // None → skip_serializing_if
            rollup_generation: None, // None → skip_serializing_if
            members: None,          // None → skip_serializing_if
        };

        let serialized = write_sidecar(&fm, "body").expect("serialize");

        // The YAML frontmatter must NOT contain any rollup_* or section_hashes keys.
        assert!(
            !serialized.contains("rollup_inputs"),
            "L0 sidecar must not contain rollup_inputs"
        );
        assert!(
            !serialized.contains("rollup_hash"),
            "L0 sidecar must not contain rollup_hash"
        );
        assert!(
            !serialized.contains("rollup_state"),
            "L0 sidecar must not contain rollup_state"
        );
        assert!(
            !serialized.contains("rollup_generation"),
            "L0 sidecar must not contain rollup_generation"
        );
        assert!(
            !serialized.contains("section_hashes"),
            "L0 sidecar with empty section_hashes must not serialize section_hashes"
        );
    }

    // -------------------------------------------------------------------------
    // Phase 9 FLOW-01 tests
    // -------------------------------------------------------------------------

    #[test]
    fn flow_contract_round_trip_with_members() {
        // A kind:flow contract with a members list round-trips cleanly.
        let member1 = "aaaa0001-0000-4000-8000-000000000000";
        let member2 = "aaaa0002-0000-4000-8000-000000000000";
        let member3 = "aaaa0003-0000-4000-8000-000000000000";

        let fm = ContractFrontmatter {
            format_version: 5,
            uuid: "flow-test-0000-4000-8000-000000000000".to_string(),
            kind: "flow".to_string(),
            level: "L2".to_string(),
            parent: Some("f2000000-0000-4000-8000-000000000000".to_string()),
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: None,
            derived_at: None,
            name: None,
            section_hashes: BTreeMap::new(),
            rollup_inputs: vec![],
            rollup_hash: None,
            rollup_state: None,
            rollup_generation: None,
            members: Some(vec![
                member1.to_string(),
                member2.to_string(),
                member3.to_string(),
            ]),
        };
        let body = "## Intent\n\nTest flow.\n";
        let serialized = write_sidecar(&fm, body).expect("serialize");

        // The YAML must contain members key.
        assert!(serialized.contains("members:"), "serialized must have members key");
        assert!(serialized.contains(member1), "must contain trigger uuid");

        let (fm2, body2) = parse_sidecar(&serialized).expect("re-parse");
        assert_eq!(fm.uuid, fm2.uuid);
        assert_eq!(fm.kind, fm2.kind);
        let members2 = fm2.members.expect("members must be Some after round-trip");
        assert_eq!(members2.len(), 3);
        assert_eq!(members2[0], member1);
        assert_eq!(members2[1], member2);
        assert_eq!(members2[2], member3);
        assert_eq!(body.trim(), body2.trim());
    }

    #[test]
    fn non_flow_contract_members_absent() {
        // A non-flow contract must NOT have members key in serialized form.
        let fm = ContractFrontmatter {
            format_version: 3,
            uuid: "api-test-0000-4000-8000-000000000000".to_string(),
            kind: "API".to_string(),
            level: "L3".to_string(),
            parent: None,
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: None,
            derived_at: None,
            name: None,
            section_hashes: BTreeMap::new(),
            rollup_inputs: vec![],
            rollup_hash: None,
            rollup_state: None,
            rollup_generation: None,
            members: None,
        };
        let serialized = write_sidecar(&fm, "body").expect("serialize");
        assert!(
            !serialized.contains("members"),
            "non-flow contract must not serialize members key"
        );

        let (fm2, _) = parse_sidecar(&serialized).expect("re-parse");
        assert!(fm2.members.is_none(), "non-flow members must be None");
    }

    #[test]
    fn validate_flow_members_catches_missing_members() {
        let flow_fm = ContractFrontmatter {
            format_version: 5,
            uuid: "flow-no-members-0000-4000-8000-000000000000".to_string(),
            kind: "flow".to_string(),
            level: "L2".to_string(),
            parent: None,
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: None,
            derived_at: None,
            name: None,
            section_hashes: BTreeMap::new(),
            rollup_inputs: vec![],
            rollup_hash: None,
            rollup_state: None,
            rollup_generation: None,
            members: None, // Missing members — should fail validation
        };
        let contracts = vec![(flow_fm, "body".to_string())];
        let errors = validate_flow_members(&contracts);
        assert!(!errors.is_empty(), "missing members must produce validation error");
        assert!(errors[0].contains("no members"), "error must mention 'no members'");
    }

    #[test]
    fn validate_flow_members_catches_dangling_uuid() {
        let trigger_uuid = "trigger-0000-4000-8000-000000000001";
        let dangling_uuid = "dangling-0000-4000-8000-000000000099";

        let trigger_fm = ContractFrontmatter {
            format_version: 3,
            uuid: trigger_uuid.to_string(),
            kind: "UI".to_string(),
            level: "L3".to_string(),
            parent: None,
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: None,
            derived_at: None,
            name: None,
            section_hashes: BTreeMap::new(),
            rollup_inputs: vec![],
            rollup_hash: None,
            rollup_state: None,
            rollup_generation: None,
            members: None,
        };
        let flow_fm = ContractFrontmatter {
            format_version: 5,
            uuid: "flow-dangling-4000-8000-000000000000".to_string(),
            kind: "flow".to_string(),
            level: "L2".to_string(),
            parent: None,
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: None,
            derived_at: None,
            name: None,
            section_hashes: BTreeMap::new(),
            rollup_inputs: vec![],
            rollup_hash: None,
            rollup_state: None,
            rollup_generation: None,
            members: Some(vec![trigger_uuid.to_string(), dangling_uuid.to_string()]),
        };
        let contracts = vec![
            (trigger_fm, "body".to_string()),
            (flow_fm, "body".to_string()),
        ];
        let errors = validate_flow_members(&contracts);
        assert!(!errors.is_empty(), "dangling uuid must produce validation error");
        assert!(errors[0].contains(dangling_uuid), "error must name the dangling uuid");
    }

    #[test]
    fn validate_flow_members_passes_valid_flow() {
        let trigger_uuid = "trigger-valid-4000-8000-000000000001";
        let participant_uuid = "participant-4000-8000-000000000002";

        let trigger_fm = ContractFrontmatter {
            format_version: 3,
            uuid: trigger_uuid.to_string(),
            kind: "UI".to_string(),
            level: "L3".to_string(),
            parent: None,
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: None,
            derived_at: None,
            name: None,
            section_hashes: BTreeMap::new(),
            rollup_inputs: vec![],
            rollup_hash: None,
            rollup_state: None,
            rollup_generation: None,
            members: None,
        };
        let participant_fm = ContractFrontmatter {
            format_version: 3,
            uuid: participant_uuid.to_string(),
            kind: "API".to_string(),
            level: "L3".to_string(),
            parent: None,
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: None,
            derived_at: None,
            name: None,
            section_hashes: BTreeMap::new(),
            rollup_inputs: vec![],
            rollup_hash: None,
            rollup_state: None,
            rollup_generation: None,
            members: None,
        };
        let flow_fm = ContractFrontmatter {
            format_version: 5,
            uuid: "flow-valid-4000-8000-000000000000".to_string(),
            kind: "flow".to_string(),
            level: "L2".to_string(),
            parent: None,
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: None,
            derived_at: None,
            name: None,
            section_hashes: BTreeMap::new(),
            rollup_inputs: vec![],
            rollup_hash: None,
            rollup_state: None,
            rollup_generation: None,
            members: Some(vec![trigger_uuid.to_string(), participant_uuid.to_string()]),
        };
        let contracts = vec![
            (trigger_fm, "body".to_string()),
            (participant_fm, "body".to_string()),
            (flow_fm, "body".to_string()),
        ];
        let errors = validate_flow_members(&contracts);
        assert!(errors.is_empty(), "valid flow must produce no errors, got: {:?}", errors);
    }

    #[test]
    fn frontmatter_v3_serializes_section_hashes_alphabetically() {
        // BTreeMap serializes in key order. Create a frontmatter with
        // section_hashes for keys ["zebra", "alpha", "mango"] (in that order
        // via insert) and assert the serialized YAML lists keys alphabetically.
        let mut section_hashes = BTreeMap::new();
        // BTreeMap always stores in sorted order, but let's insert out-of-alpha
        // order to confirm the structure guarantees it.
        section_hashes.insert("zebra".to_string(), "zz".to_string());
        section_hashes.insert("alpha".to_string(), "aa".to_string());
        section_hashes.insert("mango".to_string(), "mm".to_string());

        let fm = ContractFrontmatter {
            format_version: 3,
            uuid: "alpha001-0000-0000-0000-000000000001".to_string(),
            kind: "API".to_string(),
            level: "L3".to_string(),
            parent: None,
            neighbors: vec![],
            code_ranges: vec![],
            code_hash: None,
            contract_hash: None,
            human_pinned: false,
            route: None,
            derived_at: None,
            name: None,
            section_hashes,
            rollup_inputs: vec![],
            rollup_hash: None,
            rollup_state: None,
            rollup_generation: None,
            members: None,
        };

        let serialized = write_sidecar(&fm, "body").expect("serialize");

        // Extract the section_hashes block from the YAML and verify key order.
        let alpha_pos = serialized.find("alpha:").expect("alpha key in YAML");
        let mango_pos = serialized.find("mango:").expect("mango key in YAML");
        let zebra_pos = serialized.find("zebra:").expect("zebra key in YAML");

        assert!(
            alpha_pos < mango_pos,
            "alpha must come before mango in serialized YAML"
        );
        assert!(
            mango_pos < zebra_pos,
            "mango must come before zebra in serialized YAML"
        );
    }
}

// Atomic-write tests for apply_cherrypick_inner (CHRY-03).
//
// These tests exercise the temp+rename order directly on the filesystem
// without a running Tauri app. They prove:
//
//   1. Happy path: successful write updates sidecar AND source files correctly.
//   2. Mid-rename failure: at least one source IS updated; sidecar is NOT
//      updated (still has old contract_hash); function returns Err.
//      Phase 7 SourceWatcher will fire drift on the next FSEvents tick.
//   3. Path-escape guard: a FilePatch.file of `../../etc/passwd` is rejected.

use contract_ide_lib::commands::cherrypick::{apply_cherrypick_inner, FilePatch};
use sha2::{Digest, Sha256};
use std::fs;

fn sha256_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    hex::encode(h.finalize())
}

/// Helper: write a minimal valid sidecar to `repo/.contracts/<uuid>.md` so
/// `apply_cherrypick_inner` finds an existing sidecar to merge-read.
fn write_seed_sidecar(repo: &std::path::Path, uuid: &str, body: &str, contract_hash: &str) {
    let dir = repo.join(".contracts");
    fs::create_dir_all(&dir).unwrap();
    let content = format!(
        "---\nformat_version: 2\nuuid: {uuid}\nkind: API\nlevel: L4\ncontract_hash: {contract_hash}\n---\n\n{body}"
    );
    fs::write(dir.join(format!("{uuid}.md")), content).unwrap();
}

// ---- Test 1: successful path writes both sidecar and source correctly ----
#[test]
fn successful_cherrypick_writes_sidecar_and_source() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path();

    let uuid = "11111111-aaaa-bbbb-cccc-dddddddddddd";
    let old_hash = sha256_hex("old contract body");
    write_seed_sidecar(repo, uuid, "old contract body", &old_hash);

    // Create a source file at a known path.
    let src_dir = repo.join("src");
    fs::create_dir_all(&src_dir).unwrap();
    fs::write(src_dir.join("main.rs"), "fn old() {}").unwrap();

    let new_contract = "## Intent\n\nNew intent here.";
    let new_code = "fn new() {}";

    let patches = vec![FilePatch {
        file: "src/main.rs".to_string(),
        new_content: new_code.to_string(),
    }];

    let result = apply_cherrypick_inner(repo, uuid, new_contract, &patches, None);
    assert!(result.is_ok(), "expected Ok, got: {:?}", result);

    // Source file must have new content.
    let source_after = fs::read_to_string(src_dir.join("main.rs")).unwrap();
    assert_eq!(source_after, new_code, "source file must have new content");

    // Sidecar must have updated contract_hash.
    let sidecar_raw = fs::read_to_string(repo.join(".contracts").join(format!("{uuid}.md"))).unwrap();
    let expected_hash = sha256_hex(new_contract);
    assert!(
        sidecar_raw.contains(&expected_hash),
        "sidecar must contain new contract_hash {expected_hash}; got:\n{sidecar_raw}"
    );

    // Sidecar must NOT contain the old hash.
    assert!(
        !sidecar_raw.contains(&old_hash),
        "sidecar must NOT contain old contract_hash; got:\n{sidecar_raw}"
    );

    // No temp files left behind.
    assert!(
        !repo.join(".contracts").join(format!("{uuid}.md.cherrypick.tmp")).exists(),
        "sidecar temp file must be cleaned up"
    );
}

// ---- Test 2: mid-rename failure leaves drift observable (Pitfall 6 closed) ----
//
// Setup: two source files. We instruct apply_cherrypick_inner to fail AFTER
// the first source rename (fail_after_n_source_renames = Some(1)).
//
// Expected post-failure state:
//   - source_a: updated (first rename succeeded)
//   - source_b: NOT updated (second rename never ran)
//   - sidecar:  NOT updated (still points at old_hash → watcher fires drift)
//   - return value: Err
#[test]
fn mid_rename_failure_leaves_drift_observable() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path();

    let uuid = "22222222-aaaa-bbbb-cccc-dddddddddddd";
    let old_hash = sha256_hex("old body");
    write_seed_sidecar(repo, uuid, "old body", &old_hash);

    let src_dir = repo.join("src");
    fs::create_dir_all(&src_dir).unwrap();
    fs::write(src_dir.join("a.rs"), "fn a_old() {}").unwrap();
    fs::write(src_dir.join("b.rs"), "fn b_old() {}").unwrap();

    let new_contract = "## Intent\n\nUpdated contract.";
    let patches = vec![
        FilePatch {
            file: "src/a.rs".to_string(),
            new_content: "fn a_new() {}".to_string(),
        },
        FilePatch {
            file: "src/b.rs".to_string(),
            new_content: "fn b_new() {}".to_string(),
        },
    ];

    // fail_after_n_source_renames = Some(1) → succeeds first rename, then fails.
    let result = apply_cherrypick_inner(repo, uuid, new_contract, &patches, Some(1));
    assert!(result.is_err(), "expected Err, got Ok");
    let err_msg = result.unwrap_err();
    assert!(
        err_msg.contains("partial-cherrypick"),
        "error must mention partial-cherrypick; got: {err_msg}"
    );

    // First source must be updated (rename completed before the simulated failure).
    let a_after = fs::read_to_string(src_dir.join("a.rs")).unwrap();
    assert_eq!(
        a_after, "fn a_new() {}",
        "source_a must be updated (first rename succeeded)"
    );

    // Second source must NOT be updated.
    let b_after = fs::read_to_string(src_dir.join("b.rs")).unwrap();
    assert_eq!(
        b_after, "fn b_old() {}",
        "source_b must NOT be updated (second rename never ran)"
    );

    // Sidecar must still have the OLD hash → watcher fires drift.
    let sidecar_raw =
        fs::read_to_string(repo.join(".contracts").join(format!("{uuid}.md"))).unwrap();
    assert!(
        sidecar_raw.contains(&old_hash),
        "sidecar must retain old contract_hash so drift is observable; got:\n{sidecar_raw}"
    );
    let new_hash = sha256_hex(new_contract);
    assert!(
        !sidecar_raw.contains(&new_hash),
        "sidecar must NOT have new contract_hash; got:\n{sidecar_raw}"
    );
}

// ---- Test 3: path-escape guard rejects ../ traversal ----
#[test]
fn path_escape_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path();
    let uuid = "33333333-aaaa-bbbb-cccc-dddddddddddd";

    let patches = vec![FilePatch {
        file: "../../etc/passwd".to_string(),
        new_content: "should not be written".to_string(),
    }];

    let result = apply_cherrypick_inner(repo, uuid, "body", &patches, None);
    assert!(result.is_err(), "expected Err for path-escape");
    let msg = result.unwrap_err();
    assert!(
        msg.contains("path escapes repo"),
        "error must mention 'path escapes repo'; got: {msg}"
    );
}

// ---- Test 4: pinned contract rejects cherrypick ----
#[test]
fn pinned_contract_rejects_cherrypick() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path();
    let uuid = "44444444-pppp-pppp-pppp-pppppppppppp";

    // Write a pinned sidecar (human_pinned: true).
    let contracts_dir = repo.join(".contracts");
    fs::create_dir_all(&contracts_dir).unwrap();
    let pinned_content = format!(
        "---\nformat_version: 2\nuuid: {uuid}\nkind: API\nlevel: L4\nhuman_pinned: true\ncontract_hash: deadbeef\n---\n\nold pinned body\n"
    );
    fs::write(contracts_dir.join(format!("{uuid}.md")), &pinned_content).unwrap();

    // Source file the patch would touch.
    let src_dir = repo.join("src");
    fs::create_dir_all(&src_dir).unwrap();
    fs::write(src_dir.join("main.rs"), "fn old() {}").unwrap();

    let patches = vec![FilePatch {
        file: "src/main.rs".to_string(),
        new_content: "fn new() {}".to_string(),
    }];
    let result = apply_cherrypick_inner(repo, uuid, "## Intent\n\nNew", &patches, None);

    assert!(result.is_err(), "pinned contract should reject cherrypick");
    let msg = result.unwrap_err();
    assert!(
        msg.contains("SKIPPED-PINNED"),
        "error must surface SKIPPED-PINNED; got: {msg}"
    );

    // Verify NOTHING changed: source untouched, sidecar untouched.
    let src_after = fs::read_to_string(src_dir.join("main.rs")).unwrap();
    assert_eq!(src_after, "fn old() {}", "source must not be written");
    let sidecar_after = fs::read_to_string(contracts_dir.join(format!("{uuid}.md"))).unwrap();
    assert_eq!(sidecar_after, pinned_content, "sidecar must not be touched");
    // No leftover temp files.
    let leftover_temps: Vec<_> = fs::read_dir(&src_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains(".cherrypick.tmp"))
        .collect();
    assert!(leftover_temps.is_empty(), "no temp files should leak");
}

// ---- Test 5: cross-filesystem rename ---- (best-effort; skipped if not simulatable)
#[test]
#[ignore = "cross-filesystem rename simulation requires two separate mounts; skip on standard CI"]
fn cross_filesystem_returns_error() {
    // This test is intentionally ignored — simulating a cross-filesystem rename
    // requires two separate mount points which are not available in standard CI
    // or a single-volume macOS dev machine. The EXDEV detection path in the Tauri
    // command layer (returns Err("cross-filesystem rename")) is documented in
    // SUMMARY.md but not exercise-able in unit tests without OS-level cooperation.
    //
    // If you have two mounts available, modify this test to place the repo on one
    // mount and the .contracts/ dir on another. std::fs::rename should return
    // Err with kind() == std::io::ErrorKind::Other and description "cross-device link".
    unimplemented!("requires two mount points");
}

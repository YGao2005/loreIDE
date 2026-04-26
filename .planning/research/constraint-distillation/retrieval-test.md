# Retrieval Test

## Method

For each synthetic goal, walk each extracted constraint's `applies_when` and judge semantic overlap. Simulate what embedding match + LLM-rerank would produce.

**Scoring:** strong-match (would fire), weak-match (borderline), no-match (skip).

---

## Goal A

> "Add a new PreviewTab component that renders a Monaco editor panel showing a diff between two file versions"

| Constraint | applies_when | Match | Fire? |
|---|---|---|---|
| C1 tailwind-import-order | CSS file edits | no | — |
| C2 rust-path-canonicalize | Rust Tauri command w/ path arg | no | — |
| **C3 monaco-useeffect-not-onmount** | **integrating or modifying a Monaco editor component** | **strong** | ✅ |
| C4 contract-save-merge-preserve | persisting contract sidecar | no | — |
| **C5 avoid-shadcn-tabs** | **tab-style UI (…inspector tabs)** | **weak-strong** (PreviewTab sounds like one of several tabs) | ✅ |
| C6 react-ref-click-callback | React event handler with mutable array | no (diff view is read-only) | — |
| C7 editor-spawn-table | opening file in $EDITOR | no | — |

**Expected:** C3 definitely, C5 possibly. **Actual:** both fire, C5 on a weak but sensible match ("Tab" in component name). **Verdict:** correct.

---

## Goal B

> "Write a Rust Tauri command `read_file_metadata(repo_path, rel_path)` that returns the file's size and mtime"

| Constraint | applies_when | Match | Fire? |
|---|---|---|---|
| C1 | CSS | no | — |
| **C2 rust-path-canonicalize** | **Rust Tauri command w/ path from JS** | **exact** | ✅ |
| C3 | Monaco | no | — |
| C4 | contract persistence | no | — |
| C5 | tab UI | no | — |
| C6 | React handler | no | — |
| C7 | $EDITOR spawning | no | — |

**Expected:** C2 only. **Actual:** C2 fires exactly. **Verdict:** correct, high precision.

---

## Goal C

> "Add CSS styling for the drift badge on the contract graph"

| Constraint | applies_when | Match | Fire? |
|---|---|---|---|
| **C1 tailwind-import-order** | **adding or editing any CSS file in this project** | **strong if new CSS file; weak if only utility classes** | ✅ |
| others | — | no | — |

**Wrinkle:** "Add CSS styling" is ambiguous — could mean editing a `.css` file (C1 fires correctly) or adding Tailwind utility classes inline (C1 shouldn't fire). The current `applies_when` can't distinguish.

**Fix:** Either tighten `applies_when` to `"when creating a new .css file or editing @import order in one"`, or accept the false positive as cheap. Also worth adding a sibling constraint *(C1b)* like `"prefer inline Tailwind utility classes over new CSS files"` so the retrieval surfaces both possibilities.

**Verdict:** retrieval fires, but reveals a real ambiguity in the constraint text itself — good signal about what the distiller needs to sharpen.

---

## Goal D (false-positive control)

> "Update the README.md to explain the phase 8 architecture"

| Constraint | applies_when | Match | Fire? |
|---|---|---|---|
| all 7 | code-related triggers | no | — |

**Expected:** nothing fires. **Actual:** nothing fires. **Verdict:** correct.

---

## Summary

| Goal | Expected hits | Actual hits | Precision | Recall |
|---|---|---|---|---|
| A (Monaco diff) | C3, (C5) | C3, C5 | ✅ | ✅ |
| B (Rust path) | C2 | C2 | ✅ | ✅ |
| C (CSS) | C1 (ambiguous) | C1 | ✅ | ✅ (with caveat) |
| D (README) | — | — | ✅ | ✅ |

**Hit rate: 4/4 goals. False positive rate: 0. Revealed 1 sharpening opportunity** (C1's applies_when is too broad for "CSS work" in general — needs to distinguish new .css files vs. utility classes).

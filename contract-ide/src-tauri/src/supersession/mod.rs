//! Phase 12: Conflict / Supersession Engine.
//!
//! Two engines, one schema:
//! - `fact_engine` (12-02): Graphiti-style invalidation on substrate-node ingestion.
//! - `intent_engine` (12-03): L0-priority-shift cascade over rollup descendants.
//!
//! Both reuse Phase 7's `DriftLocks` per-UUID Tokio mutex (lock order:
//! lexicographic UUID first when multiple locks needed).
//!
//! See `.planning/phases/12-conflict-supersession-engine/12-RESEARCH.md`.

pub mod candidate_selection;
pub mod fact_engine;
pub mod prompt;
pub mod queries;
pub mod types;
pub mod verdict;

// 12-03 lands intent_engine.
// 12-04 lands tests/, demo_force_intent_drift IPC, demo-fixture cfg.

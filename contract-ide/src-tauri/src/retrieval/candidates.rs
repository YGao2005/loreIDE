use crate::distiller::types::SubstrateNode;
use crate::retrieval::{ScopeUsed, SubstrateHit};
use sqlx::SqlitePool;
use std::collections::HashMap;

/// Top-N candidate selection via FTS5 + cousin-exclusion JOIN on anchored_uuids +
/// optional embedding cosine + RRF (k=60). Returns up to `limit` hydrated SubstrateHit rows.
///
/// Cousin-exclusion is enforced at SQL time: the FTS5 hits are JOINed with
/// `json_each(substrate_nodes.anchored_uuids) WHERE je.value IN (lineage_uuids)`. Only
/// substrate nodes whose anchored_uuids array intersects the lineage set survive.
///
/// Zero-hit fallback: if the anchored JOIN returns <3 candidates, fall back to broad
/// search (drop the anchored JOIN; FTS5 across ALL current-truth substrate) and set
/// ScopeUsed::Broad so the Plan 11-04 overlay can render the badge.
///
/// PUBLIC fn so Phase 9 mass-edit can reuse the candidate-selection step (Open Question 4).
pub async fn candidate_selection(
    pool: &SqlitePool,
    scope_uuids: &[String],
    query: &str,
    query_embedding: Option<&[f32]>,
    limit: usize,
) -> Result<Vec<SubstrateHit>, String> {
    // FTS5 candidates with anchored_uuids JOIN — cousins excluded at SQL time.
    // SQLite IN-clause needs explicit placeholders; build them dynamically.
    let mut scoped_rows: Vec<SubstrateNode> = if scope_uuids.is_empty() {
        // No scope provided — skip the anchored JOIN entirely (treat as broad).
        Vec::new()
    } else {
        let placeholders = std::iter::repeat_n("?", scope_uuids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            r#"
            SELECT s.uuid, s.node_type, s.text, s.scope, s.applies_when,
                   s.source_session_id, s.source_turn_ref, s.source_quote, s.source_actor,
                   s.valid_at, s.invalid_at, s.expired_at, s.created_at,
                   s.confidence, s.episode_id, s.invalidated_by, s.anchored_uuids
            FROM substrate_nodes_fts fts
            JOIN substrate_nodes s ON s.uuid = fts.uuid
            WHERE substrate_nodes_fts MATCH ?
              AND s.invalid_at IS NULL
              AND EXISTS (
                  SELECT 1 FROM json_each(s.anchored_uuids) je
                  WHERE je.value IN ({placeholders})
              )
            ORDER BY fts.rank
            LIMIT ?
            "#
        );
        let mut q = sqlx::query_as::<_, SubstrateNode>(&sql);
        q = q.bind(query);
        for u in scope_uuids {
            q = q.bind(u);
        }
        q = q.bind((limit * 2) as i64);
        q.fetch_all(pool)
            .await
            .map_err(|e| format!("fts candidates (scoped): {e}"))?
    };

    // Zero-hit fallback: if scoped JOIN returned <3, redo without the anchored JOIN.
    let scope_used = if scoped_rows.len() < 3 {
        scoped_rows = sqlx::query_as::<_, SubstrateNode>(
            r#"
            SELECT s.uuid, s.node_type, s.text, s.scope, s.applies_when,
                   s.source_session_id, s.source_turn_ref, s.source_quote, s.source_actor,
                   s.valid_at, s.invalid_at, s.expired_at, s.created_at,
                   s.confidence, s.episode_id, s.invalidated_by, s.anchored_uuids
            FROM substrate_nodes_fts fts
            JOIN substrate_nodes s ON s.uuid = fts.uuid
            WHERE substrate_nodes_fts MATCH ?
              AND s.invalid_at IS NULL
            ORDER BY fts.rank
            LIMIT ?
            "#,
        )
        .bind(query)
        .bind((limit * 2) as i64)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("fts candidates (broad): {e}"))?;
        ScopeUsed::Broad
    } else {
        ScopeUsed::Lineage
    };

    // RRF combination — FTS5 source (rank 0..N). Optional embedding cosine layered in.
    let mut combined: HashMap<String, (f64, SubstrateNode)> = HashMap::new();
    for (rank, node) in scoped_rows.into_iter().enumerate() {
        let rrf = 1.0 / (60.0 + rank as f64 + 1.0);
        combined
            .entry(node.uuid.clone())
            .or_insert((0.0, node))
            .0 += rrf;
    }

    if let Some(qe) = query_embedding {
        let cosine_rows = compute_cosine_top_n(pool, qe, limit * 2).await?;
        for (rank, (uuid, node)) in cosine_rows.into_iter().enumerate() {
            let rrf = 1.0 / (60.0 + rank as f64 + 1.0);
            combined.entry(uuid).or_insert((0.0, node)).0 += rrf;
        }
    }

    // Sort by combined RRF score descending.
    let mut candidates: Vec<(String, f64, SubstrateNode)> = combined
        .into_iter()
        .map(|(uuid, (score, node))| (uuid, score, node))
        .collect();
    candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    candidates.truncate(limit);

    Ok(candidates
        .into_iter()
        .map(|(_uuid, _score, node)| SubstrateHit::from_node(node, scope_used))
        .collect())
}

/// Cosine over substrate_embeddings BLOBs. Loads ALL current-truth embeddings into
/// memory and computes cosine in Rust. At 50-constraint scale, sub-1ms.
///
/// Returns (uuid, SubstrateNode) pairs in cosine-score-descending order.
async fn compute_cosine_top_n(
    pool: &SqlitePool,
    query: &[f32],
    limit: usize,
) -> Result<Vec<(String, SubstrateNode)>, String> {
    let rows: Vec<(String, Vec<u8>)> = sqlx::query_as(
        r#"
        SELECT e.uuid, e.vector
        FROM substrate_embeddings e
        JOIN substrate_nodes n ON n.uuid = e.uuid
        WHERE n.invalid_at IS NULL
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("embeddings load: {e}"))?;

    let mut scored: Vec<(String, f32)> = rows
        .into_iter()
        .filter_map(|(uuid, blob)| {
            let vec = blob_to_f32(&blob)?;
            if vec.len() != query.len() {
                return None; // dimension mismatch (Pitfall 4) — silently skip
            }
            let cos = cosine(query, &vec);
            Some((uuid, cos))
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);

    let uuids: Vec<String> = scored.iter().map(|(u, _)| u.clone()).collect();
    if uuids.is_empty() {
        return Ok(vec![]);
    }

    // Hydrate full SubstrateNode rows for cosine winners.
    let placeholders = std::iter::repeat_n("?", uuids.len())
        .collect::<Vec<_>>()
        .join(",");
    let q = format!(
        "SELECT s.uuid, s.node_type, s.text, s.scope, s.applies_when,
                s.source_session_id, s.source_turn_ref, s.source_quote, s.source_actor,
                s.valid_at, s.invalid_at, s.expired_at, s.created_at,
                s.confidence, s.episode_id, s.invalidated_by, s.anchored_uuids
         FROM substrate_nodes s
         WHERE s.uuid IN ({placeholders})"
    );
    let mut q = sqlx::query_as::<_, SubstrateNode>(&q);
    for u in &uuids {
        q = q.bind(u);
    }
    let nodes: Vec<SubstrateNode> = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("hydrate: {e}"))?;
    let by_uuid: HashMap<String, SubstrateNode> =
        nodes.into_iter().map(|n| (n.uuid.clone(), n)).collect();

    // Preserve cosine ordering.
    Ok(scored
        .into_iter()
        .filter_map(|(uuid, _score)| by_uuid.get(&uuid).cloned().map(|n| (uuid, n)))
        .collect())
}

fn blob_to_f32(blob: &[u8]) -> Option<Vec<f32>> {
    if blob.len() % 4 != 0 {
        return None;
    }
    Some(
        blob.chunks_exact(4)
            .map(|chunk| {
                let bytes: [u8; 4] = chunk.try_into().unwrap();
                f32::from_le_bytes(bytes)
            })
            .collect(),
    )
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0_f32;
    let mut na = 0.0_f32;
    let mut nb = 0.0_f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * TS wrappers around the four 10-03 Tauri commands + session:status event
 * subscription. Mirrors src/ipc/mcp.ts patterns.
 *
 * All Rust types here are FE-bound with `#[serde(rename_all = "camelCase")]`
 * (verified against src-tauri/src/session/types.rs and commands/session.rs).
 *
 * Phase 10 makes ZERO Claude API calls — these wrappers are read-only DB
 * IPCs + the filter heuristic preview. The `executeBackfill` call writes
 * via the standard sqlx path inside `ingest_session_file` (10-02).
 */

export interface SessionRow {
  sessionId: string;
  cwdKey: string;
  repoPath: string | null;
  startedAt: string;
  lastSeenAt: string;
  episodeCount: number;
  bytesRaw: number;
  bytesFiltered: number;
  lastLineIndex: number;
  state: 'active' | 'ended' | 'compacted';
  ingestedAt: string;
}

export interface BackfillPreview {
  sessionId: string;
  estimatedTokens: number;
  estimatedCostUsd: number;
  episodeCountEstimate: number;
  bytesRaw: number;
  mtimeIso: string;
}

export interface SessionStatus {
  watchingSessions: number;
  episodesIngested: number;
}

/**
 * Event payload — `null` fields signal the UI to refetch via getSessionStatus.
 * `execute_backfill` emits null after batch completion to consolidate the
 * per-ingest events the watcher fired during the batch (Plan 10-03 decision).
 */
export interface SessionStatusEvent {
  watchingSessions: number | null;
  episodesIngested: number | null;
}

export async function getIngestedSessions(limit = 50): Promise<SessionRow[]> {
  return invoke<SessionRow[]>('get_ingested_sessions', { limit });
}

export async function getBackfillPreview(sessionIds: string[]): Promise<BackfillPreview[]> {
  return invoke<BackfillPreview[]>('get_backfill_preview', { sessionIds });
}

export async function executeBackfill(sessionIds: string[]): Promise<number> {
  return invoke<number>('execute_backfill', { sessionIds });
}

export async function getSessionStatus(): Promise<SessionStatus> {
  return invoke<SessionStatus>('get_session_status', {});
}

export async function subscribeSessionStatus(
  cb: (ev: SessionStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<SessionStatusEvent>('session:status', (event) => cb(event.payload));
}

export interface RedistillResult {
  episodesProcessed: number;
  substrateUpserted: number;
  failures: number;
}

export interface RedistillProgress {
  current: number;
  total: number;
  episode_id: string;
}

/**
 * Re-run the distiller against every existing episode (or one session's
 * episodes if `sessionId` is provided). Sequential — respects per-session
 * DistillerLocks. Useful after distiller-pipeline fixes to rebuild substrate
 * from already-ingested episodes (INSERT OR IGNORE skips the
 * episode:ingested event on re-backfill, so this is the only retroactive path).
 */
export async function redistillAllEpisodes(
  sessionId?: string,
): Promise<RedistillResult> {
  return invoke<RedistillResult>('redistill_all_episodes', { sessionId });
}

export async function subscribeRedistillProgress(
  cb: (p: RedistillProgress) => void,
): Promise<UnlistenFn> {
  return listen<RedistillProgress>('redistill:progress', (event) => cb(event.payload));
}

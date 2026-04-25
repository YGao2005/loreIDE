/**
 * IPC wrapper for `get_sidebar_tree` (Phase 13 Plan 02).
 *
 * The Rust command walks `.contracts/` and groups sidecars by their top-level
 * area (first directory segment under `.contracts/`). Sidecars that live
 * directly under `.contracts/` (no subdirectory) are grouped under the magic
 * `ROOT_AREA` constant — the UI renders this as "Root" in italic.
 *
 * Phase 9 FLOW-01 ships the `members` frontmatter array on kind:'flow' contracts.
 * Until then, `member_uuids` on each `SidebarFlow` is an empty array; the
 * sidebar still renders the flow's name and supports clicking to navigate.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Magic area name for sidecars that live directly under `.contracts/`.
 * The Rust side emits this as the area string when no subdirectory exists;
 * the frontend special-cases it for italic "Root" rendering.
 */
export const ROOT_AREA = '_root';

export interface SidebarFlow {
  uuid: string;
  name: string;
  /** Always 'flow' as of Phase 13 Plan 02. */
  kind: string;
  /**
   * Ordered member uuids from the flow's frontmatter (Phase 9 FLOW-01).
   * Empty array when the contract sidecar has no `members` field yet.
   */
  member_uuids: string[];
}

export interface SidebarArea {
  /** Top-level area name; equals `ROOT_AREA` for root-level sidecars. */
  area: string;
  /**
   * ALL contract uuids whose sidecar lives under this area. Used to aggregate
   * badge counts on the frontend by intersecting against the existing
   * useDriftStore / useRollupStore / useSubstrateStore Sets.
   */
  member_uuids: string[];
  /** kind:'flow' contracts within this area, sorted alphabetically by name. */
  flows: SidebarFlow[];
}

export async function getSidebarTree(): Promise<SidebarArea[]> {
  return invoke<SidebarArea[]>('get_sidebar_tree');
}

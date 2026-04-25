import { invoke } from '@tauri-apps/api/core';

/**
 * Invoke the `apply_cherrypick` Rust IPC command.
 *
 * Single atomic call — writes sidecar + N source files via temp+rename order
 * (CHRY-03 invariant: one IPC, never multiple sequential calls). The Rust side
 * acquires DriftLocks per-UUID so this serializes with Phase 7 watcher and
 * 08-02 rollup engine.
 *
 * Tauri's #[tauri::command] default converts camelCase JS field names to
 * snake_case Rust field names automatically (contractBody → contract_body,
 * filePatches → file_patches), so we pass camelCase here.
 */
export async function applyCherrypick(args: {
  uuid: string;
  contractBody: string;
  filePatches: Array<{ file: string; newContent: string }>;
}): Promise<void> {
  return invoke<void>('apply_cherrypick', {
    uuid: args.uuid,
    contractBody: args.contractBody,
    filePatches: args.filePatches,
  });
}

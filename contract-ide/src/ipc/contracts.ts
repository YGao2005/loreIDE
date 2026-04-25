import { invoke } from '@tauri-apps/api/core';
import type { ContractFrontmatter } from './types';

export interface WriteContractParams {
  repoPath: string;
  uuid: string;
  frontmatter: ContractFrontmatter;
  body: string;
}

/**
 * Write a contract sidecar to disk (via the Rust single-writer command).
 * JS never writes sidecar files directly — all writes route through this
 * function, which calls write_contract on the Rust side.
 */
export async function writeContract(params: WriteContractParams): Promise<void> {
  return invoke<void>('write_contract', params as unknown as Record<string, unknown>);
}

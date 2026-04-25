/**
 * IPC wrappers for the Plan 11-04 Delegate button Tauri commands.
 *
 * Commands:
 *   delegate_compose   → assemble contract body + 5 substrate hits + lineage context
 *   delegate_plan      → run planning-only claude -p pass; return StructuredPlan
 *   delegate_execute   → append decisions-emission directive + call Phase 8 run_agent (bare=true)
 *   ensure_decisions_manifest → read agent emission or fallback to demo fixture
 */

import { invoke } from '@tauri-apps/api/core';

export interface SubstrateHit {
  uuid: string;
  node_type: string;
  rubric_label: string;
  applies_when_truncated: string;
  text: string;
  applies_when: string | null;
  scope: string | null;
  confidence: string;
  source_session_id: string | null;
  source_turn_ref: number | null;
  source_quote: string | null;
  scope_used: 'lineage' | 'broad';
}

export interface ComposeOutput {
  hits: SubstrateHit[];
  assembled_prompt: string;
}

export interface StructuredPlan {
  target_files: string[];
  substrate_rules: { uuid: string; one_line: string }[];
  decisions_preview: { key: string; chosen_value: string }[];
}

export interface DecisionsManifest {
  atom_uuid: string;
  decisions: {
    key: string;
    chosen_value: string;
    rationale: string;
    substrate_citation_id: string | null;
  }[];
}

export const ipcDelegate = {
  compose: (scopeUuid: string) =>
    invoke<ComposeOutput>('delegate_compose', { scopeUuid }),
  plan: (assembledPrompt: string) =>
    invoke<StructuredPlan>('delegate_plan', { assembledPrompt }),
  execute: (scopeUuid: string, assembledPrompt: string, atomUuid?: string) =>
    invoke<string>('delegate_execute', { scopeUuid, assembledPrompt, atomUuid }),
  ensureDecisionsManifest: (repoPath: string, atomUuid: string) =>
    invoke<DecisionsManifest>('ensure_decisions_manifest', { repoPath, atomUuid }),
};

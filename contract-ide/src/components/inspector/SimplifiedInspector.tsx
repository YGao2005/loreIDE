/**
 * Simplified inspector for Copy Mode (NONC-01).
 *
 * Renders when copyModeActive && selectedNode.level === 'L4'.
 * Replaces the four-tab Inspector layout with a three-tab strip:
 *   Contract / Preview / Receipts — NO Code tab.
 *
 * Contract tab shows:
 *   - Read-only ## Intent and ## Role sections (non-coder sees but cannot edit)
 *   - ## Inputs / ## Outputs / ## Invariants are HIDDEN (non-coder surface)
 *   - ## Examples is the editable surface (Given/When/Then Gherkin textareas)
 *
 * Entry copy banner: "Your edit lands; a teammate reviews upstream impact."
 * (verbatim per planning notes NONC-01 mandatory acknowledgment)
 *
 * Footer: DelegateToAgentButton — disabled by default in Phase 9;
 * Phase 11 wires the onDelegate prop without modifying this file.
 *
 * DISPLAY-ONLY section parser below. NEVER computes section_hashes.
 * Canonical hashing is owned by contract-ide/src-tauri/src/sidecar/section_parser.rs
 * (Phase 8 PROP-01). Do NOT add hash computation here.
 */

import { useState } from 'react';
import type { ContractNode } from '@/ipc/types';
import { GivenWhenThenEditor } from './GivenWhenThenEditor';
import { DelegateButton } from './DelegateButton';
import PreviewTab from './PreviewTab';
import ReceiptsTab from './ReceiptsTab';
import { useEditorStore } from '@/store/editor';

interface Props {
  node: ContractNode;
  /** Kept for backward compatibility — Phase 11 DelegateButton uses the store directly. */
  onDelegate?: (contractBody: string, nodeUuid: string) => void;
}

const TABS = ['contract', 'preview', 'receipts'] as const;
type Tab = (typeof TABS)[number];

export function SimplifiedInspector({ node, onDelegate: _onDelegate }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('contract');
  const contractBody = useEditorStore((s) => s.contractText);

  const sections = parseSimplifiedSections(contractBody);

  return (
    <div className="flex flex-col h-full">
      {/* Tab strip — NO Code tab (non-coder surface) */}
      <div className="flex border-b border-border/50">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Entry copy banner — verbatim per planning notes NONC-01 */}
      {activeTab === 'contract' && (
        <div className="bg-muted/40 border-b border-border/40 px-4 py-2 text-xs text-muted-foreground">
          Your edit lands; a teammate reviews upstream impact.
        </div>
      )}

      <div className="flex-1 overflow-auto min-h-0">
        {activeTab === 'contract' && (
          <div className="space-y-0">
            {/* ## Intent — read-only for non-coders */}
            {sections.intent && (
              <div className="p-4 border-b border-border/30">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Intent
                </h3>
                <p className="text-sm whitespace-pre-wrap">{sections.intent}</p>
              </div>
            )}
            {/* ## Role — read-only for non-coders */}
            {sections.role && (
              <div className="p-4 border-b border-border/30">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Role
                </h3>
                <p className="text-sm whitespace-pre-wrap">{sections.role}</p>
              </div>
            )}
            {/* ## Inputs / ## Outputs / ## Invariants are HIDDEN — non-coder surface */}
            {/* ## Examples is the primary editable surface */}
            <div className="p-4 border-b border-border/30">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Examples
              </h3>
              <GivenWhenThenEditor contractBody={contractBody} nodeUuid={node.uuid} />
            </div>
          </div>
        )}
        {activeTab === 'preview' && <PreviewTab node={node} />}
        {activeTab === 'receipts' && <ReceiptsTab node={node} />}
      </div>

      {/* Phase 11 Plan 04: Delegate button — always-visible footer; wired to useDelegateStore */}
      <div className="p-4 border-t border-border/50 shrink-0">
        <DelegateButton
          scopeUuid={node.uuid}
          level={node.level}
          atomUuid={node.uuid}
        />
      </div>
    </div>
  );
}

/**
 * DISPLAY-ONLY section parser for Copy Mode read-only Intent/Role rendering.
 *
 * SCOPE: extracts ## Intent and ## Role section bodies as plain strings for
 * display in SimplifiedInspector. Produces strings; NEVER computes section_hashes.
 *
 * Canonical section hashing is owned by contract-ide/src-tauri/src/sidecar/section_parser.rs
 * (Phase 8 PROP-01) — that Rust parser runs on write and is the single source of
 * truth for the section_hashes frontmatter field. Do NOT add hash computation here.
 */
function parseSimplifiedSections(body: string): { intent?: string; role?: string } {
  const intentMatch = body.match(/^##\s+Intent\s*\n([\s\S]*?)(?=^##\s+\w|\z)/im);
  const roleMatch = body.match(/^##\s+Role\s*\n([\s\S]*?)(?=^##\s+\w|\z)/im);
  return {
    intent: intentMatch?.[1].trim(),
    role: roleMatch?.[1].trim(),
  };
}

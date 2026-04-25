import { DiffEditor } from '@monaco-editor/react';

/**
 * DiffPane — wrapper around Monaco DiffEditor for side-by-side contract diff
 * and per-file code diff panels (CHRY-02).
 *
 * Monaco DiffEditor is already in the vite-plugin-monaco-editor bundle from
 * Phase 4 — zero new deps.
 *
 * `automaticLayout: true` avoids the setHiddenAreas timing pitfall noted in
 * Plan 04-01 (Monaco's setHiddenAreas requires careful effect gating on the
 * monaco namespace). DiffEditor doesn't need setHiddenAreas, so automaticLayout
 * is safe here.
 *
 * Language auto-detection: extensions → Monaco language IDs:
 *   .ts / .tsx → typescript
 *   .md        → markdown
 *   .json      → json
 *   .css / .scss → css
 *   .html      → html
 *   .rs        → rust
 *   anything else → plaintext
 */

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'json':
      return 'json';
    case 'css':
    case 'scss':
    case 'sass':
      return 'css';
    case 'html':
    case 'htm':
      return 'html';
    case 'rs':
      return 'rust';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'sh':
    case 'bash':
      return 'shell';
    default:
      return 'plaintext';
  }
}

interface DiffPaneProps {
  /** Display label — shown above the editor. e.g. "Contract", "src/foo.ts", "Preview" */
  label: string;
  /** Original (before) content */
  original: string;
  /** Modified (after) content */
  modified: string;
  /** Monaco language ID. If omitted, auto-detected from the `label` filename. */
  language?: string;
  /** If true, both sides of the diff are read-only. Default: true. */
  readOnly?: boolean;
}

export function DiffPane({
  label,
  original,
  modified,
  language,
  readOnly = true,
}: DiffPaneProps) {
  const lang = language ?? detectLanguage(label);

  return (
    <div className="border-b border-border/50 last:border-0">
      {/* Label header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b border-border/50">
        <span className="text-xs font-mono text-muted-foreground truncate">{label}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/60 uppercase tracking-wider">
          {lang}
        </span>
      </div>

      {/* Monaco DiffEditor — explicit pixel height. `automaticLayout: true`
          handles width changes when the dialog resizes, but the editor needs
          an authoritative initial height: `flex-1` inside a flex column inside
          a scrollable parent collapses to ~0px in @monaco-editor/react 4.x. */}
      <DiffEditor
        original={original}
        modified={modified}
        language={lang}
        height="320px"
        options={{
          renderSideBySide: true,
          readOnly,
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          lineNumbers: 'on',
          wordWrap: 'on',
        }}
        theme="vs-dark"
      />
    </div>
  );
}

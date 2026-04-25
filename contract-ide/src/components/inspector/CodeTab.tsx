import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import type { editor as MonacoEditor, IRange } from 'monaco-editor';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { readFileContent, openInEditor } from '@/ipc/inspector';
import type { CodeRange, ContractNode } from '@/ipc/types';

/**
 * Code tab — range-scoped Monaco read-only view (INSP-05).
 *
 * For each `code_range` on the selected node, mount a dedicated Monaco
 * editor loaded with the FULL file content (preserves true line numbers)
 * and use `setHiddenAreas` to collapse everything except the range + a
 * 3-line context fringe above/below. The fringe lines are dimmed via a
 * `monaco-context-dim` decoration so the user's eye lands on the range
 * without the surrounding lines disappearing entirely.
 *
 * Task 3a ships: CSS, file load, hidden areas, dim decorations, reveal/
 * open toolbar buttons.
 * Task 3b layers on: expand-handle view zones + Cmd+R/Cmd+O shortcuts.
 *
 * Anti-patterns (per RESEARCH):
 *  - DO NOT slice the file content to the range — loses true line numbers.
 *  - DO NOT use editor.deltaDecorations — soft-deprecated in favor of
 *    createDecorationsCollection.
 *  - DO NOT call setHiddenAreas directly inside onMount — useMonaco()
 *    returns null on first render, so new monaco.Range(...) can throw.
 *    Use a useEffect gated on [monaco, content].
 */
const CONTEXT_LINES = 3;

/**
 * `setHiddenAreas` is a runtime method on every `IStandaloneCodeEditor`
 * produced by `monaco.editor.create`, but Monaco does NOT expose it in its
 * public typings (it lives on the internal editor widget class). Cast
 * through this narrow interface to call it without `any`.
 */
type EditorWithHiddenAreas = MonacoEditor.IStandaloneCodeEditor & {
  setHiddenAreas: (ranges: IRange[]) => void;
};

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'tsx' || ext === 'ts') return 'typescript';
  if (ext === 'jsx' || ext === 'js') return 'javascript';
  if (ext === 'css' || ext === 'scss') return 'css';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'markdown';
  if (ext === 'html') return 'html';
  if (ext === 'rs') return 'rust';
  if (ext === 'py') return 'python';
  return 'plaintext';
}

function RangeView({
  range,
  repoPath,
}: {
  range: CodeRange;
  repoPath: string;
}) {
  const monaco = useMonaco();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch file content via the containment-guarded Tauri command. The split
  // (repoPath, range.file) is load-bearing — never pre-join into an absolute
  // path (Plan 04-01 Task 1 rationale).
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setContent(null);
    readFileContent(repoPath, range.file)
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, range.file]);

  // Task 3b's expand-handle clicks read from this ref so the SECOND click
  // sees the result of the first (stale-closure fix). Task 3b also reads
  // scopedRef + gates on scopedReady — all three are set by the scoped-view
  // effect below.
  const hiddenAreasRef = useRef<IRange[]>([]);
  const scopedRef = useRef<{
    hiddenTopEnd: number;
    hiddenBottomStart: number;
    lineCount: number;
  } | null>(null);
  // scopedReady gate: the expand-handle effect waits on this flag so it
  // cannot race with the scoped-view effect on first mount.
  const [scopedReady, setScopedReady] = useState(false);

  // Apply hidden-areas + dim decorations once both `monaco` (null on first
  // render) and the file content are ready. `@monaco-editor/react` v4+: the
  // effect-based apply is the canonical pattern, not onMount — the mount
  // callback can fire before the global Monaco namespace is defined.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !monaco || content === null) return;
    const model = ed.getModel();
    if (!model) return;
    const lineCount = model.getLineCount();
    const hiddenAreas: IRange[] = [];
    const hiddenTopEnd = range.start_line - CONTEXT_LINES - 1;
    const hiddenBottomStart = range.end_line + CONTEXT_LINES + 1;
    if (hiddenTopEnd >= 1) {
      hiddenAreas.push(new monaco.Range(1, 1, hiddenTopEnd, 1));
    }
    if (hiddenBottomStart <= lineCount) {
      hiddenAreas.push(
        new monaco.Range(hiddenBottomStart, 1, lineCount, 1),
      );
    }
    (ed as EditorWithHiddenAreas).setHiddenAreas(hiddenAreas);
    hiddenAreasRef.current = hiddenAreas;
    scopedRef.current = { hiddenTopEnd, hiddenBottomStart, lineCount };

    const dims: MonacoEditor.IModelDeltaDecoration[] = [];
    for (
      let l = Math.max(1, range.start_line - CONTEXT_LINES);
      l < range.start_line;
      l++
    ) {
      dims.push({
        range: new monaco.Range(l, 1, l, 1),
        options: { isWholeLine: true, className: 'monaco-context-dim' },
      });
    }
    for (
      let l = range.end_line + 1;
      l <= Math.min(lineCount, range.end_line + CONTEXT_LINES);
      l++
    ) {
      dims.push({
        range: new monaco.Range(l, 1, l, 1),
        options: { isWholeLine: true, className: 'monaco-context-dim' },
      });
    }
    ed.createDecorationsCollection(dims);

    ed.revealLineInCenter(range.start_line);
    setScopedReady(true); // Expand-handle effect waits on this.
  }, [monaco, content, range.start_line, range.end_line]);

  // Expand handles — GitHub-diff-style clickable fringe. Each click reads
  // from hiddenAreasRef.current (not a captured const) so the SECOND click
  // sees the result of the first — a stale snapshot would re-add the
  // region the first click just expanded.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !scopedReady || !scopedRef.current) return;
    const { hiddenTopEnd, hiddenBottomStart, lineCount } = scopedRef.current;

    const zoneIds: string[] = [];
    ed.changeViewZones((accessor) => {
      if (hiddenTopEnd >= 1) {
        const dom = document.createElement('div');
        dom.className = 'monaco-expand-handle';
        dom.textContent = `↕ Show ${hiddenTopEnd} lines above`;
        dom.onclick = () => {
          const remaining = hiddenAreasRef.current.filter(
            (a) => a.startLineNumber !== 1,
          );
          (ed as EditorWithHiddenAreas).setHiddenAreas(remaining);
          hiddenAreasRef.current = remaining;
        };
        zoneIds.push(
          accessor.addZone({
            afterLineNumber: hiddenTopEnd,
            heightInLines: 1,
            domNode: dom,
          }),
        );
      }
      if (hiddenBottomStart <= lineCount) {
        const dom = document.createElement('div');
        dom.className = 'monaco-expand-handle';
        dom.textContent = `↕ Show ${lineCount - hiddenBottomStart + 1} lines below`;
        dom.onclick = () => {
          const remaining = hiddenAreasRef.current.filter(
            (a) => a.endLineNumber !== lineCount,
          );
          (ed as EditorWithHiddenAreas).setHiddenAreas(remaining);
          hiddenAreasRef.current = remaining;
        };
        zoneIds.push(
          accessor.addZone({
            afterLineNumber: range.end_line,
            heightInLines: 1,
            domNode: dom,
          }),
        );
      }
    });

    return () => {
      const cur = editorRef.current;
      if (!cur) return;
      cur.changeViewZones((accessor) => {
        for (const id of zoneIds) accessor.removeZone(id);
      });
    };
  }, [scopedReady, range.end_line]);

  const handleMount = useCallback(
    (ed: MonacoEditor.IStandaloneCodeEditor) => {
      editorRef.current = ed;
      // Scoped view is applied by the effect above once both `ed` and
      // `monaco` are ready — do not try to apply it synchronously here.
    },
    [],
  );

  const filePath = `${repoPath}/${range.file}`;

  if (error) {
    return (
      <div className="p-4 text-sm text-red-400">
        Could not load {range.file}: {error}
      </div>
    );
  }
  if (content === null) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Loading {range.file}…
      </div>
    );
  }

  return (
    <div className="flex flex-col border-b border-border">
      <div className="px-3 py-1.5 text-xs font-mono bg-muted/30 flex items-center justify-between">
        <span>
          {range.file}{' '}
          <span className="text-muted-foreground">
            :{range.start_line}–{range.end_line}
          </span>
        </span>
        <div className="flex gap-2">
          <button
            className="text-xs hover:underline"
            onClick={() => {
              void revealItemInDir(filePath).catch(console.error);
            }}
          >
            ⌘R Reveal
          </button>
          <button
            className="text-xs hover:underline"
            onClick={() => {
              void openInEditor(filePath, range.start_line).catch(
                console.error,
              );
            }}
          >
            ⌘O Open
          </button>
        </div>
      </div>
      <div className="h-64">
        <Editor
          value={content}
          language={detectLanguage(range.file)}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            fontSize: 12,
            renderLineHighlight: 'none',
          }}
          onMount={handleMount}
          theme="vs-dark"
        />
      </div>
    </div>
  );
}

export default function CodeTab({
  node,
  repoPath,
}: {
  node: ContractNode | null;
  repoPath: string | null;
}) {
  if (!node) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select a node to view its code.
      </div>
    );
  }
  if (!repoPath) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Open a repository to view code.
      </div>
    );
  }
  if (!node.code_ranges || node.code_ranges.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No code ranges attached to this node.
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full overflow-auto">
      {node.code_ranges.map((r, i) => (
        <RangeView
          key={`${r.file}-${r.start_line}-${i}`}
          range={r}
          repoPath={repoPath}
        />
      ))}
    </div>
  );
}

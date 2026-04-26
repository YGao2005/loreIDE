# references/jsx-alignment.md — Stage 4 algorithm

Stage 4 tightens `code_ranges` for L4 UI atoms (and any L3 UI nodes whose Stage 1 heuristic ranges covered the whole file rather than a sub-region) so that `start_line` / `end_line` wrap exactly the JSX element that renders the atom.

The output ranges MUST satisfy the Rust `jsx_align_validator.rs` rule. The skill never fabricates ranges that the Rust validator would reject — refusal to emit on zero-match is the design choice.

## Source of truth

`contract-ide/src-tauri/src/sidecar/jsx_align_validator.rs` is the authoritative validator. Stage 4 of the skill is a JS-side faithful re-implementation of the SAME rule used downstream. The JS impl uses `@babel/parser`; the Rust impl uses `swc_core`. Both must agree on element boundaries for any well-formed TSX file. Plan 14-01b ships parser config tests that assert this parity on the contract-ide-demo fixtures.

## Babel parser configuration (load-bearing)

Stage 4 MUST use this exact Babel config. It mirrors the Phase 9 `babel-plugin-contract-data-attrs` plugin's parser bytewise:

```js
import { parse } from '@babel/parser';

const ast = parse(source, {
  sourceType: 'module',
  plugins: ['jsx', 'typescript'],
});
```

Notes:

- `sourceType: 'module'` — Next.js source files are ES modules.
- `plugins: ['jsx', 'typescript']` — order matters less than presence; both are required for `.tsx` files.
- Do NOT add `decorators`, `classProperties`, or other plugins. The Phase 9 plugin doesn't, and adding them changes how some edge-case syntax (e.g., experimental decorator metadata) is parsed, which can shift line numbers.

## Algorithm

Given a node's heuristic candidate range `{ file, start_line: HS, end_line: HE }`:

1. **Read + parse.** Read the file at `file`. Parse into an AST with the config above.
2. **Enumerate JSX elements.** Walk the AST and collect every `JSXElement` and `JSXFragment` whose `loc.start.line >= HS` AND `loc.end.line <= HE`. Call this set `candidates`.
3. **Filter to outermost.** Drop any candidate that is a strict descendant (in AST terms) of another candidate. The result is the set of "outermost contained" elements.
4. **Match by shape.**
   - **Exactly one outermost element**: emit `{ file, start_line: e.loc.start.line, end_line: e.loc.end.line }`.
   - **Zero outermost elements**: mark the node `unbootstrappable: true` in `.staging/diagnostics.json`. Do NOT emit a sidecar for this node. Do NOT guess.
   - **Multiple outermost elements**: emit a structured tiebreak prompt to `claude -p --json-schema` with a small inline schema returning the index of the chosen element. Pass the model: the file content, the candidate list (each as `{ index, start_line, end_line, opening_tag, first_n_chars }`), and the node's `## Intent` from Stage 3.

## Pseudocode

```js
function alignNode(node, sourceText, parse, traverse) {
  const ast = parse(sourceText, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  const { start_line: HS, end_line: HE } = node.code_ranges[0];

  const candidates = [];
  traverse(ast, {
    enter(path) {
      const t = path.node.type;
      if (t !== 'JSXElement' && t !== 'JSXFragment') return;
      const sL = path.node.loc.start.line;
      const eL = path.node.loc.end.line;
      if (sL >= HS && eL <= HE) candidates.push(path);
    },
  });

  // Outermost: drop any candidate strictly contained in another.
  const outermost = candidates.filter((p) => {
    return !candidates.some(
      (q) =>
        q !== p &&
        q.node.loc.start.line <= p.node.loc.start.line &&
        q.node.loc.end.line >= p.node.loc.end.line &&
        !(q.node.loc.start.line === p.node.loc.start.line && q.node.loc.end.line === p.node.loc.end.line),
    );
  });

  if (outermost.length === 1) {
    const e = outermost[0].node;
    return {
      file: node.code_ranges[0].file,
      start_line: e.loc.start.line,
      end_line: e.loc.end.line,
    };
  }
  if (outermost.length === 0) {
    return { unbootstrappable: true, reason: 'no JSX element found in heuristic range' };
  }
  // Multi-match: LLM tiebreak
  const choice = llmTiebreak(node, outermost, sourceText);
  const e = outermost[choice].node;
  return {
    file: node.code_ranges[0].file,
    start_line: e.loc.start.line,
    end_line: e.loc.end.line,
  };
}
```

## Edge cases

- **Comments before the JSX element.** `loc.start.line` on a `JSXElement` is the line of the `<` opening token, NOT including any leading comments. This is the correct anchor — `jsx_align_validator.rs` enforces the same.
- **JSX expressions inside `{}`.** A `{condition && <div/>}` block: the `<div/>` is the JSX element; the `{}` wrapper is a `JSXExpressionContainer` (NOT itself a JSXElement). The walker correctly anchors on the inner `<div/>`.
- **Multiline opening tags.** `<MyComp\n  prop="..."\n>` — `loc.start.line` is the line of `<MyComp`, `loc.end.line` is the line of `</MyComp>` (not `>`). Validator agrees.
- **Self-closing tags.** `<MyComp />` — `loc.end.line === loc.start.line` is the common case for one-liner self-closing elements. That's fine.
- **Fragments.** `<>...</>` and `<React.Fragment>...</React.Fragment>` are both valid outermost candidates if they exclusively wrap the heuristic range.

## Refusal contract

If a node cannot be aligned (zero outermost JSX in range), Stage 4 records `{ uuid, reason }` in `.staging/diagnostics.json` under `unbootstrappable[]` and proceeds. After all nodes are aligned, Stage 5b's atomic-emit gate refuses to write `.contracts/` if `unbootstrappable.length > 0`. The user's choices: re-run with manual `code_ranges` hints (Phase 14 future enhancement), or skip the offending node by adding it to a `.bootstrap-skip` list (Plan 14-01b ships the helper for this).

This is intentional. A wrong `code_range` would silently break Phase 7 drift detection (DRIFT-01 hashes the source range) and Phase 13 atom chips (CHIP-01 attaches `data-contract-uuid` based on the range). Better to refuse than to emit garbage.

/**
 * Given/When/Then editor for Copy Mode (NONC-01).
 *
 * Parses the ## Examples section of a contract body into three labeled
 * textareas. On change, reconstructs the full body and pushes it to the
 * editor store's setContractText — which triggers the existing 400ms debounced
 * autosave path (Plan 04-02). The Phase 8 PROP-01 frontmatter writer computes
 * section_hashes on the actual write, so section_hashes are always recomputed
 * correctly even for Copy Mode saves.
 *
 * Uses DISPLAY-ONLY helpers from contract-sections.ts. These helpers NEVER
 * compute section_hashes — that is owned by the canonical Rust section parser.
 */

import { useEffect, useMemo, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { parseExamplesSection, reconstructExamplesSection } from '@/lib/contract-sections';
import { useEditorStore } from '@/store/editor';

interface Props {
  contractBody: string;
  nodeUuid: string;
}

export function GivenWhenThenEditor({ contractBody, nodeUuid }: Props) {
  const initial = useMemo(() => parseExamplesSection(contractBody), [contractBody]);
  const [given, setGiven] = useState(initial.given);
  const [when, setWhen] = useState(initial.when);
  const [then, setThen] = useState(initial.then);
  const setContractText = useEditorStore((s) => s.setContractText);

  // Reset local state when node changes (nodeUuid is a stable identity signal).
  useEffect(() => {
    setGiven(initial.given);
    setWhen(initial.when);
    setThen(initial.then);
  }, [initial, nodeUuid]);

  // Reconstruct body and push to editor store on each change. The existing
  // 400ms debounced autosave (Plan 04-02) takes over from there — same path
  // as ContractTab, so Phase 8 PROP-01 frontmatter writer recomputes
  // section_hashes on the actual write.
  //
  // Intentionally NOT depending on contractBody to avoid an infinite loop:
  // setContractText → contractBody changes → effect re-runs → setContractText…
  useEffect(() => {
    const newBody = reconstructExamplesSection(contractBody, { given, when, then });
    if (newBody !== contractBody) {
      setContractText(newBody);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [given, when, then]); // intentionally NOT depending on contractBody

  return (
    <div className="space-y-4 p-4">
      <div>
        <Label htmlFor="gwt-given" className="text-xs uppercase tracking-wider text-muted-foreground">
          GIVEN
        </Label>
        <Textarea
          id="gwt-given"
          value={given}
          onChange={(e) => setGiven(e.target.value)}
          rows={2}
          placeholder="a logged-in customer on the Account Settings page"
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="gwt-when" className="text-xs uppercase tracking-wider text-muted-foreground">
          WHEN
        </Label>
        <Textarea
          id="gwt-when"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          rows={2}
          placeholder="they click Delete Account and confirm via the email link"
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="gwt-then" className="text-xs uppercase tracking-wider text-muted-foreground">
          THEN
        </Label>
        <Textarea
          id="gwt-then"
          value={then}
          onChange={(e) => setThen(e.target.value)}
          rows={3}
          placeholder="their account is marked for deletion with a 30-day grace window"
          className="mt-1"
        />
      </div>
    </div>
  );
}

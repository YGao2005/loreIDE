/**
 * Delegate to Agent button — Phase 11 stub.
 *
 * Phase 9 ships with `onDelegate` undefined by default — the button renders
 * as disabled with a tooltip explaining it lands in Phase 11.
 *
 * Phase 11 wires the real handler by passing the `onDelegate` prop to
 * SimplifiedInspector which threads it through to this component. No changes
 * needed to this file or SimplifiedInspector in Phase 11.
 *
 * Prop seam: `onDelegate?: (contractBody: string, nodeUuid: string) => void`
 */

import { Button } from '@/components/ui/button';

interface Props {
  /** Phase 11 wires this; Phase 9 ships with prop undefined → button disabled */
  onDelegate?: (contractBody: string, nodeUuid: string) => void;
  contractBody: string;
  nodeUuid: string;
}

export function DelegateToAgentButton({ onDelegate, contractBody, nodeUuid }: Props) {
  const enabled = typeof onDelegate === 'function';
  return (
    <Button
      onClick={enabled ? () => onDelegate!(contractBody, nodeUuid) : undefined}
      disabled={!enabled}
      title={enabled ? undefined : 'Available in Phase 11'}
      className="w-full"
      size="lg"
    >
      Delegate to agent
    </Button>
  );
}

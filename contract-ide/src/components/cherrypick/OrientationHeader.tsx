/**
 * OrientationHeader — persistent header rendered ABOVE all diff panes in the
 * cherrypick modal (CHRY-02).
 *
 * Renders: `{NodeName} — {intentPhrase} — {N} tool call{s}`
 *
 * Sticky at the top of the modal scroll region so it remains visible as the
 * user scrolls through contract + code + preview diff panes. The `—` separator
 * (em dash) matches the Beat 2 receipt banner convention in presentation-script.md.
 *
 * Per CONTEXT.md: demo-grade for the orientation header — it must read at a
 * glance in one line even on a muted recording.
 */

interface OrientationHeaderProps {
  nodeName: string;
  intentPhrase: string;
  toolCallCount: number;
}

export function OrientationHeader({
  nodeName,
  intentPhrase,
  toolCallCount,
}: OrientationHeaderProps) {
  const callLabel = toolCallCount === 1 ? 'tool call' : 'tool calls';

  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/50 px-4 py-3">
      <p className="text-[15px] font-medium text-foreground leading-snug">
        <span className="font-semibold">{nodeName}</span>
        <span className="text-muted-foreground mx-2">—</span>
        <span>{intentPhrase}</span>
        <span className="text-muted-foreground mx-2">—</span>
        <span className="font-mono text-sm">
          {toolCallCount} {callLabel}
        </span>
      </p>
    </div>
  );
}

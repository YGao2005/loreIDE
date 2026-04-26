import { useGraphStore } from '@/store/graph';
import { cn } from '@/lib/utils';
import { ChatPanel } from './ChatPanel';
import ReceiptsTab from '@/components/inspector/ReceiptsTab';

/**
 * Right-hand sidebar — tabbed agent surface.
 *
 *   [ Chat | Receipts ]
 *
 * Sits at full window height, mirrors the left Sidebar width axis but on the
 * right edge. Receipts moved out of Inspector tabs (which now lives at the
 * bottom and focuses on per-node detail). Both tabs share the selected node
 * as their scope.
 *
 * Tab state is owned here (not lifted) — CommandPalette → focus-chat goes
 * through AppShell's panelRef.expand() + the `activeTab` prop drilled in
 * via `forceTab` on Cmd+K trigger.
 */
export type RightPanelTab = 'Chat' | 'Receipts';
const TABS: RightPanelTab[] = ['Chat', 'Receipts'];

export interface RightPanelProps {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
}

export function RightPanel({ activeTab, onTabChange }: RightPanelProps) {
  const selectedNodeUuid = useGraphStore((s) => s.selectedNodeUuid);
  const nodes = useGraphStore((s) => s.nodes);
  const selectedNode = nodes.find((n) => n.uuid === selectedNodeUuid) ?? null;

  return (
    <div className="h-full w-full bg-background border-l border-border/50 flex flex-col">
      {/* Tab strip — matches Inspector pattern */}
      <div className="flex items-center gap-1 border-b border-border/50 px-3 py-2 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={cn(
              'text-xs px-2.5 py-1 rounded-md transition-colors',
              activeTab === tab
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'Chat' && <ChatPanel />}
        {activeTab === 'Receipts' && <ReceiptsTab node={selectedNode} />}
      </div>
    </div>
  );
}

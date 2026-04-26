import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ChatPanel } from './ChatPanel';
import { HistoryPanel } from '@/components/history/HistoryPanel';
import { SyncReviewPanel } from '@/components/sync-review/SyncReviewPanel';
import { useSyncReviewStore } from '@/store/syncReview';

/**
 * Right-hand sidebar — tabbed agent surface.
 *
 *   [ Chat | History | Review ]
 *
 * History (formerly Receipts) lists closed chats; receipts now fold under
 * each chat row that produced them. Review tab (Phase 13.5) hosts the
 * PR-review surface; auto-activates when a sync-review payload hydrates.
 */
export type RightPanelTab = 'Chat' | 'History' | 'Review';
const TABS: RightPanelTab[] = ['Chat', 'History', 'Review'];

export interface RightPanelProps {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
}

export function RightPanel({ activeTab, onTabChange }: RightPanelProps) {
  const reviewPayload = useSyncReviewStore((s) => s.payload);

  // Auto-switch to Review tab when a payload hydrates from a Pull, so the
  // user lands on the surface without manually clicking the tab.
  useEffect(() => {
    if (reviewPayload && activeTab !== 'Review') {
      onTabChange('Review');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewPayload]);

  return (
    <div className="h-full w-full bg-background border-l border-border flex flex-col">
      {/* Tab strip */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2 shrink-0">
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
        {activeTab === 'History' && (
          <HistoryPanel onReopen={() => onTabChange('Chat')} />
        )}
        {activeTab === 'Review' && <SyncReviewPanel />}
      </div>
    </div>
  );
}

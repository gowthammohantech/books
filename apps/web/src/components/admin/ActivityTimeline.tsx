import useDateFormatter from '@hooks/useDateFormatter';
import type { ActivityEntry } from '@models/activity';

import { EmptyState } from '@components/ui';

import { dotClass, entryLabel, relativeTime } from '@lib/activityTimeline';

/**
 * An entity's audit feed.
 *
 * Replaces InvoiceActivityTimeline and PurchaseActivityTimeline, which were 93
 * identical lines apart from which hook they called and what they named the id
 * prop.
 *
 * It takes the rows rather than an id, so each caller keeps its own hook. The
 * alternative — passing the hook itself as a prop — would put a hook call behind
 * a variable, which the rules of hooks do not allow to vary between renders.
 * Keeping this presentational also means a third document type needs no change
 * here at all.
 */
interface ActivityTimelineProps {
  entries: ActivityEntry[];
  loading: boolean;
}

const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ entries, loading }) => {
  const { formatDate } = useDateFormatter();

  return (
    <div className="font-sans max-w-5xl mx-auto mt-4 mb-4 bg-white rounded-xl border border-border shadow-sm">
      {/* Card header */}
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Activity</h2>
      </div>

      <div className="px-4 py-3">
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Loading activity…</p>
        ) : entries.length === 0 ? (
          <EmptyState size="compact" art="checking-boxes" title="No activity yet" />
        ) : (
          <ol className="relative border-l border-border ml-2 space-y-0">
            {entries.map((entry, idx) => (
              <li key={entry.id ?? idx} className="mb-4 ml-4">
                {/* Timeline dot */}
                <span
                  className={`absolute -left-[7px] mt-1 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-white ${dotClass(entry.action)}`}
                />
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm text-foreground leading-snug">{entryLabel(entry)}</span>
                  {entry.userName && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      by {entry.userName}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground whitespace-nowrap ml-auto">
                    {relativeTime(entry.createdAt, formatDate)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};

export default ActivityTimeline;

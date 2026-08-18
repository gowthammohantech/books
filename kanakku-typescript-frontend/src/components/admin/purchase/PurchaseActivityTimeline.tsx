import { usePurchaseActivity } from '@hooks/usePurchaseActivity';
import type { PurchaseActivityEntry } from '@hooks/usePurchaseActivity';
import useDateFormatter from '@hooks/useDateFormatter';

interface PurchaseActivityTimelineProps {
    purchaseId: string;
}

function relativeTime(iso: string, formatDate: (value: string) => string): string {
    try {
        const diff = Date.now() - new Date(iso).getTime();
        const seconds = Math.floor(diff / 1000);
        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d ago`;
        return formatDate(iso);
    } catch {
        return iso;
    }
}

function entryLabel(entry: PurchaseActivityEntry): string {
    if (entry.summary) return entry.summary;
    // Fallback: compose from action + entityType
    const action = entry.action ?? '';
    const type = entry.entityType ?? '';
    return [action, type].filter(Boolean).join(' ') || 'Activity recorded';
}

/** Map common action strings to a short coloured dot class. */
function dotClass(action: string): string {
    const a = (action ?? '').toLowerCase();
    if (a.includes('void') || a.includes('reverse') || a.includes('cancel')) return 'bg-danger';
    if (a.includes('payment') || a.includes('paid')) return 'bg-success';
    if (a.includes('sent') || a.includes('send')) return 'bg-info';
    if (a.includes('create') || a.includes('draft')) return 'bg-gray-400';
    if (a.includes('status')) return 'bg-indigo-400';
    return 'bg-purple-400';
}

const PurchaseActivityTimeline: React.FC<PurchaseActivityTimelineProps> = ({ purchaseId }) => {
    const { entries, loading } = usePurchaseActivity(purchaseId);
    const { formatDate } = useDateFormatter();

    return (
        <div className="font-sans max-w-5xl mx-auto mt-4 mb-4 bg-white rounded-card border border-border shadow-card">
            {/* Card header */}
            <div className="px-4 py-3 border-b border-border">
                <h2 className="text-lg font-semibold text-heading">Activity</h2>
            </div>

            <div className="px-4 py-3">
                {loading ? (
                    <p className="text-sm text-body text-center py-4">Loading activity…</p>
                ) : entries.length === 0 ? (
                    <p className="text-sm text-body text-center py-4">No activity yet.</p>
                ) : (
                    <ol className="relative border-l border-border ml-2 space-y-0">
                        {entries.map((entry, idx) => (
                            <li key={entry.id ?? idx} className="mb-4 ml-4">
                                {/* Timeline dot */}
                                <span
                                    className={`absolute -left-[7px] mt-1 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-white ${dotClass(entry.action)}`}
                                />
                                <div className="flex items-baseline gap-2 flex-wrap">
                                    <span className="text-sm text-heading leading-snug">
                                        {entryLabel(entry)}
                                    </span>
                                    {entry.userName && (
                                        <span className="text-xs text-body whitespace-nowrap">
                                            by {entry.userName}
                                        </span>
                                    )}
                                    <span className="text-xs text-body whitespace-nowrap ml-auto">
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

export default PurchaseActivityTimeline;

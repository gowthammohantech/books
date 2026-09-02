/**
 * Pure helpers behind `<ActivityTimeline>`.
 *
 * They live here rather than in the component because `apps/web` runs Vitest
 * with `environment: 'node'` and neither jsdom nor @testing-library installed —
 * a `.tsx` component cannot be rendered in a test, but this module can be
 * imported directly. Extracting them is the only regression cover available for
 * the timeline unification.
 */
import type { ActivityEntry } from '@models/activity';

/**
 * "just now" / "5m ago" / "3h ago" / "12d ago", falling back to the tenant's own
 * date format once an entry is older than 30 days.
 *
 * `formatDate` is injected rather than imported because it comes from
 * `useDateFormatter`, which is bound to the tenant's locale settings — a hook,
 * and therefore unavailable to a pure module.
 */
export function relativeTime(iso: string, formatDate: (value: string) => string): string {
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
    // Unreachable for an unparseable date: `new Date('x')` yields NaN rather than
    // throwing, so that case falls through to formatDate above. Kept for a
    // formatDate that throws.
    return iso;
  }
}

/** The server's own summary when it wrote one; otherwise compose action + entity type. */
export function entryLabel(entry: ActivityEntry): string {
  if (entry.summary) return entry.summary;
  const action = entry.action ?? '';
  const type = entry.entityType ?? '';
  return [action, type].filter(Boolean).join(' ') || 'Activity recorded';
}

/** Map common action strings to a short coloured dot class. */
export function dotClass(action: string): string {
  const a = (action ?? '').toLowerCase();
  if (a.includes('void') || a.includes('reverse') || a.includes('cancel')) return 'bg-destructive';
  if (a.includes('payment') || a.includes('paid')) return 'bg-success';
  if (a.includes('sent') || a.includes('send')) return 'bg-info';
  if (a.includes('create') || a.includes('draft')) return 'bg-gray-400';
  if (a.includes('status')) return 'bg-indigo-400';
  return 'bg-chart-3';
}

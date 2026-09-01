import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useWorkQueues } from '@hooks/useWorkQueues';
import { WORK_QUEUES } from '@lib/workQueues';

/**
 * "What is waiting for me", from anywhere in the app.
 *
 * There is no notification *feed* behind this — no per-event table, no read
 * state — and the bell does not pretend there is. What it reports is the work
 * queues: the same counts the sidebar badges and the dashboard tiles are drawn
 * from (useWorkQueues caches them at module level, so this costs no extra
 * request). That makes it an index of the badges scattered down the rail, which
 * is the question a bell is actually asked on a page that is not the dashboard.
 *
 * A queue at zero is left out rather than listed as "0": the panel is a list of
 * things to do, and an empty one should read as empty.
 */
const NotificationBell = () => {
    const { counts } = useWorkQueues();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const waiting = WORK_QUEUES.map((queue) => ({
        ...queue,
        count: counts?.[queue.key] ?? 0,
    })).filter((queue) => queue.count > 0);

    const total = waiting.reduce((sum, queue) => sum + queue.count, 0);

    // A menu that can only be dismissed by choosing something traps the reader
    // into a navigation they may not want. Mirrors the sidebar footer menu.
    useEffect(() => {
        if (!isOpen) return;
        const onPointerDown = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen]);

    const label = total > 0 ? `Notifications (${total} waiting)` : 'Notifications';

    return (
        <div ref={containerRef} className="relative shrink-0">
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-label={label}
                title={label}
                className={`relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors cursor-pointer ${isOpen
                    ? 'border-transparent bg-muted text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
            >
                <Bell size={16} />
                {total > 0 && (
                    // The exact figure is one row away inside the panel, so the
                    // glyph carries a dot rather than a pill that would have to
                    // shrink the icon to fit beside it.
                    <span
                        aria-hidden="true"
                        className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card"
                    />
                )}
            </button>

            {isOpen && (
                <div
                    role="menu"
                    aria-orientation="vertical"
                    className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
                >
                    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                        <p className="text-sm font-semibold text-foreground">Needs attention</p>
                        {total > 0 && (
                            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary-foreground">
                                {total > 99 ? '99+' : total}
                            </span>
                        )}
                    </div>

                    {waiting.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-muted-foreground">
                            Nothing waiting. Every queue is clear.
                        </p>
                    ) : (
                        waiting.map((queue) => (
                            <Link
                                key={queue.key}
                                to={queue.to}
                                role="menuitem"
                                onClick={() => setIsOpen(false)}
                                className="flex items-center gap-3 px-3 py-2 hover:bg-muted"
                            >
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-sm font-medium text-foreground">
                                        {queue.label}
                                    </span>
                                    <span className="truncate text-xs text-muted-foreground">
                                        {queue.module}
                                    </span>
                                </span>
                                <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-primary-foreground">
                                    {queue.count > 99 ? '99+' : queue.count}
                                </span>
                            </Link>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default NotificationBell;

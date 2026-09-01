import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { FC, ReactNode } from "react";

type Accent =
    | "primary"
    | "success"
    | "info"
    | "warning"
    | "teal"
    | "danger";

interface StatsCardProps {
    title: string;
    value: number | string;
    /** Month-over-month trend %. Omit entirely (not 0) to hide the delta row —
     * e.g. an arbitrary-date-range report has no "last month" to compare to,
     * and showing "0% from last month" there reads as a false/confusing signal. */
    difference?: number;
    icon: ReactNode;
    // Legacy: previously derived the icon-badge color from the trend (up/down),
    // which made a plain metric like "Total Income" render a red badge just
    // because this month is down — the trend arrow below already conveys
    // direction, so the badge itself no longer reads it. Kept (unused) so
    // existing call sites don't need to change their props.
    color: string;
    accent?: Accent; // fixed category accent for the icon badge; defaults to "primary"
    /** Small caption clarifying the value's time window, e.g. "This month". */
    period?: string;
}

// Static class map so Tailwind JIT can see every utility (no runtime interpolation).
const ACCENT_CHIP: Record<Accent, string> = {
    primary: "bg-accent text-primary",
    success: "bg-success-soft text-success-strong",
    info: "bg-info-soft text-info-strong",
    warning: "bg-warning-soft text-warning-strong",
    teal: "bg-teal-soft text-teal",
    danger: "bg-destructive-soft text-destructive-strong",
};

const StatsCard: FC<StatsCardProps> = ({ title, value, difference, icon, accent, period }) => {
    const hasDifference = difference !== undefined;
    const isPositive = (difference ?? 0) >= 0;
    const resolvedAccent: Accent = accent ?? "primary";

    return (
        <div className="relative bg-white border border-border rounded-xl shadow-sm hover:shadow-md transition-all p-4">
            {/* Top: title + icon */}
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-sm font-medium text-muted-foreground">
                        {title}
                    </h3>
                    {period && <p className="text-xs text-muted-foreground/70">{period}</p>}
                </div>
                <div
                    className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${ACCENT_CHIP[resolvedAccent]}`}
                >
                    {icon}
                </div>
            </div>

            {/* Value. Mono + tabular figures so a column of these lines up on
                the decimal — proportional digits make ₹2,90,700 and ₹1,33,324
                different widths, and a KPI row is read by comparing them. */}
            <p className="text-2xl font-bold text-foreground mt-3 font-mono tabular-nums tracking-tight">
                {value}
            </p>

            {/* Difference — omitted entirely when the caller has no trend to show */}
            {hasDifference && (
                <div className="flex items-center mt-1 text-xs">
                    <span
                        className={`flex items-center font-medium ${isPositive ? "text-success" : "text-destructive"
                            }`}
                    >
                        {isPositive ? (
                            <ArrowUpRight className="w-3 h-3 mr-1" />
                        ) : (
                            <ArrowDownLeft className="w-3 h-3 mr-1" />
                        )}
                        {(difference as number).toFixed()}%
                    </span>
                    <span className="ml-1 text-muted-foreground">from last month</span>
                </div>
            )}
        </div>
    );
};

export default StatsCard;

import { Briefcase, Factory, Store } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@lib/cn";
import type { BusinessType } from "@elixirbooks/enums";

/**
 * Plain lucide glyphs, not <AnimatedIcon>. These are static card decoration
 * with no hover motion to express, and the animated variants under
 * components/icons/variants are generated from the registry by
 * scripts/gen-icon-variants.mjs - adding three semantic names there to draw
 * three still pictures would be motion machinery earning nothing.
 */
const OPTIONS: {
    value: BusinessType;
    label: string;
    blurb: string;
    Icon: LucideIcon;
}[] = [
    {
        value: "MANUFACTURING",
        label: "Manufacturing",
        blurb: "You make goods - raw materials, production, finished stock.",
        Icon: Factory,
    },
    {
        value: "TRADING",
        label: "Trading / Distribution",
        blurb: "You buy and resell goods - wholesale, retail, distribution.",
        Icon: Store,
    },
    {
        value: "SERVICES",
        label: "Services",
        blurb: "You bill for services, retainers or projects - no stock.",
        Icon: Briefcase,
    },
];

interface StepBusinessTypeProps {
    value: BusinessType | null;
    onChange: (value: BusinessType) => void;
}

const StepBusinessType: React.FC<StepBusinessTypeProps> = ({ value, onChange }) => (
    <fieldset>
        <legend className="sr-only">What kind of business is this?</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {OPTIONS.map(({ value: option, label, blurb, Icon }) => {
                const selected = value === option;
                return (
                    <label
                        key={option}
                        className={cn(
                            "group relative flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4",
                            "shadow-sm transition-colors",
                            selected
                                ? "border-primary ring-1 ring-ring"
                                : "border-border hover:border-primary/50"
                        )}
                    >
                        <input
                            type="radio"
                            name="businessType"
                            value={option}
                            checked={selected}
                            onChange={() => onChange(option)}
                            className="sr-only"
                        />
                        <span
                            className={cn(
                                "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                                selected ? "bg-primary text-primary-foreground" : "bg-accent text-primary"
                            )}
                        >
                            <Icon size={18} aria-hidden />
                        </span>
                        <span className="text-sm font-semibold text-foreground">{label}</span>
                        <span className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                            {blurb}
                        </span>
                    </label>
                );
            })}
        </div>
    </fieldset>
);

export default StepBusinessType;

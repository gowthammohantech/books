import { Lock } from "lucide-react";

import { AnimatedIcon } from "@components/icons";
import { Badge, Checkbox } from "@components/ui";
import { cn } from "@lib/cn";
import { SETUP_MODULE_GROUPS, type SetupModuleGroup } from "@lib/setupModules";
import type { SetupModuleKey } from "@elixirbooks/enums";

const TIER_LABEL: Record<SetupModuleGroup["tier"], string> = {
    included: "Included",
    recommended: "Recommended",
    optional: "Optional",
};

interface StepModulesProps {
    value: SetupModuleKey[];
    onChange: (next: SetupModuleKey[]) => void;
}

const StepModules: React.FC<StepModulesProps> = ({ value, onChange }) => {
    const toggle = (key: SetupModuleKey) => {
        onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
    };

    return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {SETUP_MODULE_GROUPS.map((group) => {
                const locked = !group.available;
                const included = group.tier === "included";
                // Included groups read as ticked because they ARE on; locked
                // ones read as unticked because there is nothing to turn on.
                const checked = included || (!locked && value.includes(group.key));
                const disabled = locked || included;

                return (
                    <div
                        key={group.key}
                        className={cn(
                            "flex items-start gap-3 rounded-xl border p-3 transition-colors",
                            locked && "border-border bg-muted/40",
                            !locked && checked && "border-primary/40 bg-accent/40",
                            !locked && !checked && "border-border bg-card hover:border-primary/40"
                        )}
                    >
                        {locked ? (
                            <span
                                aria-hidden
                                className="mt-0.5 flex h-4 w-4 items-center justify-center text-muted-foreground"
                            >
                                <Lock size={13} />
                            </span>
                        ) : (
                            <Checkbox
                                checked={checked}
                                disabled={disabled}
                                onChange={() => toggle(group.key)}
                                containerClassName="mt-0.5"
                                aria-label={group.label}
                            />
                        )}

                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                {group.icon && (
                                    <AnimatedIcon
                                        name={group.icon}
                                        size={15}
                                        className={locked ? "text-muted-foreground" : "text-primary"}
                                    />
                                )}
                                <span
                                    className={cn(
                                        "text-[0.8125rem] font-semibold",
                                        locked ? "text-muted-foreground" : "text-foreground"
                                    )}
                                >
                                    {group.label}
                                </span>
                                {locked ? (
                                    <Badge color="gray" variant="soft">
                                        Coming soon
                                    </Badge>
                                ) : (
                                    <Badge
                                        color={included ? "warning" : "gray"}
                                        variant="soft"
                                    >
                                        {TIER_LABEL[group.tier]}
                                    </Badge>
                                )}
                            </div>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                {group.blurb}
                            </p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default StepModules;

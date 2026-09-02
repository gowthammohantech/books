import { Check } from "lucide-react";

import { cn } from "@lib/cn";

export const SETUP_STEPS = [
    { key: "business", label: "Business type" },
    { key: "profile", label: "Company profile" },
    { key: "modules", label: "Modules" },
    { key: "review", label: "Review" },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];

interface SetupStepperProps {
    /** Index into SETUP_STEPS. */
    current: number;
    /** Jump back to an already-completed step. Forward is never allowed. */
    onJump?: (index: number) => void;
}

/**
 * The numbered rail across the top of the wizard.
 *
 * Same idiom as LedgerSetupWizard's StepIndicator - a STEPS array and a derived
 * index - widened to four steps and made navigable backwards, since a wizard
 * you cannot walk back through makes people abandon rather than correct.
 */
const SetupStepper: React.FC<SetupStepperProps> = ({ current, onJump }) => (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {SETUP_STEPS.map((step, idx) => {
            const done = idx < current;
            const active = idx === current;
            // Only backwards: a step ahead may depend on answers not given yet.
            const canJump = done && !!onJump;

            return (
                <li key={step.key} className="flex items-center">
                    <button
                        type="button"
                        onClick={canJump ? () => onJump(idx) : undefined}
                        disabled={!canJump}
                        aria-current={active ? "step" : undefined}
                        className={cn(
                            "inline-flex items-center gap-2 rounded-md px-2 py-1 transition-colors",
                            canJump ? "cursor-pointer hover:bg-muted" : "cursor-default"
                        )}
                    >
                        <span
                            className={cn(
                                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                                "text-xs font-semibold transition-colors",
                                done && "bg-primary text-primary-foreground",
                                active && "bg-foreground text-background",
                                !done && !active && "bg-secondary text-muted-foreground"
                            )}
                        >
                            {done ? <Check size={13} strokeWidth={3} /> : idx + 1}
                        </span>
                        <span
                            className={cn(
                                "text-[0.8125rem] font-medium",
                                active ? "text-foreground" : "text-muted-foreground"
                            )}
                        >
                            {step.label}
                        </span>
                    </button>

                    {idx < SETUP_STEPS.length - 1 && (
                        <span aria-hidden className="mx-2 h-px w-6 bg-border sm:w-8" />
                    )}
                </li>
            );
        })}
    </ol>
);

export default SetupStepper;

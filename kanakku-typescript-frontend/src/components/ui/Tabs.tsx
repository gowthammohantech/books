import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export type TabsVariant = "underline" | "segmented";

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (key: string) => void;
  variant?: TabsVariant;
  className?: string;
  /**
   * Deterministic id prefix. When provided, each tab button gets
   * `id={`${id}-tab-${key}`}` and `aria-controls={`${id}-panel-${key}`}` so a
   * consumer can wire a matching `<div role="tabpanel" id={`${id}-panel-${key}`}>`.
   * Omit if you don't need panel wiring — ids are still unique (via useId)
   * but aria-controls is not emitted without a guaranteed matching panel.
   */
  id?: string;
  "aria-label"?: string;
}

/**
 * Accessible tab bar (role="tablist"/"tab", aria-selected, roving tabIndex +
 * arrow-key navigation) matching the app's token language. Two visual
 * variants: `underline` (default, brand-purple underline/text) and
 * `segmented` (pill group on a surface background).
 */
const Tabs = ({
  tabs,
  value,
  onChange,
  variant = "underline",
  className = "",
  id,
  ...rest
}: TabsProps) => {
  const autoId = useId();
  const baseId = id ?? autoId;
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = tabs.filter((tab) => !tab.disabled);
    if (enabled.length === 0) return;
    const currentIndex = enabled.findIndex((tab) => tab.key === value);

    let nextIndex: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1 + enabled.length) % enabled.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + enabled.length) % enabled.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = enabled.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const next = enabled[nextIndex];
    onChange(next.key);
    buttonRefs.current[next.key]?.focus();
  };

  const listClass =
    variant === "segmented"
      ? "inline-flex items-center gap-1 rounded-control bg-surface p-1"
      : "flex items-center gap-4 border-b border-border";

  return (
    <div
      role="tablist"
      aria-label={rest["aria-label"]}
      className={`${listClass} ${className}`}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.key === value;
        const tabId = `${baseId}-tab-${tab.key}`;
        const panelId = `${baseId}-panel-${tab.key}`;

        return (
          <button
            key={tab.key}
            ref={(el) => {
              buttonRefs.current[tab.key] = el;
            }}
            id={id ? tabId : undefined}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={id ? panelId : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.key)}
            className={
              variant === "segmented"
                ? [
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control",
                    "text-[13px] font-medium transition-colors",
                    "disabled:opacity-60 disabled:cursor-not-allowed",
                    selected
                      ? "bg-white text-purple-600 shadow-card"
                      : "text-body hover:text-heading",
                  ].join(" ")
                : [
                    "inline-flex items-center gap-1.5 px-0.5 pb-2.5 -mb-px",
                    "text-sm font-medium border-b-2 transition-colors",
                    "disabled:opacity-60 disabled:cursor-not-allowed",
                    selected
                      ? "border-purple-600 text-purple-600"
                      : "border-transparent text-body hover:text-heading",
                  ].join(" ")
            }
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

export default Tabs;

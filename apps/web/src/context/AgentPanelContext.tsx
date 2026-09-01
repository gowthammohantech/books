import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { useAiConfig } from "@hooks/useAiConfig";

/**
 * Open/closed state for the docked agent rail.
 *
 * The state used to live inside AiChatFab, which was both the trigger and the
 * owner. That worked while the only way in was a floating button sitting on top
 * of the page. It stops working once the trigger is a pill in the top bar and
 * the panel is a column in the layout: three components in different branches
 * of the tree now need the same boolean.
 *
 * `isAvailable` is the AI-disabled gate, kept in one place so the pill and the
 * panel cannot disagree about whether the feature exists.
 */
interface AgentPanelContextValue {
    isOpen: boolean;
    isAvailable: boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
}

const AgentPanelContext = createContext<AgentPanelContextValue | undefined>(undefined);

export const AgentPanelProvider = ({ children }: { children: ReactNode }) => {
    const { config } = useAiConfig();
    const [isOpen, setIsOpen] = useState(false);

    const isAvailable = Boolean(config?.enabled);

    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

    const value = useMemo(
        // Closed, not merely hidden, when AI is switched off: a panel that is
        // "open" behind a feature flag would reserve its 420px of layout width
        // and squash the page for nothing.
        () => ({ isOpen: isAvailable && isOpen, isAvailable, open, close, toggle }),
        [isAvailable, isOpen, open, close, toggle],
    );

    return <AgentPanelContext.Provider value={value}>{children}</AgentPanelContext.Provider>;
};

export const useAgentPanel = (): AgentPanelContextValue => {
    const context = useContext(AgentPanelContext);
    if (!context) {
        throw new Error("useAgentPanel must be used within AgentPanelProvider");
    }
    return context;
};

export default AgentPanelContext;

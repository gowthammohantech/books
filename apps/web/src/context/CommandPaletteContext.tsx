import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import CommandPalette from "@components/admin/CommandPalette";

interface CommandPaletteContextValue {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
    null
);

export const useCommandPalette = (): CommandPaletteContextValue => {
    const context = useContext(CommandPaletteContext);
    if (!context) {
        throw new Error(
            "useCommandPalette must be used inside <CommandPaletteProvider>"
        );
    }
    return context;
};

/** True for the platform's palette chord: Cmd+K on macOS, Ctrl+K elsewhere. */
const isPaletteChord = (event: KeyboardEvent) =>
    (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k";

/**
 * Owns the palette's open state and the global shortcut, and renders the
 * palette itself so no caller has to.
 *
 * Mounted in AdminLayout: the palette navigates to admin routes and reads the
 * permission set, neither of which exists on the login / setup screens.
 */
export const CommandPaletteProvider = ({ children }: { children: ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);

    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!isPaletteChord(event)) return;
            // A rich-text editor (or any descendant) that claims Ctrl+K for its
            // own binding wins — we only take the chord nobody else handled.
            if (event.defaultPrevented) return;
            // Chrome and Firefox focus the address bar on Ctrl+K, so the
            // default has to go regardless of whether we open or close.
            event.preventDefault();
            toggle();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [toggle]);

    const value = useMemo(
        () => ({ isOpen, open, close, toggle }),
        [isOpen, open, close, toggle]
    );

    return (
        <CommandPaletteContext.Provider value={value}>
            {children}
            <CommandPalette isOpen={isOpen} onClose={close} />
        </CommandPaletteContext.Provider>
    );
};

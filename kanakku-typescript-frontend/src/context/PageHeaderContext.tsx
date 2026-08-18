import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";

/**
 * PageHeaderContext — lets any admin page push a title + action buttons into the
 * global AdminHeader (top bar). The header reads `title`/`actions`; pages set
 * them via the <PageHeader> convenience component (which clears on unmount).
 *
 * Backward-compatible: when no page sets anything, both values are `null` and
 * AdminHeader renders exactly as before.
 */
interface PageHeaderState {
    title: ReactNode;
    actions: ReactNode;
}

interface PageHeaderContextValue extends PageHeaderState {
    setPageHeader: (state: PageHeaderState) => void;
    clearPageHeader: () => void;
}

const EMPTY: PageHeaderState = { title: null, actions: null };

const PageHeaderContext = createContext<PageHeaderContextValue | undefined>(
    undefined,
);

export const PageHeaderProvider = ({ children }: { children: ReactNode }) => {
    const [state, setState] = useState<PageHeaderState>(EMPTY);

    const setPageHeader = (next: PageHeaderState) => setState(next);
    const clearPageHeader = () => setState(EMPTY);

    return (
        <PageHeaderContext.Provider
            value={{ ...state, setPageHeader, clearPageHeader }}
        >
            {children}
        </PageHeaderContext.Provider>
    );
};

export const usePageHeader = (): PageHeaderContextValue => {
    const context = useContext(PageHeaderContext);
    if (!context) {
        throw new Error("usePageHeader must be used within PageHeaderProvider");
    }
    return context;
};

interface PageHeaderProps {
    /** Rendered on the left of the top bar, after the sidebar toggle. */
    title: ReactNode;
    /** Action buttons rendered on the right, before the global quick-add. */
    children?: ReactNode;
}

/**
 * Mount this inside a page to set the top-bar title + actions. It renders
 * nothing itself and clears the header when the page unmounts.
 */
export const PageHeader = ({ title, children }: PageHeaderProps) => {
    const { setPageHeader, clearPageHeader } = usePageHeader();

    useEffect(() => {
        setPageHeader({ title, actions: children });
        return () => clearPageHeader();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [title, children]);

    return null;
};

export default PageHeaderContext;

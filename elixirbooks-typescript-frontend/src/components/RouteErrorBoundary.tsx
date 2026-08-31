import { Component, type ErrorInfo, type ReactNode } from "react";

import { purgeTenantScoped } from "@utils/tenantStorage";

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
}

/**
 * The last line of defence around the router.
 *
 * A throw during the route tree's first render is the worst failure this app
 * has: React unmounts everything, the user gets a blank white page, and there
 * is no UI left to navigate away with. The historical cause is cached data —
 * a malformed value in Storage read at module or first-render time — which is
 * also why it survives a reload and why an ordinary user cannot clear it
 * without opening devtools.
 *
 * So the recovery offered here is exactly the one that fixes that cause:
 * discard the cached per-workspace data and reload. The session cookie is left
 * alone, because signing the user out to fix a cache problem loses their place
 * for no reason; the second button does that only if they ask for it.
 */
class RouteErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("Route render failed", error, info);
    }

    private handleClearAndReload = () => {
        purgeTenantScoped();
        window.location.assign("/");
    };

    render() {
        if (!this.state.error) return this.props.children;

        return (
            <div className="min-h-screen flex items-center justify-center p-6">
                <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center">
                    <h1 className="text-xl font-semibold text-foreground mb-2">
                        Something went wrong
                    </h1>
                    <p className="text-sm text-muted-foreground mb-6">
                        This page could not be displayed. Clearing the data cached for this
                        workspace usually fixes it — you will stay signed in.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <button
                            type="button"
                            onClick={this.handleClearAndReload}
                            className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 cursor-pointer"
                        >
                            Clear cached data and reload
                        </button>
                        <button
                            type="button"
                            onClick={() => window.location.assign("/admin/logout")}
                            className="px-5 py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-accent cursor-pointer"
                        >
                            Sign out
                        </button>
                    </div>
                    {import.meta.env.DEV && (
                        <pre className="mt-6 text-left text-xs text-destructive whitespace-pre-wrap">
                            {this.state.error.message}
                        </pre>
                    )}
                </div>
            </div>
        );
    }
}

export default RouteErrorBoundary;

import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Building2, Check, ChevronDown, Loader2Icon, Plus } from "lucide-react";
import { toast } from "sonner";

import type { AppDispatch, RootState } from "@store/index";
import { createTenant, switchTenant } from "@store/auth/authSlice";

/**
 * Workspace switcher.
 *
 * Shown to everyone signed in, not only to people who already belong to two
 * companies. The plan called for hiding it below two memberships, but that is a
 * dead end: creating a second workspace is an action IN this menu, so hiding
 * the menu for one-workspace users means they can never reach a second one. For
 * them it reads as a label for the company they are in, with one thing to do.
 *
 * The role shown under each name is per workspace — the same person can be an
 * Owner in one company and a Viewer in another — which is the whole reason a
 * membership, and not the user, is what carries a role now.
 *
 * Both actions end in a full page load, not a re-render. See the comment on the
 * `switchTenant` thunk for why that is the honest choice here rather than a
 * cache invalidation.
 */
const TenantSwitcher = () => {
    const dispatch: AppDispatch = useDispatch();
    const { activeTenant, memberships, isSwitchingTenant } = useSelector(
        (state: RootState) => state.auth
    );
    const [isOpen, setIsOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    // Close on an outside click. A dropdown that can only be dismissed by
    // choosing something traps the user into a switch they may not want.
    useEffect(() => {
        if (!isOpen) return;
        const onPointerDown = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setIsOpen(false);
                setIsCreating(false);
            }
        };
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [isOpen]);

    if (!activeTenant && memberships.length === 0) return null;

    const canSwitch = memberships.length > 1;

    const handleSwitch = async (tenantId: string) => {
        if (tenantId === activeTenant?.id) {
            setIsOpen(false);
            return;
        }
        const result = await dispatch(switchTenant(tenantId));
        if (switchTenant.rejected.match(result)) {
            toast.error((result.payload as string) || "Could not switch workspace.");
            return;
        }
        // Full reload: the new token is already in the cookie, so everything
        // that mounts after this point asks for the new workspace's data.
        window.location.assign("/");
    };

    const handleCreate = async () => {
        const name = newName.trim();
        if (name.length < 2) {
            toast.error("Enter a company name of at least 2 characters.");
            return;
        }
        const result = await dispatch(createTenant(name));
        if (createTenant.rejected.match(result)) {
            toast.error((result.payload as string) || "Could not create workspace.");
            return;
        }
        // A brand new workspace has no CompanySettings, so the route gate sends
        // it to /setup — landing on "/" is enough to get there.
        window.location.assign("/");
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                disabled={isSwitchingTenant}
                aria-label="Switch workspace"
                aria-haspopup="true"
                aria-expanded={isOpen}
                className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted cursor-pointer max-w-[220px] disabled:opacity-60 disabled:cursor-not-allowed"
            >
                {isSwitchingTenant ? (
                    <Loader2Icon className="w-4 h-4 animate-spin shrink-0" />
                ) : (
                    <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{activeTenant?.name ?? "Workspace"}</span>
                <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
            </button>

            {isOpen && (
                <div
                    className="absolute right-0 mt-2 w-72 bg-popover rounded-xl shadow-lg border border-border ring-1 ring-black/5 divide-y divide-border z-[999]"
                    role="menu"
                    aria-orientation="vertical"
                >
                    <div className="px-4 py-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {canSwitch ? "Your workspaces" : "Workspace"}
                        </p>
                    </div>

                    <div className="py-1 max-h-72 overflow-y-auto">
                        {memberships.map((membership) => {
                            const isActive = membership.tenantId === activeTenant?.id;
                            return (
                                <button
                                    key={membership.membershipId}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => handleSwitch(membership.tenantId)}
                                    disabled={isSwitchingTenant}
                                    className="w-full flex items-center justify-between gap-2 px-4 py-2 text-left text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground rounded-md mx-0 transition-colors cursor-pointer disabled:cursor-not-allowed"
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate">{membership.name}</span>
                                        {/* The role is per workspace — the same person can be
                                            an Owner in one company and a Viewer in another. */}
                                        <span className="block text-xs text-muted-foreground truncate">
                                            {membership.roleName ?? "No role"}
                                        </span>
                                    </span>
                                    {isActive && <Check className="w-4 h-4 shrink-0 text-primary" />}
                                </button>
                            );
                        })}
                    </div>

                    <div className="py-1">
                        {isCreating ? (
                            <div className="px-4 py-2 space-y-2">
                                <input
                                    autoFocus
                                    type="text"
                                    value={newName}
                                    maxLength={100}
                                    placeholder="Company name"
                                    onChange={(e) => setNewName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") void handleCreate();
                                        if (e.key === "Escape") setIsCreating(false);
                                    }}
                                    className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:ring-2 focus:ring-ring focus:outline-none"
                                />
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={handleCreate}
                                        disabled={isSwitchingTenant}
                                        className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 cursor-pointer disabled:opacity-60"
                                    >
                                        Create
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsCreating(false)}
                                        className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => setIsCreating(true)}
                                className="w-full flex items-center px-4 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                            >
                                <Plus className="w-4 h-4 mr-3 text-gray-400" />
                                Create new workspace
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TenantSwitcher;

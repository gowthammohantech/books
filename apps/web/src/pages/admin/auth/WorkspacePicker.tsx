import { useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2Icon, Plus } from "lucide-react";
import { toast } from "sonner";

import { createTenant, logout, switchTenant } from "@store/auth/authSlice";
import type { AppDispatch, RootState } from "@store/index";
import type { TenantSummary } from "@models/tenant";

/**
 * The workspace picker.
 *
 * Until now the only way to change workspace was a dropdown in the header, and
 * there was no screen at all — a deliberate call at the time (authController's
 * `session` notes that a PRE-auth picker would double the login flow for
 * everyone to serve the rare multi-membership case). This one is post-auth and
 * conditional: AdminLogin only routes here when a person actually holds more
 * than one membership, so the single-workspace path is untouched.
 *
 * --- What this screen does NOT show ---
 *
 * The design it is built from also shows a trial countdown, a seat allowance,
 * per-company branch and warehouse counts, and a pending-invitations panel.
 * None of those exist: there is no subscription, seat, Branch or Warehouse
 * model, and MembershipStatus.INVITED is declared but never written (users are
 * admin-provisioned with a password in userController.createStaffUser). Showing
 * a plausible number in any of those places would be inventing a fact about
 * someone's billing, so each is left out until it is real.
 *
 * `plan` is the exception: it is a real Tenant column, so it is labelled on
 * each card. It is only a label — nothing reads or enforces it — which is why
 * there is no upgrade action next to it.
 */

const initials = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase() ?? "")
        .join("") || "?";

/** "Chennai · 5 users", minus whichever half we do not have. */
const metaLine = (membership: TenantSummary) => {
    const users =
        typeof membership.memberCount === "number"
            ? `${membership.memberCount} ${membership.memberCount === 1 ? "user" : "users"}`
            : null;
    return [membership.city, users].filter(Boolean).join(" · ");
};

const WorkspacePicker = () => {
    const dispatch: AppDispatch = useDispatch();
    const navigate = useNavigate();
    const { user, activeTenant, memberships, isSwitchingTenant } = useSelector(
        (state: RootState) => state.auth,
    );

    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState("");

    const firstName = (user?.firstName as string | undefined)?.trim();

    // The design groups companies under a parent organisation. There is no
    // organisation above Tenant in this schema — one Tenant IS one company — so
    // the honest grouping is by the relationship the person has to each: the
    // ones they own, and the ones they were added to. Inventing a parent to
    // group by would put a name on screen that nothing can ever edit.
    const [owned, joined] = useMemo(() => {
        const own: TenantSummary[] = [];
        const rest: TenantSummary[] = [];
        for (const membership of memberships) {
            (membership.isOwner ? own : rest).push(membership);
        }
        return [own, rest];
    }, [memberships]);

    const enter = async (tenantId: string) => {
        if (tenantId === activeTenant?.id) {
            // Already scoped to this workspace — no need to spend a round trip
            // and a reload re-minting the token we are holding.
            window.location.assign("/");
            return;
        }
        const result = await dispatch(switchTenant(tenantId));
        if (switchTenant.rejected.match(result)) {
            toast.error((result.payload as string) || "Could not switch workspace.");
            return;
        }
        // Full reload, matching the switcher this screen replaces: the new token
        // is already in the cookie, so everything mounting after this asks for
        // the new workspace's data instead of re-filtering the old.
        window.location.assign("/");
    };

    const create = async () => {
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

    const renderCard = (membership: TenantSummary) => {
        const meta = metaLine(membership);
        return (
            <button
                key={membership.membershipId}
                type="button"
                onClick={() => enter(membership.tenantId)}
                disabled={isSwitchingTenant}
                className="group flex flex-col rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
            >
                <div className="flex items-start gap-3">
                    <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground"
                    >
                        {initials(membership.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                            <span className="truncate font-semibold text-card-foreground">
                                {membership.name}
                            </span>
                            {membership.plan && (
                                <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-accent-foreground">
                                    {membership.plan}
                                </span>
                            )}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-sm text-primary">
                            Enter workspace
                            <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                        </span>
                    </span>
                </div>

                {meta && <p className="mt-3 text-sm text-muted-foreground">{meta}</p>}

                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Your role
                    </span>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                        {membership.roleName ?? "No role"}
                    </span>
                </div>
            </button>
        );
    };

    const section = (title: string, note: string, rows: TenantSummary[]) =>
        rows.length > 0 && (
            <section className="mt-8">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                    <p className="text-sm text-muted-foreground">{note}</p>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {rows.map(renderCard)}
                </div>
            </section>
        );

    return (
        <div className="min-h-screen bg-background">
            <header className="flex items-center justify-between bg-primary px-6 py-3 text-primary-foreground">
                <span className="flex items-center gap-2.5">
                    <span
                        aria-hidden="true"
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-foreground text-primary text-[11px] font-bold"
                    >
                        EB
                    </span>
                    <span className="text-sm font-semibold">Elixir Book</span>
                </span>
                <button
                    type="button"
                    onClick={() => dispatch(logout())}
                    className="text-sm text-primary-foreground/80 hover:text-primary-foreground cursor-pointer"
                >
                    Sign out
                </button>
            </header>

            <main className="mx-auto max-w-5xl px-6 py-10">
                <h1 className="text-2xl font-bold text-foreground">
                    {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Pick a company to enter. Your role is shown on each — it is set per
                    company, so it can differ between them.
                </p>

                {memberships.length === 0 && (
                    <p className="mt-8 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
                        You are not a member of any workspace yet. Create one below to get
                        started.
                    </p>
                )}

                {section(
                    "Companies you own",
                    owned.length === 1 ? "You own this one" : `You own ${owned.length}`,
                    owned,
                )}
                {section(
                    "Companies you belong to",
                    "Added by someone else",
                    joined,
                )}

                <section className="mt-10 rounded-xl border border-border bg-card p-4">
                    {isCreating ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                                autoFocus
                                type="text"
                                value={newName}
                                maxLength={100}
                                placeholder="Company name"
                                aria-label="New company name"
                                onChange={(event) => setNewName(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") void create();
                                    if (event.key === "Escape") setIsCreating(false);
                                }}
                                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                            <button
                                type="button"
                                onClick={create}
                                disabled={isSwitchingTenant}
                                className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 cursor-pointer"
                            >
                                {isSwitchingTenant && <Loader2Icon size={15} className="animate-spin" />}
                                Create
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsCreating(false)}
                                className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent cursor-pointer"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setIsCreating(true)}
                            className="flex items-center gap-2 text-sm font-medium text-primary hover:underline cursor-pointer"
                        >
                            <Plus size={15} />
                            Create a new company
                        </button>
                    )}
                </section>

                {activeTenant && (
                    <p className="mt-6 text-sm text-muted-foreground">
                        <button
                            type="button"
                            onClick={() => navigate("/")}
                            className="text-primary hover:underline cursor-pointer"
                        >
                            Back to {activeTenant.name}
                        </button>
                    </p>
                )}
            </main>
        </div>
    );
};

export default WorkspacePicker;

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftRight, ChevronUp, LogOut, User } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";

import { logout } from "@store/auth/authSlice";
import { assetUrl } from "@utils/assetUrl";
import type { RootState } from "@store/index";

/**
 * Sidebar footer: who am I, where am I, and how do I leave.
 *
 * This used to be a read-only company logo + name. That answered "where am I"
 * and nothing else, while identity, profile and sign-out lived in an avatar
 * menu at the far end of the header — so "switch company" and "who am I signed
 * in as" sat at opposite corners of the screen despite being the same question.
 * They are one control now, pinned to the bottom of the rail.
 *
 * The workspace list is deliberately NOT nested in here. "Switch company" goes
 * to /workspaces, which shows every membership with the role held in each and
 * can carry things a dropdown cannot — the plan, the company meta line, and
 * creating a workspace. A menu inside a menu inside a rail was the alternative.
 */

const SETTINGS_LINKS = [
    { to: "/settings", label: "Global Setup" },
    // Localization: country, timezone, date and number formats. Not branch or
    // warehouse locations — those have no model yet (erp-roadmap.md §1.1).
    { to: "/settings/localization", label: "Location Settings" },
    { to: "/users", label: "Admin Settings" },
] as const;

interface BottomBarProps {
    isSidebarOpen: boolean;
}

const BottomBar: React.FC<BottomBarProps> = ({ isSidebarOpen }) => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const { user, activeTenant } = useSelector((state: RootState) => state.auth);

    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
    // The role is what people recognise themselves by in an ERP ("I'm the
    // accountant here"), and it is per workspace — the same person can be Owner
    // in one and Accountant in another. Name is the fallback, not the lead.
    const identity = activeTenant?.roleName || fullName || user?.email || "Signed in";
    const initial = (fullName || user?.email || "?").trim().charAt(0).toUpperCase();

    // A menu that can only be dismissed by choosing something traps the user
    // into a navigation they may not want.
    useEffect(() => {
        if (!isOpen) return;
        const onPointerDown = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setIsOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [isOpen]);

    const go = (to: string) => {
        setIsOpen(false);
        navigate(to);
    };

    return (
        <div ref={containerRef} className="relative border-t border-sidebar-border">
            {isOpen && (
                <div
                    role="menu"
                    aria-orientation="vertical"
                    // Opens UPWARD: it is pinned to the bottom of the viewport,
                    // so there is nowhere below it to go.
                    className="absolute bottom-full left-2 right-2 mb-2 rounded-xl border border-sidebar-border bg-sidebar shadow-lg z-50 overflow-hidden"
                >
                    <div className="px-3 py-3">
                        <p className="truncate text-sm font-semibold text-sidebar-foreground">
                            {identity}
                        </p>
                        <p className="truncate text-xs text-sidebar-foreground/60">
                            {activeTenant?.name || fullName || user?.email}
                        </p>
                    </div>

                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => go("/workspaces")}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-sidebar-primary hover:bg-sidebar-accent cursor-pointer"
                    >
                        <ArrowLeftRight size={15} />
                        Switch company
                    </button>

                    <p className="px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/60">
                        Settings
                    </p>
                    {SETTINGS_LINKS.map((link) => (
                        <Link
                            key={link.to}
                            to={link.to}
                            role="menuitem"
                            onClick={() => setIsOpen(false)}
                            className="block px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        >
                            {link.label}
                        </Link>
                    ))}

                    <div className="mt-1 border-t border-sidebar-border">
                        <Link
                            to="/settings/profile"
                            role="menuitem"
                            onClick={() => setIsOpen(false)}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        >
                            <User size={15} />
                            Profile
                        </Link>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => dispatch(logout())}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer"
                        >
                            <LogOut size={15} />
                            Sign out
                        </button>
                    </div>
                </div>
            )}

            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-label="Account, workspace and settings"
                title={!isSidebarOpen ? identity : undefined}
                className={`flex w-full items-center gap-2 px-3 py-3 hover:bg-sidebar-accent cursor-pointer ${isSidebarOpen ? "" : "justify-center"
                    }`}
            >
                {user?.profileImageUrl ? (
                    <img
                        src={assetUrl(user.profileImageUrl)}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                ) : (
                    <span
                        aria-hidden="true"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold"
                    >
                        {initial}
                    </span>
                )}
                {isSidebarOpen && (
                    <>
                        <span className="flex min-w-0 flex-1 flex-col text-left">
                            <span className="truncate text-sm font-medium leading-tight text-sidebar-foreground">
                                {identity}
                            </span>
                            <span className="truncate text-xs leading-tight text-sidebar-foreground/60">
                                Settings &amp; profile
                            </span>
                        </span>
                        <ChevronUp
                            size={15}
                            className={`shrink-0 text-sidebar-foreground/60 transition-transform ${isOpen ? "" : "rotate-180"
                                }`}
                        />
                    </>
                )}
            </button>
        </div>
    );
};

export default BottomBar;

import { LogOut, User, UserCircle, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import type { RootState } from '../../../store';
import { logout } from '../../../store/auth/authSlice';
import { assetUrl } from '@utils/assetUrl';
import { usePageHeader } from '../../../context/PageHeaderContext';
import { useCommandPalette } from '../../../context/CommandPaletteContext';
import TenantSwitcher from '../TenantSwitcher';

const AdminHeader = () => {
    const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
    const { user } = useSelector((state: RootState) => state.auth);
    // Page-supplied title + action buttons (null when no page sets them).
    const { title: pageTitle, actions: pageActions } = usePageHeader();
    const { open: openCommandPalette } = useCommandPalette();
    // The shortcut hint has to name the key the visitor's own keyboard uses, or
    // it reads as wrong on whichever platform it does not match.
    const [shortcutHint, setShortcutHint] = useState('Ctrl K');
    const dispatch = useDispatch();

    useEffect(() => {
        if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
            setShortcutHint('⌘ K');
        }
    }, []);

    const handleLogout = () => {
        dispatch(logout());
    }
    return (
        <header className="flex items-center justify-between px-4 py-1 bg-card shadow relative z-30">
            <div className="flex items-center min-w-0 gap-3">
                {pageTitle && (
                    <h1 className="text-lg md:text-xl font-semibold text-gray-800 truncate">
                        {pageTitle}
                    </h1>
                )}
            </div>

            <div className="flex items-center space-x-2">
                {/* Command palette trigger. A search-box shape rather than an icon
                    button: the shortcut is only discoverable if something on screen
                    advertises it, and this is where people look for search. */}
                <button
                    onClick={openCommandPalette}
                    aria-label="Search pages, invoices, contacts and items"
                    aria-keyshortcuts="Control+K Meta+K"
                    className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                >
                    <Search className="w-4 h-4" />
                    <span className="hidden lg:inline">Search…</span>
                    <kbd className="hidden lg:inline rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium">
                        {shortcutHint}
                    </kbd>
                </button>

                {/* Page-supplied action buttons, before the global quick-add. */}
                {pageActions && (
                    <div className="flex items-center gap-2">{pageActions}</div>
                )}

                {/* Which company am I looking at? Beside the avatar because the
                    two together are the answer to "who am I, and where" - and
                    on an install serving several companies that question has to
                    be answerable without navigating anywhere. */}
                <TenantSwitcher />

                <div className="relative">
                    <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="flex items-center space-x-2 focus:outline-none  rounded-full p-1 cursor-pointer"
                        aria-label="Account menu"
                        aria-expanded={isDropdownOpen}
                        aria-haspopup="true"
                    >
                        <div className={
                            user?.profileImageUrl ?
                                `w-10 h-10 border-2 border-primary text-white rounded-full flex items-center justify-center text-lg font-semibold`
                                : `w-10 h-10 bg-gradient-to-br from-primary to-chart-3 text-primary-foreground rounded-full flex items-center justify-center text-lg font-semibold`
                        }>
                            {user?.profileImageUrl ? (
                                <img
                                    src={assetUrl(user.profileImageUrl)}
                                    alt="User"
                                    className="w-8 h-8 rounded-full"
                                />
                            )
                                :
                                <UserCircle className="w-6 h-6" />
                            }
                        </div>
                    </button>

                    {isDropdownOpen && (
                        <div
                            className="absolute right-0 mt-2 w-56 bg-popover rounded-xl shadow-lg border border-border ring-1 ring-black/5 divide-y divide-border transform origin-top-right animate-fade-in-up z-[999]"
                            onMouseLeave={() => setIsDropdownOpen(false)}
                            role="menu"
                            aria-orientation="vertical"
                            aria-labelledby="user-menu-button"
                        >
                            <div className="px-4 py-3" role="none">
                                <p className="text-sm font-medium text-gray-950 truncate" role="none">
                                    {user?.firstName + " " + user?.lastName || "Guest User"}
                                </p>
                                <p className="text-sm text-gray-500 truncate" role="none">
                                    {user?.email || "guest@example.com"}
                                </p>
                            </div>
                            <div className="py-1" role="none">
                                <Link
                                    to="/settings/profile"
                                    className="flex items-center px-4 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground rounded-md mx-2 transition-colors duration-200"
                                    role="menuitem"
                                >
                                    <User className="w-4 h-4 mr-3 text-gray-400" />
                                    Profile
                                </Link>
                                <a href='#'
                                    onClick={handleLogout}
                                    className="flex items-center px-4 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground rounded-md mx-2 transition-colors duration-200 cursor-pointer"
                                    role="menuitem"
                                >
                                    <LogOut className="w-4 h-4 mr-3 text-gray-400" />
                                    Logout
                                </a>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
};

export default AdminHeader;
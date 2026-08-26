import { LogOut, User, Menu, UserCircle } from 'lucide-react';
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import type { RootState } from '../../../store';
import { logout } from '../../../store/auth/authSlice';
import { assetUrl } from '@utils/assetUrl';
import { usePageHeader } from '../../../context/PageHeaderContext';
interface HeaderProps {
    toggleSidebar: () => void;
    /** Drives the toggle button's accessible name and aria-expanded state. */
    isSidebarOpen?: boolean;
}

const AdminHeader = ({ toggleSidebar, isSidebarOpen = true }: HeaderProps) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
    const { user } = useSelector((state: RootState) => state.auth);
    // Page-supplied title + action buttons (null when no page sets them).
    const { title: pageTitle, actions: pageActions } = usePageHeader();
    const dispatch = useDispatch();
    const handleLogout = () => {
        dispatch(logout());
    }
    return (
        <header className="flex items-center justify-between px-4 py-1 bg-card shadow relative z-30">
            <div className="flex items-center min-w-0 gap-3">
                <button
                    onClick={toggleSidebar}
                    aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                    aria-expanded={isSidebarOpen}
                    className="text-gray-500 focus:outline-none cursor-pointer shrink-0"
                >
                    <Menu className="w-6 h-6" />
                </button>
                {pageTitle && (
                    <h1 className="text-lg md:text-xl font-semibold text-gray-800 truncate">
                        {pageTitle}
                    </h1>
                )}
            </div>

            <div className="flex items-center space-x-2">
                {/* Page-supplied action buttons, before the global quick-add. */}
                {pageActions && (
                    <div className="flex items-center gap-2">{pageActions}</div>
                )}

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
                                    to="/admin/settings/profile"
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
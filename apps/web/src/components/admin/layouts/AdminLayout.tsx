import Header from '../layouts/AdminHeader';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../Sidebar';
import AiChatFab from '../ai/AiChatFab';
import DemoBanner from '../DemoBanner';
import { PageHeaderProvider } from '../../../context/PageHeaderContext';
import { CommandPaletteProvider } from '../../../context/CommandPaletteContext';

interface AdminLayoutProps {
  children?: ReactNode;
}

const SIDEBAR_STORAGE_KEY = 'sidebar.open';

/**
 * Reads the stored sidebar preference, defaulting to open.
 *
 * Guarded rather than trusted: Safari private mode and "block all cookies"
 * make localStorage *throw* on access, and this runs during the admin layout's
 * first render — an unguarded read would take the whole layout down.
 */
const readStoredSidebarOpen = (): boolean => {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

const AdminLayout = ({ children }: AdminLayoutProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(readStoredSidebarOpen);
  const { pathname } = useLocation();
  const isSettingsPage = pathname.includes('/settings');
  const mainRef = useRef<HTMLElement>(null);

  // Scroll the main content area back to the top on every route change.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Only an explicit toggle is a preference worth remembering, so this is the
  // one place that writes. The resize handler below moves the in-memory state
  // without touching what the user chose.
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Private-mode / quota failures are not worth surfacing: the choice
        // just stays in memory for this session.
      }
      return next;
    });
  }, []);

  // On smaller screens the sidebar is forced closed — a viewport is not a
  // preference, so widening again restores whatever the user actually chose.
  useEffect(() => {
    const handleResize = () => {
      setIsSidebarOpen(
        window.innerWidth < 768 ? false : readStoredSidebarOpen()
      );
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <PageHeaderProvider>
      {/* Owns the Ctrl/Cmd+K palette and renders it, so the header trigger and
          any page can open it via useCommandPalette(). */}
      <CommandPaletteProvider>
        <div className="flex h-screen bg-background font-sans print:block print:h-auto">
          <div className="print:hidden">
            <Sidebar isOpen={isSidebarOpen} onToggle={toggleSidebar} />
          </div>
          <div className="flex-1 flex flex-col overflow-hidden print:overflow-visible">
            <div className="print:hidden">
              <Header />
            </div>
            <main ref={mainRef} className="flex-1 overflow-x-hidden overflow-y-auto p-4 print:overflow-visible">
              {isSettingsPage && <DemoBanner />}
              {children || <Outlet />}
            </main>
          </div>
          {/* Cluster H — slice H.3: floating co-pilot, only visible when AI is enabled */}
          <div className="print:hidden">
            <AiChatFab />
          </div>
        </div>
      </CommandPaletteProvider>
    </PageHeaderProvider>
  );
};

export default AdminLayout;
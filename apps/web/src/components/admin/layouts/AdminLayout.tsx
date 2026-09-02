import Header from '../layouts/AdminHeader';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../Sidebar';
import AgentDock from '../ai/AgentDock';
import { PageHeaderProvider } from '../../../context/PageHeaderContext';
import { CommandPaletteProvider } from '../../../context/CommandPaletteContext';
import { AgentPanelProvider } from '../../../context/AgentPanelContext';
import DrawerOutlet from '../../../routes/DrawerOutlet';

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
  const mainRef = useRef<HTMLElement>(null);

  // Scroll the main content area back to the top on every route change.
  //
  // A create drawer opening does NOT count as one: this reads the location the
  // primary route tree is rendered at (see AdminRoute), which stays on the list
  // while a drawer is over it. Scrolling the list to the top would lose the row
  // the user was working from.
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
        <AgentPanelProvider>
          <div className="density-compact flex h-dvh overflow-hidden bg-background font-sans print:block print:h-auto print:overflow-visible">
            <div className="print:hidden">
              <Sidebar isOpen={isSidebarOpen} onToggle={toggleSidebar} />
            </div>
            {/* min-h-0 is load-bearing: a flex child defaults to min-height:auto
                and refuses to shrink below its content, which silently defeats
                the overflow-y-auto on <main> below. overflow-hidden masks that
                today; it stops masking it once children carry flex heights. */}
            <div className="flex-1 flex flex-col overflow-hidden print:overflow-visible min-w-0 min-h-0">
              <div className="print:hidden">
                <Header />
              </div>
              <main ref={mainRef} className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto p-3 lg:p-4 print:overflow-visible">
                {/* Caps line length on wide monitors. Put here rather than in a
                    <PageContainer> every page opts into: with 160 route entries
                    that migration would be 70% done forever. */}
                <div className="mx-auto w-full max-w-(--content-max)">
                  {children || <Outlet />}
                </div>
              </main>
            </div>
            {/* Cluster H — slice H.3. A sibling column rather than an overlay:
                the agent is meant to be worked ALONGSIDE the page (read a
                number off the invoice list, ask about it), and a panel that
                covers what you are asking about defeats that. It renders
                nothing at all when AI is disabled, so the flex row is
                unchanged for those installs. */}
            <div className="print:hidden">
              <AgentDock />
            </div>

            {/* The create flows. Mounted here rather than beside the router so
                they sit inside the three providers above, like any other page.
                It renders nothing unless the URL is a create route. */}
            <DrawerOutlet shell="admin" />
          </div>
        </AgentPanelProvider>
      </CommandPaletteProvider>
    </PageHeaderProvider>
  );
};

export default AdminLayout;
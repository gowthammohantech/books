import Header from '../layouts/AdminHeader';
import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../Sidebar';
import AiChatFab from '../ai/AiChatFab';
import DemoBanner from '../DemoBanner';
import { PageHeaderProvider } from '../../../context/PageHeaderContext';

interface AdminLayoutProps {
  children?: ReactNode;
}

const AdminLayout = ({ children }: AdminLayoutProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const { pathname } = useLocation();
  const isSettingsPage = pathname.includes('/settings');
  const mainRef = useRef<HTMLElement>(null);

  // Scroll the main content area back to the top on every route change.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // On smaller screens, the sidebar should be closed by default.
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <PageHeaderProvider>
      <div className="flex h-screen bg-white font-sans print:block print:h-auto">
        <div className="print:hidden">
          <Sidebar isOpen={isSidebarOpen} />
        </div>
        <div className="flex-1 flex flex-col overflow-hidden print:overflow-visible">
          <div className="print:hidden">
            <Header toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
          </div>
          <main ref={mainRef} className="flex-1 overflow-x-hidden overflow-y-auto bg-white-50 p-4 print:overflow-visible">
            {isSettingsPage && <DemoBanner />}
            {children || <Outlet />}
          </main>
        </div>
        {/* Cluster H — slice H.3: floating co-pilot, only visible when AI is enabled */}
        <div className="print:hidden">
          <AiChatFab />
        </div>
      </div>
    </PageHeaderProvider>
  );
};

export default AdminLayout;
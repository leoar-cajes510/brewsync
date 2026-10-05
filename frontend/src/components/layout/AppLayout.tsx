import { Outlet } from 'react-router-dom';
import MainSidebar from './MainSidebar';
import TerminalSetupBanner from '../auth/TerminalSetupBanner';
import BrandingApplier from './BrandingApplier';
import LiveAlerts from './LiveAlerts';

// Authenticated shell: the single main sidebar pinned to the far left, content to its right.
export default function AppLayout() {
  return (
    <div className="app-shell">
      <BrandingApplier />
      <MainSidebar />
      <main className="app-main">
        <TerminalSetupBanner />
        <Outlet />
      </main>
      <LiveAlerts />
    </div>
  );
}

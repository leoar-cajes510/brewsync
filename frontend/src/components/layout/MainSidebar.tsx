import { can, useAuth } from '../../stores/authStore';
import { useTerms } from '../../stores/terminologySettingsStore';
import type { MeDto } from '../../types/api';
import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Coffee, History, Receipt, ClipboardList, Store, ShieldCheck, Settings } from 'lucide-react';
import UserTerminalPanel from './UserTerminalPanel';

interface SidebarLink {
  to: string;
  label: string;
  /** Same rule as the route's AdminGuard; hidden links are a UX choice, the server still enforces. */
  allowed?: (user: MeDto | null) => boolean;
  icon: LucideIcon;
}

const sections: { label: string; links: SidebarLink[] }[] = [
  {
    label: 'Operate',
    links: [
      { to: '/pos', label: 'POS', icon: Store },
      { to: '/orders', label: 'Orders', icon: ClipboardList },
      { to: '/receipts', label: 'Receipts', icon: Receipt },
      { to: '/history', label: 'History', icon: History },
    ],
  },
  {
    label: 'Manage',
    links: [
      { to: '/admin', label: 'Admin', icon: ShieldCheck, allowed: (u) => u?.role === 'admin' },
      { to: '/settings', label: 'Settings', icon: Settings, allowed: (u) => can(u, 'settings.view') },
    ],
  },
];

// Fixed to the far left edge of the viewport; rendered once by the app shell.
export default function MainSidebar() {
  const { user } = useAuth();
  const { terms } = useTerms();
  // Settings → Terminology display words (TRM-02); routes and system keys never change.
  const custom: Record<string, string> = { '/orders': terms('order'), '/receipts': terms('receipt') };
  const visible = sections
    .map((section) => ({ ...section, links: section.links.filter((l) => !l.allowed || l.allowed(user)) }))
    .filter((section) => section.links.length > 0);
  return (
    <aside className="main-sidebar" aria-label="Main navigation">
      <div className="main-sidebar__brand">
        <span className="main-sidebar__logo">
          <Coffee size={20} strokeWidth={2.2} />
        </span>
        <span className="main-sidebar__name">BrewSync</span>
      </div>

      <nav className="main-sidebar__nav">
        {visible.map((section) => (
          <div key={section.label} className="main-sidebar__section">
            <div className="main-sidebar__label">{section.label}</div>
            {section.links.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className="main-sidebar__link">
                <Icon size={20} strokeWidth={1.8} />
                <span>{custom[to] ?? label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <UserTerminalPanel />
    </aside>
  );
}

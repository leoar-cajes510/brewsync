import { NavLink } from 'react-router-dom';
import SearchBar from '../ui/SearchBar';

const links = [
  { to: '/settings', label: 'Overview', end: true },
  { to: '/settings/business', label: 'Business' },
  { to: '/settings/branding', label: 'Branding' },
  { to: '/settings/terminology', label: 'Terminology' },
  { to: '/settings/features', label: 'Features' },
  { to: '/settings/permissions', label: 'Permissions' },
  { to: '/settings/tax', label: 'Tax' },
  { to: '/settings/payments', label: 'Payments' },
  { to: '/settings/discounts', label: 'Discounts' },
  { to: '/settings/receipts', label: 'Receipts' },
  { to: '/settings/staffing', label: 'Staffing' },
  { to: '/settings/terminals', label: 'Terminals' },
  { to: '/settings/preferences', label: 'Preferences' },
  { to: '/settings/audit-log', label: 'Audit Log' },
  { to: '/settings/account', label: 'Account' },
];

export default function SettingsNavigation() {
  return (
    <div className="settings-nav">
      <nav className="section-tabs section-tabs--underline" aria-label="Settings sections">
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} end={link.end} className="section-tabs__link">
            {link.label}
          </NavLink>
        ))}
      </nav>
      <SearchBar placeholder="Search…" aria-label="Search settings" className="settings-nav__search" />
    </div>
  );
}

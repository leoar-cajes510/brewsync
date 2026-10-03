import { NavLink } from 'react-router-dom';
import { useFeatureSettings, type FeatureKey } from '../../stores/featureSettingsStore';
import { useTerms } from '../../stores/terminologySettingsStore';

const links: { to: string; label: string; end?: boolean; feature?: FeatureKey }[] = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/products', label: 'Products' },
  { to: '/admin/inventory', label: 'Inventory', feature: 'inventory' },
  { to: '/admin/choices', label: 'Choices' },
  { to: '/admin/ingredients', label: 'Ingredients', feature: 'ingredients' },
  { to: '/admin/expenses', label: 'Expenses', feature: 'expenses' },
  { to: '/admin/analytics', label: 'Analytics', feature: 'analytics' },
  { to: '/admin/staff', label: 'Staff' },
  { to: '/admin/archived-orders', label: 'Archived Orders' },
];

export default function AdminNavigation() {
  // Disabled features stay reachable; the tab is only marked "Off".
  const { flags } = useFeatureSettings();
  const { term, terms } = useTerms();
  const custom: Record<string, string> = { '/admin/products': terms('product'), '/admin/staff': term('staff') };
  return (
    <nav className="section-tabs section-tabs--pill" aria-label="Admin sections">
      {links.map((link) => {
        const off = link.feature !== undefined && !flags[link.feature];
        return (
          <NavLink key={link.to} to={link.to} end={link.end} className={`section-tabs__link ${off ? 'section-tabs__link--off' : ''}`} title={off ? `${link.label} is turned off in Settings → Features` : undefined}>
            {custom[link.to] ?? link.label}
            {off && <span className="section-tabs__off">Off</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}

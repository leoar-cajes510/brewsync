import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listSections } from '../../services/settingsService';
import { listDiscounts } from '../../services/productService';
import {
  BadgePercent,
  Building2,
  ChevronRight,
  CreditCard,
  Languages,
  Palette,
  Printer,
  Receipt,
  ShieldCheck,
  SlidersHorizontal,
  ToggleRight,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Badge, { type BadgeTone } from '../../components/ui/Badge';
import '../../components/settings/settingsOverview.css';

type SetupStatus = 'configured' | 'needs-setup' | 'updated';

const STATUS: Record<SetupStatus, { label: string; tone: BadgeTone }> = {
  configured: { label: 'Configured', tone: 'success' },
  'needs-setup': { label: 'Needs Setup', tone: 'warning' },
  updated: { label: 'Updated', tone: 'info' },
};

interface Category {
  path: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Subtle icon accent (the card itself stays neutral). */
  accent: string;
  /** Fallback for areas without a settings section (Permissions: role defaults; Account: your sign-in). */
  status: SetupStatus;
}

const CATEGORIES: Category[] = [
  { path: 'business', name: 'Business', description: 'Business identity, type, contact information, and currency.', icon: Building2, accent: 'brown', status: 'needs-setup' },
  { path: 'branding', name: 'Branding', description: 'Logo, colors, and visual brand identity.', icon: Palette, accent: 'violet', status: 'needs-setup' },
  { path: 'terminology', name: 'Terminology', description: 'Customize the words used throughout BrewSync.', icon: Languages, accent: 'teal', status: 'configured' },
  { path: 'features', name: 'Features', description: 'Enable or disable BrewSync features.', icon: ToggleRight, accent: 'amber', status: 'configured' },
  { path: 'permissions', name: 'Permissions', description: 'Configure role access and permissions.', icon: ShieldCheck, accent: 'red', status: 'configured' },
  { path: 'tax', name: 'Tax', description: 'Configure tax rules and rates.', icon: Receipt, accent: 'green', status: 'needs-setup' },
  { path: 'payments', name: 'Payments', description: 'Choose the payment methods you accept.', icon: CreditCard, accent: 'slate', status: 'needs-setup' },
  { path: 'discounts', name: 'Discounts', description: 'Configure discounts and eligibility.', icon: BadgePercent, accent: 'rose', status: 'needs-setup' },
  { path: 'receipts', name: 'Receipts', description: 'Customize receipt information and display.', icon: Printer, accent: 'brown', status: 'needs-setup' },
  { path: 'staffing', name: 'Staffing', description: 'Configure staffing and operational limits.', icon: Users, accent: 'blue', status: 'configured' },
  { path: 'preferences', name: 'Preferences', description: 'Interface and day-to-day operating preferences.', icon: SlidersHorizontal, accent: 'slate', status: 'configured' },
  { path: 'account', name: 'Account', description: 'Manage your profile, password, and security.', icon: UserCog, accent: 'amber', status: 'configured' },
];

// Settings category hub: one card per settings area, each linking to its page.
export default function SettingsOverviewPage() {
  const [configured, setConfigured] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    void Promise.all([listSections(), listDiscounts().catch(() => [])])
      .then(([sections, discounts]) => setConfigured({ ...Object.fromEntries(sections.map((s) => [s.section, s.configured])), discounts: discounts.length > 0 }))
      .catch(() => setConfigured({}));
  }, []);

  // Real status: a settings section saved on the server counts as configured.
  const statusOf = (c: Category): SetupStatus => (configured && c.path in configured ? (configured[c.path] ? 'configured' : 'needs-setup') : c.status);
  const categories = CATEGORIES.map((c) => ({ ...c, status: statusOf(c) }));
  const needsSetup = categories.filter((c) => c.status === 'needs-setup').length;

  return (
    <div className="settings-overview">
      <header className="settings-overview__head">
        <h2>Settings Categories</h2>
        <span>
          {categories.length} areas
          {needsSetup > 0 && (
            <>
              {' · '}
              <b>{needsSetup} need setup</b>
            </>
          )}
        </span>
      </header>

      <ul className="settings-cards">
        {categories.map(({ path, name, description, icon: Icon, accent, status }) => (
          <li key={path}>
            <Link to={`/settings/${path}`} className="settings-card" aria-label={`${name} settings — ${STATUS[status].label}`}>
              <div className="settings-card__top">
                <span className={`settings-card__icon settings-card__icon--${accent}`}>
                  <Icon size={18} />
                </span>
                <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
              </div>
              <strong className="settings-card__name">{name}</strong>
              <p className="settings-card__desc">{description}</p>
              <span className="settings-card__foot">
                <span>Settings → {name}</span>
                <ChevronRight size={15} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

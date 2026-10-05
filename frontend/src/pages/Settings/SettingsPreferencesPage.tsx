import { useCallback, useState, useEffect } from 'react';
import { Bell, Info, MonitorSmartphone, RefreshCw, RotateCcw, Save, ShieldCheck, ShoppingCart, Utensils, Volume2, type LucideIcon } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Tabs from '../../components/ui/Tabs';
import Toggle from '../../components/ui/Toggle';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { useFeatureSettings, type FeatureKey } from '../../stores/featureSettingsStore';
import {
  ORDER_TYPES,
  PREFERENCE_DEFAULTS,
  savePreferenceSettings,
  usePreferenceSettings,
  type OrderType,
  type PreferenceSettings,
  type PreferenceToggleKey,
} from '../../stores/preferenceSettingsStore';
import { errorMessage } from '../../services/api';
import '../../components/settings/settingsPreferences.css';

interface Row {
  key: PreferenceToggleKey;
  label: string;
  description: string;
  /** Related feature on Settings → Features; flagged when that feature is off. */
  feature?: FeatureKey;
  /** Only adjustable while this preference is on. */
  dependsOn?: PreferenceToggleKey;
  /** Saved, but nothing acts on it yet (sounds, alerts, live transport — Q-ARCH-3). */
  inactive?: boolean;
}

const GROUPS: { key: string; title: string; icon: LucideIcon; rows: Row[] }[] = [
  {
    key: 'interface',
    title: 'Interface & Sounds',
    icon: Volume2,
    rows: [
      { key: 'interfaceSounds', label: 'Interface Sounds', description: 'Play subtle sounds for supported interface interactions.', feature: 'soundEffects' },
      { key: 'paymentSound', label: 'Payment Success Sound', description: 'Play a chime when a payment is completed.', feature: 'soundEffects' },
      { key: 'notifications', label: 'Notifications', description: 'Show on-screen notifications for supported events.' },
    ],
  },
  {
    key: 'live',
    title: 'Live System Behavior',
    icon: RefreshCw,
    rows: [
      { key: 'liveUpdates', label: 'Live Updates', description: 'Refresh the Orders board every 15 s and POS stock every 30 s (also needs Live Updates in Features).', feature: 'liveUpdates' },
      { key: 'autoRefresh', label: 'Auto Refresh', description: 'Refresh supported screens automatically without reloading the page.' },
    ],
  },
  {
    key: 'notify',
    title: 'Notification Preferences',
    icon: Bell,
    rows: [
      { key: 'newOrderAlerts', label: 'New Order Alerts', description: 'Notify staff when a new order is placed.', dependsOn: 'notifications', feature: 'orderAlerts' },
      { key: 'orderWaitingAlerts', label: 'Order Waiting Alerts', description: 'Notify staff when an order passes the waiting threshold.', dependsOn: 'notifications', feature: 'orderAlerts' },
      { key: 'lowStockAlerts', label: 'Low Stock Alerts', description: 'Notify staff when stock reaches the low stock threshold.', dependsOn: 'notifications', feature: 'lowStockAlerts' },
      { key: 'paymentAlerts', label: 'Payment Alerts', description: 'Notify staff about completed or failed payments.', dependsOn: 'notifications' },
    ],
  },
  {
    key: 'pos',
    title: 'POS Behavior',
    icon: ShoppingCart,
    rows: [
      { key: 'confirmRemoveCartItem', label: 'Require Confirmation Before Removing Cart Item', description: 'Ask staff to confirm before an item is removed from the cart.' },
    ],
  },
];

const ALERT_KEYS: PreferenceToggleKey[] = ['newOrderAlerts', 'orderWaitingAlerts', 'lowStockAlerts', 'paymentAlerts'];
const same = (a: PreferenceSettings, b: PreferenceSettings) => (Object.keys(a) as (keyof PreferenceSettings)[]).every((k) => a[k] === b[k]);
const orderTypeLabel = (t: OrderType) => ORDER_TYPES.find((o) => o.value === t)!.label;

// Interface behavior and daily-operation defaults only. Nothing is persisted.
export default function SettingsPreferencesPage() {
  const { settings: saved, savedAt } = usePreferenceSettings();
  const { flags: features } = useFeatureSettings();
  const [form, setForm] = useState<PreferenceSettings>(saved);
  // Show the server copy once it loads (and after each save).
  useEffect(() => setForm(saved), [saved]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const set = (patch: Partial<PreferenceSettings>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = !same(form, saved);

  const save = async () => {
    try {
      await savePreferenceSettings(form);
      setFeedback('Preferences saved');
    } catch (e) {
      setFeedback(errorMessage(e));
    }
  };
  const reset = () => {
    setForm(PREFERENCE_DEFAULTS);
    setConfirmReset(false);
    setFeedback('Preferences reset to defaults — Save Changes to apply');
  };

  const row = (r: Row) => {
    const disabled = r.dependsOn ? !form[r.dependsOn] : false;
    const featureOff = r.feature && !features[r.feature];
    return (
      <li key={r.key} className={`pf-row ${disabled ? 'pf-row--disabled' : ''}`} data-pref={r.key}>
        <div>
          <span className="pf-row__label">
            {r.label}
            {r.inactive ? (
              <span className="pf-tag" title="This setting is saved, but BrewSync does not act on it yet.">
                Not active yet
              </span>
            ) : (
              featureOff && (
                <span className="pf-tag" title="This feature is turned off in Settings → Features">
                  Off in Features
                </span>
              )
            )}
          </span>
          <small>{disabled ? 'Turn on Notifications to change this.' : r.description}{r.inactive && ' Not active yet.'}</small>
        </div>
        <Toggle checked={form[r.key]} disabled={disabled} onChange={(v) => set({ [r.key]: v })} label={r.label} />
      </li>
    );
  };

  const sounds = [form.interfaceSounds && 'Interface', form.paymentSound && 'Payment'].filter(Boolean) as string[];
  const alertsOn = ALERT_KEYS.filter((k) => form[k]).length;
  const summary: { key: string; label: string; value: string; on: boolean }[] = [
    { key: 'sounds', label: 'Sounds', value: sounds.length ? `On (${sounds.join(' & ')})` : 'Off', on: sounds.length > 0 },
    { key: 'live', label: 'Live Updates', value: `${form.liveUpdates ? 'On' : 'Off'}${form.autoRefresh ? ' · Auto refresh on' : ''}`, on: form.liveUpdates || form.autoRefresh },
    { key: 'notifications', label: 'Notifications', value: form.notifications ? `On (${alertsOn} of ${ALERT_KEYS.length} alerts)` : 'Off', on: form.notifications },
    { key: 'orderType', label: 'Default Order Type', value: orderTypeLabel(form.defaultOrderType), on: true },
    {
      key: 'confirm',
      label: 'Confirmations',
      // Cancelling an order always asks for a reason (server rule); only cart-item removal is configurable.
      value: form.confirmRemoveCartItem ? 'Remove item' : 'None',
      on: form.confirmRemoveCartItem,
    },
  ];

  return (
    <div className="settings-preferences">
      <div className="pf-main">
        {GROUPS.slice(0, 2).map((g) => (
          <Group key={g.key} title={g.title} icon={g.icon}>
            {g.rows.map(row)}
          </Group>
        ))}

        <Group title="Order Preferences" icon={Utensils}>
          <li className="pf-row pf-row--stack" data-pref="defaultOrderType">
            <div>
              <span className="pf-row__label">Default Order Type</span>
              <small>Pre-selected on new orders. Staff can still change it during checkout.</small>
            </div>
            <Tabs items={ORDER_TYPES} value={form.defaultOrderType} onChange={(v) => set({ defaultOrderType: v as OrderType })} />
          </li>
          {row({ key: 'showOrderTypeAtCheckout', label: 'Show Order Type Selection During Checkout', description: 'Show the order type choice on the checkout screen.' })}
        </Group>

        {GROUPS.slice(2).map((g) => (
          <Group key={g.key} title={g.title} icon={g.icon}>
            {g.rows.map(row)}
          </Group>
        ))}

        <p className="pf-note">
          <Info size={14} /> Preferences control how BrewSync behaves for users during daily operation. Changing these settings does not modify business records.
        </p>
      </div>

      <aside className="pf-side">
        <section className="pf-card">
          <header className="pf-card__head">
            <h2>
              <MonitorSmartphone size={16} /> Current Preferences
            </h2>
            {dirty && <Badge tone="warning">Unsaved</Badge>}
          </header>
          <dl className="pf-summary">
            {summary.map((s) => (
              <div key={s.key} data-summary={s.key}>
                <dt>{s.label}</dt>
                <dd className={s.key === 'orderType' ? 'pf-pill pf-pill--dark' : `pf-pill ${s.on ? 'pf-pill--on' : ''}`}>{s.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="pf-card pf-card--info">
          <h3>
            <ShieldCheck size={15} /> Behavior only
          </h3>
          <p>These choices change how screens behave. Orders, products, and transactions are never changed by preferences.</p>
        </section>
      </aside>

      <footer className="pf-actions">
        <span className="pf-actions__state">
          {dirty ? 'You have unsaved changes.' : savedAt ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : 'Using the default preferences.'}
        </span>
        <div className="pf-actions__buttons">
          <Button icon={<RotateCcw size={15} />} disabled={same(form, PREFERENCE_DEFAULTS)} onClick={() => setConfirmReset(true)}>
            Reset to Defaults
          </Button>
          <Button disabled={!dirty} onClick={() => setForm(saved)}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Save size={15} />} disabled={!dirty} onClick={save}>
            Save Changes
          </Button>
        </div>
      </footer>

      <ConfirmDialog
        open={confirmReset}
        title="Reset preferences to defaults?"
        message="All preferences return to their default values. Nothing changes until you Save Changes."
        confirmLabel="Reset Preferences"
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

function Group({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="pf-card">
      <header className="pf-card__head">
        <h2>
          <Icon size={16} /> {title}
        </h2>
      </header>
      <ul className="pf-rows">{children}</ul>
    </section>
  );
}

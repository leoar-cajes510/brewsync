import { useCallback, useState, useEffect } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  Carrot,
  Info,
  Percent,
  RadioTower,
  RotateCcw,
  Save,
  ShieldCheck,
  Undo2,
  Volume2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Toggle from '../../components/ui/Toggle';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { FEATURES, FEATURE_DEFAULTS, saveFeatureSettings, useFeatureSettings, type FeatureFlags, type FeatureKey } from '../../stores/featureSettingsStore';
import { errorMessage } from '../../services/api';
import '../../components/settings/settingsFeatures.css';

const ICONS: Record<FeatureKey, LucideIcon> = {
  inventory: Boxes,
  analytics: BarChart3,
  expenses: Wallet,
  refunds: Undo2,
  discounts: Percent,
  ingredients: Carrot,
  lowStockAlerts: AlertTriangle,
  orderAlerts: Bell,
  liveUpdates: RadioTower,
  soundEffects: Volume2,
};

// Related features shown together in the summary.
const GROUPS: { label: string; keys: FeatureKey[] }[] = [
  { label: 'Inventory & Low Stock Alerts', keys: ['inventory', 'lowStockAlerts'] },
  { label: 'Analytics & Insights', keys: ['analytics'] },
  { label: 'Expenses', keys: ['expenses'] },
  { label: 'Refunds & Discounts', keys: ['refunds', 'discounts'] },
  { label: 'Ingredient Tracking', keys: ['ingredients'] },
  { label: 'Order Alerts & Sound Effects', keys: ['orderAlerts', 'soundEffects'] },
  { label: 'Live Updates', keys: ['liveUpdates'] },
];

const sameFlags = (a: FeatureFlags, b: FeatureFlags) => FEATURES.every(({ key }) => a[key] === b[key]);

// Which BrewSync features are available (the `features` settings section; the server gates
// feature endpoints). Turning a feature off never deletes data.
export default function SettingsFeaturesPage() {
  const { flags: saved, savedAt } = useFeatureSettings();
  const [form, setForm] = useState<FeatureFlags>(saved);
  // Show the server copy once it loads (and after each save).
  useEffect(() => setForm(saved), [saved]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const enabled = FEATURES.filter((f) => form[f.key]).length;
  const total = FEATURES.length;
  const dirty = !sameFlags(form, saved);

  const save = async () => {
    try {
      await saveFeatureSettings(form);
      setFeedback('Features saved');
    } catch (e) {
      setFeedback(errorMessage(e));
    }
  };

  const reset = () => {
    setForm(FEATURE_DEFAULTS);
    setConfirmReset(false);
    setFeedback('Features reset to defaults — Save Changes to apply');
  };

  const groupState = (keys: FeatureKey[]) => {
    const on = keys.filter((k) => form[k]).length;
    return on === keys.length ? 'on' : on === 0 ? 'off' : 'partial';
  };

  return (
    <div className="settings-features">
      <div className="ft-main">
        <p className="ft-note">
          <Info size={15} />
          <span>
            <strong>Disabling a feature changes what is available in BrewSync. Existing business data is preserved.</strong>
            Turning a feature back on shows its screens and records again.
          </span>
        </p>

        <ul className="ft-list" aria-label="Features">
          {FEATURES.map(({ key, name, description }) => {
            const Icon = ICONS[key];
            const on = form[key];
            return (
              <li key={key} className={`ft-row ${on ? '' : 'ft-row--off'}`} data-feature={key}>
                <span className="ft-row__icon">
                  <Icon size={18} />
                </span>
                <div className="ft-row__text">
                  <div className="ft-row__title">
                    <strong>{name}</strong>
                    <Badge tone={on ? 'success' : 'neutral'}>{on ? 'Enabled' : 'Disabled'}</Badge>
                  </div>
                  <p>{description}</p>
                </div>
                <Toggle checked={on} onChange={(v) => setForm((f) => ({ ...f, [key]: v }))} label={`${on ? 'Disable' : 'Enable'} ${name}`} />
              </li>
            );
          })}
        </ul>
      </div>

      <aside className="ft-side">
        <section className="ft-card">
          <header className="ft-card__head">
            <h2>Feature Status Summary</h2>
            {dirty && <Badge tone="warning">Unsaved</Badge>}
          </header>
          <div className="ft-stats" aria-label="Feature counts">
            <div className="ft-stat" data-stat="total">
              <strong>{total}</strong>
              <span>Features</span>
            </div>
            <div className="ft-stat ft-stat--on" data-stat="enabled">
              <strong>{enabled}</strong>
              <span>Enabled</span>
            </div>
            <div className="ft-stat ft-stat--off" data-stat="disabled">
              <strong>{total - enabled}</strong>
              <span>Disabled</span>
            </div>
          </div>
          <div className="ft-meter">
            <div className="ft-meter__label">
              <span>Features enabled</span>
              <strong>{Math.round((enabled / total) * 100)}%</strong>
            </div>
            <div className="ft-meter__track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={enabled}>
              <span style={{ width: `${(enabled / total) * 100}%` }} />
            </div>
          </div>
          <div className="ft-groups">
            <h3>Feature Areas</h3>
            <ul>
              {GROUPS.map((g) => {
                const s = groupState(g.keys);
                return (
                  <li key={g.label} className={`ft-group ft-group--${s}`}>
                    <span className="ft-group__dot" />
                    <span>{g.label}</span>
                    <em>{s === 'on' ? 'On' : s === 'off' ? 'Off' : 'Partly on'}</em>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="ft-card ft-card--info">
          <h3>
            <ShieldCheck size={15} /> Your data stays safe
          </h3>
          <p>Turning off a feature such as Inventory or Expenses only hides it from use. Records already entered are kept and return when the feature is turned back on.</p>
        </section>
      </aside>

      <footer className="ft-actions">
        <span className="ft-actions__state">
          {dirty ? 'You have unsaved changes.' : savedAt ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : 'Using the default feature configuration.'}
        </span>
        <div className="ft-actions__buttons">
          <Button icon={<RotateCcw size={15} />} disabled={sameFlags(form, FEATURE_DEFAULTS)} onClick={() => setConfirmReset(true)}>
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
        title="Reset features to defaults?"
        message="Every feature returns to its default on/off setting. No data is removed. Nothing changes until you Save Changes."
        confirmLabel="Reset Features"
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

import { useCallback, useState, useEffect } from 'react';
import { AlertTriangle, BellRing, Info, Minus, MonitorSmartphone, Plus, RotateCcw, Save, Users } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { STAFFING_DEFAULTS, STAFFING_LIMITS, saveStaffingSettings, useStaffingSettings, type StaffingKey, type StaffingSettings } from '../../stores/staffingSettingsStore';
import { errorMessage } from '../../services/api';
import '../../components/settings/settingsStaffing.css';

type Texts = Record<StaffingKey, string>;

const FIELDS: Record<StaffingKey, { label: string; description: string }> = {
  maxAdmins: { label: 'Maximum Administrators', description: 'How many accounts can have the Admin role, with access to management areas and Settings.' },
  maxStaff: { label: 'Maximum Staff Accounts', description: 'How many cashier and team member logins can exist for your business.' },
  maxTerminals: { label: 'Maximum Active Terminals', description: 'Set the maximum number of terminals that can actively operate BrewSync.' },
  lowStockThreshold: { label: 'Low Stock Threshold', description: 'Starting low-stock threshold for new products and ingredients. Each item keeps its own threshold, which you can change in Inventory.' },
  orderWaitingMinutes: { label: 'Order Waiting Threshold', description: 'Orders waiting longer than this are highlighted so staff can follow up.' },
};

// Current usage. BrewSync starts fresh: there are no saved staff accounts or
// registered terminals yet, so these stay at zero until real data exists.
const CURRENT = { admins: 0, staff: 0, terminals: 0 };

const toTexts = (s: StaffingSettings) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])) as Texts;

function check(key: StaffingKey, text: string): string | null {
  const { min, max } = STAFFING_LIMITS[key];
  if (text.trim() === '') return 'Enter a number.';
  if (!/^\d+$/.test(text.trim())) return 'Use a whole number (no decimals or negatives).';
  const n = Number(text);
  if (n < min || n > max) return `Enter a number from ${min} to ${max}.`;
  return null;
}

// Capacity limits and operational thresholds only. Staff accounts are managed
// in Admin → Staff. Nothing is persisted.
export default function SettingsStaffingPage() {
  const { settings: saved, savedAt } = useStaffingSettings();
  const [texts, setTexts] = useState<Texts>(() => toTexts(saved));
  // Show the server copy once it loads (and after each save).
  useEffect(() => setTexts(toTexts(saved)), [saved]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const keys = Object.keys(FIELDS) as StaffingKey[];
  const errors = Object.fromEntries(keys.map((k) => [k, check(k, texts[k])])) as Record<StaffingKey, string | null>;
  const valid = keys.every((k) => !errors[k]);
  const dirty = keys.some((k) => texts[k].trim() !== String(saved[k]));
  const isDefault = keys.every((k) => texts[k].trim() === String(STAFFING_DEFAULTS[k]));
  // Last valid value per field, for the summary.
  const value = (k: StaffingKey) => (errors[k] ? saved[k] : Number(texts[k]));

  const set = (k: StaffingKey, text: string) => setTexts((t) => ({ ...t, [k]: text }));
  const step = (k: StaffingKey, delta: number) => {
    const { min, max } = STAFFING_LIMITS[k];
    const base = errors[k] ? saved[k] : Number(texts[k]);
    set(k, String(Math.min(max, Math.max(min, base + delta))));
  };

  const save = async () => {
    if (!valid) {
      setFeedback('Fix the highlighted values before saving');
      return;
    }
    try {
      await saveStaffingSettings(Object.fromEntries(keys.map((k) => [k, Number(texts[k])])) as StaffingSettings);
      setFeedback('Staffing settings saved');
    } catch (e) {
      setFeedback(errorMessage(e));
    }
  };

  const reset = () => {
    setTexts(toTexts(STAFFING_DEFAULTS));
    setConfirmReset(false);
    setFeedback('Staffing settings reset to defaults — Save Changes to apply');
  };

  const field = (k: StaffingKey) => {
    const { min, max, unit } = STAFFING_LIMITS[k];
    const err = errors[k];
    const current = Number(texts[k]);
    return (
      <div key={k} className="sf-field" data-field={k}>
        <div className="sf-field__text">
          <label htmlFor={`sf-${k}`}>{FIELDS[k].label}</label>
          <p>{FIELDS[k].description}</p>
          {err ? (
            <span className="field__error">{err}</span>
          ) : (
            <span className="sf-range">
              Allowed {min}–{max.toLocaleString()}
              {unit ? ` ${unit}` : ''}
            </span>
          )}
        </div>
        <div className="sf-stepper">
          <button type="button" aria-label={`Decrease ${FIELDS[k].label}`} disabled={!err && current <= min} onClick={() => step(k, -1)}>
            <Minus size={15} />
          </button>
          <input
            id={`sf-${k}`}
            className={`input ${err ? 'input--error' : ''}`}
            inputMode="numeric"
            value={texts[k]}
            aria-invalid={!!err}
            onChange={(e) => set(k, e.target.value)}
          />
          <button type="button" aria-label={`Increase ${FIELDS[k].label}`} disabled={!err && current >= max} onClick={() => step(k, 1)}>
            <Plus size={15} />
          </button>
          {unit && <span className="sf-unit">{unit}</span>}
        </div>
      </div>
    );
  };

  const usage = [
    { key: 'admins', label: 'Administrators', used: CURRENT.admins, limit: value('maxAdmins'), note: 'Admin accounts are added in Admin → Staff.' },
    { key: 'staff', label: 'Staff Accounts', used: CURRENT.staff, limit: value('maxStaff'), note: 'Staff accounts are added in Admin → Staff.' },
    { key: 'terminals', label: 'Active Terminals', used: CURRENT.terminals, limit: value('maxTerminals'), note: 'No terminals are connected yet.' },
  ];

  return (
    <div className="settings-staffing">
      <div className="sf-main">
        <section className="sf-card">
          <header className="sf-card__head">
            <span className="sf-card__icon">
              <Users size={17} />
            </span>
            <div>
              <h2>Staff Capacity</h2>
              <p>Limits on how many administrator and staff accounts your business can have.</p>
            </div>
          </header>
          {field('maxAdmins')}
          {field('maxStaff')}
        </section>

        <section className="sf-card">
          <header className="sf-card__head">
            <span className="sf-card__icon">
              <MonitorSmartphone size={17} />
            </span>
            <div>
              <h2>Terminal Capacity</h2>
              <p>How many registers and devices can run BrewSync at once.</p>
            </div>
          </header>
          {field('maxTerminals')}
        </section>

        <section className="sf-card">
          <header className="sf-card__head">
            <span className="sf-card__icon">
              <BellRing size={17} />
            </span>
            <div>
              <h2>Operational Thresholds</h2>
              <p>When BrewSync should flag low stock and orders that have waited too long.</p>
            </div>
          </header>
          {field('lowStockThreshold')}
          {field('orderWaitingMinutes')}
        </section>

        <p className="sf-note">
          <Info size={14} /> Staffing settings control account and terminal capacity and selected operational thresholds. Changing these values does not delete existing accounts or business data.
        </p>
      </div>

      <aside className="sf-side">
        <section className="sf-card">
          <header className="sf-card__head sf-card__head--summary">
            <div>
              <h2>Staffing Summary</h2>
              <p>Current usage against your configured limits.</p>
            </div>
            {dirty && <Badge tone="warning">Unsaved</Badge>}
          </header>
          <div className="sf-usage">
            {usage.map((u) => {
              const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
              return (
                <div key={u.key} className="sf-usage__item" data-usage={u.key}>
                  <div className="sf-usage__top">
                    <strong>{u.label}</strong>
                    <span>
                      <b>
                        {u.used} / {u.limit}
                      </b>{' '}
                      ({pct}%)
                    </span>
                  </div>
                  <div className="sf-bar" role="progressbar" aria-label={`${u.label} used`} aria-valuemin={0} aria-valuemax={u.limit} aria-valuenow={u.used}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <div className="sf-usage__foot">
                    <span>{u.note}</span>
                    <span>{u.limit - u.used} available</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="sf-thresholds">
            <h3>Thresholds</h3>
            <div data-summary="lowStock">
              <span>Low stock at or below</span>
              <b>{value('lowStockThreshold').toLocaleString()} units</b>
            </div>
            <div data-summary="waiting">
              <span>Flag orders waiting over</span>
              <b>{value('orderWaitingMinutes')} minutes</b>
            </div>
          </div>
          {!valid && (
            <p className="sf-summary__warn">
              <AlertTriangle size={13} /> Some values are invalid; the summary shows the last saved value for those fields.
            </p>
          )}
        </section>
      </aside>

      <footer className="sf-actions">
        <span className="sf-actions__state">
          {dirty ? 'You have unsaved changes.' : savedAt ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : 'Using the default staffing settings.'}
        </span>
        <div className="sf-actions__buttons">
          <Button icon={<RotateCcw size={15} />} disabled={isDefault} onClick={() => setConfirmReset(true)}>
            Reset to Defaults
          </Button>
          <Button disabled={!dirty} onClick={() => setTexts(toTexts(saved))}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Save size={15} />} disabled={!dirty} onClick={save}>
            Save Changes
          </Button>
        </div>
      </footer>

      <ConfirmDialog
        open={confirmReset}
        title="Reset staffing settings to defaults?"
        message="Capacity limits and thresholds return to their default values. No accounts or data are removed. Nothing changes until you Save Changes."
        confirmLabel="Reset Staffing"
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

import { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Toggle from '../ui/Toggle';
import { completeSetup } from '../../services/authService';
import { activateTerminal } from '../../services/terminalService';
import { deviceStore, errorMessage } from '../../services/api';
import { setupCompleted } from '../../stores/authStore';

// First-run setup wizard (API §1.7, Q-AUTH-1). Every business value is entered by the
// owner — no defaults are assumed for OPEN decisions (idle timeout Q-SET-4, credential
// policy Q-AUTH-7, cash rounding Q-PAY-2, staffing limits, feature flags).

const IDLE_OPTIONS = [5, 10, 15, 30, 60];
const FEATURES: { key: string; label: string }[] = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'ingredients', label: 'Ingredient Tracking' },
  { key: 'discounts', label: 'Discounts' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'lowStockAlerts', label: 'Low-Stock Alerts' },
  { key: 'orderAlerts', label: 'Order Alerts' },
  { key: 'liveUpdates', label: 'Live Updates' },
  { key: 'soundEffects', label: 'Sound Effects' },
];
const METHODS: { key: string; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'gcash', label: 'GCash' },
  { key: 'card', label: 'Card' },
  { key: 'bank_transfer', label: 'Bank Transfer' },
];

interface State {
  setupToken: string;
  businessName: string;
  businessType: string;
  currency: string;
  timezone: string;
  address: string;
  phone: string;
  email: string;
  adminName: string;
  username: string;
  password: string;
  confirm: string;
  idle: string;
  minPassword: string;
  pinLength: string;
  maxAttempts: string;
  lockoutMinutes: string;
  maxAdmins: string;
  maxStaff: string;
  maxTerminals: string;
  lowStock: string;
  orderWaiting: string;
  autoArchiveHours: string;
  restoreWindowHours: string;
  features: Record<string, boolean>;
  methods: Record<string, boolean>;
  requireCashReceived: boolean;
  requireReference: Record<string, boolean>;
  cashRounding: boolean;
}

const initial: State = {
  setupToken: '', businessName: '', businessType: '', currency: '', timezone: '', address: '', phone: '', email: '',
  adminName: '', username: '', password: '', confirm: '',
  idle: '', minPassword: '', pinLength: '', maxAttempts: '', lockoutMinutes: '',
  maxAdmins: '', maxStaff: '', maxTerminals: '', lowStock: '', orderWaiting: '', autoArchiveHours: '', restoreWindowHours: '',
  features: Object.fromEntries(FEATURES.map((f) => [f.key, false])),
  methods: Object.fromEntries(METHODS.map((m) => [m.key, false])),
  requireCashReceived: false,
  requireReference: { gcash: false, card: false, bank_transfer: false },
  cashRounding: false,
};

const STEPS = ['Business', 'Admin Account', 'Security', 'Operations', 'Payments & Features'] as const;

const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);

function stepErrors(step: number, s: State): Record<string, string> {
  const e: Record<string, string> = {};
  const need = (key: keyof State, label: string) => {
    if (!String(s[key]).trim()) e[key] = `${label} is required.`;
  };
  const whole = (key: keyof State, label: string, min = 0) => {
    const n = int(String(s[key]));
    if (!Number.isInteger(n) || n < min) e[key] = `${label} must be a whole number${min ? ` ≥ ${min}` : ''}.`;
  };
  if (step === 0) {
    need('setupToken', 'Setup token');
    need('businessName', 'Business name');
    need('businessType', 'Business type');
    need('currency', 'Currency code');
    need('timezone', 'Timezone');
  } else if (step === 1) {
    need('adminName', 'Full name');
    if (!/^[a-z0-9._-]{3,20}$/i.test(s.username.trim())) e.username = 'Use 3–20 letters, numbers, dots, dashes or underscores.';
    if (!s.password) e.password = 'Password is required.';
    else if (s.password !== s.confirm) e.confirm = 'Passwords do not match.';
    const min = int(s.minPassword);
    if (Number.isInteger(min) && s.password && s.password.length < min) e.password = `Use at least ${min} characters (Security step).`;
  } else if (step === 2) {
    if (!s.idle) e.idle = 'Choose an idle timeout.';
    whole('minPassword', 'Minimum password length', 1);
    whole('pinLength', 'PIN length', 1);
    whole('maxAttempts', 'Max failed attempts', 1);
    whole('lockoutMinutes', 'Lockout minutes', 1);
  } else if (step === 3) {
    whole('maxAdmins', 'Max admins', 1);
    whole('maxStaff', 'Max staff', 1);
    whole('maxTerminals', 'Max terminals', 1);
    whole('lowStock', 'Low-stock threshold');
    whole('orderWaiting', 'Order waiting minutes', 1);
    whole('autoArchiveHours', 'Auto-archive after (hours)', 1);
    whole('restoreWindowHours', 'Restore window (hours)', 1);
  } else if (step === 4) {
    if (!Object.values(s.methods).some(Boolean)) e.methods = 'Enable at least one payment method.';
  }
  return e;
}

export default function SetupWizard() {
  const [s, setS] = useState<State>(initial);
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof State>(key: K, value: State[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const errors = stepErrors(step, s);
  const show = (key: string) => (touched ? errors[key] : undefined);

  const next = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    setTouched(false);
    setStep((x) => x + 1);
  };

  const submit = async () => {
    setTouched(true);
    // Re-check every step before sending.
    for (let i = 0; i < STEPS.length; i++) {
      if (Object.keys(stepErrors(i, s)).length) {
        setStep(i);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const done = await completeSetup({
        business: {
          name: s.businessName.trim(), business_type: s.businessType.trim(), currency_code: s.currency.trim().toUpperCase(),
          timezone: s.timezone.trim(), address: s.address.trim(), phone: s.phone.trim(), email: s.email.trim(),
        },
        admin: { full_name: s.adminName.trim(), username: s.username.trim().toLowerCase(), password: s.password },
        security: {
          idle_timeout_minutes: Number(s.idle),
          credential_policy: {
            min_password_length: int(s.minPassword), pin_length: int(s.pinLength),
            max_failed_attempts: int(s.maxAttempts), lockout_minutes: int(s.lockoutMinutes),
          },
        },
        settings: {
          features: s.features,
          staffing: {
            max_admins: int(s.maxAdmins), max_staff: int(s.maxStaff), max_terminals: int(s.maxTerminals),
            low_stock_threshold: int(s.lowStock), order_waiting_minutes: int(s.orderWaiting),
          },
          payments: {
            enabled_methods: METHODS.filter((m) => s.methods[m.key]).map((m) => m.key),
            options: {
              cash: { require_cash_received: s.requireCashReceived },
              gcash: { require_reference: s.requireReference.gcash },
              card: { require_reference: s.requireReference.card },
              bank_transfer: { require_reference: s.requireReference.bank_transfer },
            },
            cash_rounding: { enabled: s.cashRounding },
          },
          archiving: { auto_archive_after_hours: int(s.autoArchiveHours), restore_window_hours: int(s.restoreWindowHours) },
        },
      }, s.setupToken.trim());
      // Q-TRM-8 (option c): activate THIS device as the first terminal with the one-time code, so the
      // Admin can sign in normally (terminal required) without any bypass.
      const first = done.first_terminal;
      try {
        const activated = await activateTerminal(first.code, first.activation_code);
        deviceStore.set(activated.device_credential);
        setupCompleted(`Setup complete. This device is terminal ${first.code}. Sign in with the Admin account you just created.`);
      } catch {
        setupCompleted(
          `Setup complete. Activate this device as terminal ${first.code} with code ${first.activation_code} (valid until ${new Date(first.activation_expires_at).toLocaleTimeString()}), then sign in.`,
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const last = step === STEPS.length - 1;

  return (
    <div className="auth-card auth-card--wide">
      <header className="auth-card__header">
        <h1>Set up BrewSync</h1>
        <p>First-time setup for this business. You can change most of this later in Settings.</p>
      </header>

      <ol className="auth-steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'auth-steps__item auth-steps__item--active' : i < step ? 'auth-steps__item auth-steps__item--done' : 'auth-steps__item'}>
            {i < step ? <CheckCircle2 size={14} /> : <span>{i + 1}</span>} {label}
          </li>
        ))}
      </ol>

      <div className="auth-grid">
        {step === 0 && (
          <>
            <Input
              className="auth-grid__wide"
              label="Setup Token"
              type="password"
              autoComplete="off"
              hint="Provided by whoever installed BrewSync (server setting SETUP_TOKEN). It protects this page from being used by anyone else."
              value={s.setupToken}
              error={show('setupToken')}
              onChange={(e) => set('setupToken', e.target.value)}
              autoFocus
            />
            <Input className="auth-grid__wide" label="Business Name" value={s.businessName} error={show('businessName')} onChange={(e) => set('businessName', e.target.value)} />
            <Input label="Business Type" placeholder="e.g. Café" value={s.businessType} error={show('businessType')} onChange={(e) => set('businessType', e.target.value)} />
            <Input label="Currency Code" placeholder="e.g. PHP" value={s.currency} error={show('currency')} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
            <Input label="Timezone" placeholder="e.g. Asia/Manila" value={s.timezone} error={show('timezone')} onChange={(e) => set('timezone', e.target.value)} />
            <Input label="Phone (optional)" value={s.phone} onChange={(e) => set('phone', e.target.value)} />
            <Input className="auth-grid__wide" label="Address (optional)" value={s.address} onChange={(e) => set('address', e.target.value)} />
            <Input label="Email (optional)" type="email" value={s.email} onChange={(e) => set('email', e.target.value)} />
          </>
        )}

        {step === 1 && (
          <>
            <Input className="auth-grid__wide" label="Full Name" value={s.adminName} error={show('adminName')} onChange={(e) => set('adminName', e.target.value)} autoFocus />
            <Input label="Username" autoComplete="username" value={s.username} error={show('username')} onChange={(e) => set('username', e.target.value)} />
            <span />
            <Input label="Password" type="password" autoComplete="new-password" value={s.password} error={show('password')} onChange={(e) => set('password', e.target.value)} />
            <Input label="Confirm Password" type="password" autoComplete="new-password" value={s.confirm} error={show('confirm')} onChange={(e) => set('confirm', e.target.value)} />
            <p className="auth-grid__wide auth-hint">The first Admin signs in with a password. No default password exists.</p>
          </>
        )}

        {step === 2 && (
          <>
            <Select
              label="Idle Timeout"
              placeholder="Choose…"
              value={s.idle}
              onChange={(e) => set('idle', e.target.value)}
              options={IDLE_OPTIONS.map((m) => ({ value: String(m), label: `${m} minutes` }))}
            />
            {show('idle') ? <span className="field__error auth-grid__inline-error">{show('idle')}</span> : <span />}
            <Input label="Minimum Password Length" inputMode="numeric" value={s.minPassword} error={show('minPassword')} onChange={(e) => set('minPassword', e.target.value)} />
            <Input label="PIN Length" inputMode="numeric" value={s.pinLength} error={show('pinLength')} onChange={(e) => set('pinLength', e.target.value)} />
            <Input label="Max Failed Sign-in Attempts" inputMode="numeric" value={s.maxAttempts} error={show('maxAttempts')} onChange={(e) => set('maxAttempts', e.target.value)} />
            <Input label="Lockout Duration (minutes)" inputMode="numeric" value={s.lockoutMinutes} error={show('lockoutMinutes')} onChange={(e) => set('lockoutMinutes', e.target.value)} />
          </>
        )}

        {step === 3 && (
          <>
            <Input label="Max Admin Accounts" inputMode="numeric" value={s.maxAdmins} error={show('maxAdmins')} onChange={(e) => set('maxAdmins', e.target.value)} />
            <Input label="Max Staff Accounts" inputMode="numeric" value={s.maxStaff} error={show('maxStaff')} onChange={(e) => set('maxStaff', e.target.value)} />
            <Input label="Max Active Terminals" inputMode="numeric" value={s.maxTerminals} error={show('maxTerminals')} onChange={(e) => set('maxTerminals', e.target.value)} />
            <Input label="Default Low-Stock Threshold" inputMode="numeric" value={s.lowStock} error={show('lowStock')} onChange={(e) => set('lowStock', e.target.value)} />
            <Input label="Order Waiting Alert (minutes)" inputMode="numeric" value={s.orderWaiting} error={show('orderWaiting')} onChange={(e) => set('orderWaiting', e.target.value)} />
            <span />
            <Input label="Auto-Archive After (hours)" inputMode="numeric" value={s.autoArchiveHours} error={show('autoArchiveHours')} onChange={(e) => set('autoArchiveHours', e.target.value)} />
            <Input label="Restore Window (hours)" inputMode="numeric" value={s.restoreWindowHours} error={show('restoreWindowHours')} onChange={(e) => set('restoreWindowHours', e.target.value)} />
          </>
        )}

        {step === 4 && (
          <>
            <fieldset className="auth-grid__wide auth-fieldset">
              <legend>Payment Methods</legend>
              {METHODS.map((m) => (
                <div key={m.key} className="auth-toggle-row">
                  <Toggle checked={s.methods[m.key]} onChange={(v) => set('methods', { ...s.methods, [m.key]: v })} label={m.label} />
                  {m.key === 'cash' ? (
                    <Toggle checked={s.requireCashReceived} disabled={!s.methods.cash} onChange={(v) => set('requireCashReceived', v)} label="Require amount received" />
                  ) : (
                    <Toggle
                      checked={s.requireReference[m.key]}
                      disabled={!s.methods[m.key]}
                      onChange={(v) => set('requireReference', { ...s.requireReference, [m.key]: v })}
                      label="Require reference number"
                    />
                  )}
                </div>
              ))}
              <div className="auth-toggle-row">
                <Toggle checked={s.cashRounding} onChange={(v) => set('cashRounding', v)} label="Cash rounding" />
                <span className="auth-hint">Off unless you enable it (increment and mode are set in Settings → Payments).</span>
              </div>
              {show('methods') && <span className="field__error">{show('methods')}</span>}
            </fieldset>
            <fieldset className="auth-grid__wide auth-fieldset auth-fieldset--grid">
              <legend>Features</legend>
              {FEATURES.map((f) => (
                <Toggle key={f.key} checked={s.features[f.key]} onChange={(v) => set('features', { ...s.features, [f.key]: v })} label={f.label} />
              ))}
            </fieldset>
          </>
        )}
      </div>

      {error && <div className="auth-error" role="alert">{error}</div>}

      <footer className="auth-card__footer">
        <Button icon={<ArrowLeft size={16} />} disabled={step === 0 || submitting} onClick={() => setStep((x) => x - 1)}>
          Back
        </Button>
        {last ? (
          <Button variant="primary" disabled={submitting} onClick={submit}>
            {submitting ? 'Setting up…' : 'Complete Setup'}
          </Button>
        ) : (
          <Button variant="primary" onClick={next}>
            Next <ArrowRight size={16} />
          </Button>
        )}
      </footer>
    </div>
  );
}

import { useCallback, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ChevronRight, Coins, Info, Mail, MapPin, Phone, RotateCcw, Save, Store } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import {
  BUSINESS_DEFAULTS,
  BUSINESS_TYPES,
  CURRENCIES,
  saveBusinessSettings,
  useBusinessSettings,
  type BusinessSettings,
  type BusinessType,
} from '../../stores/businessSettingsStore';
import { errorMessage } from '../../services/api';
import '../../components/settings/settingsBusiness.css';

const OTHER = '__other__';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+()\d\s.-]{6,20}$/;

const same = (a: BusinessSettings, b: BusinessSettings) => (Object.keys(a) as (keyof BusinessSettings)[]).every((k) => a[k] === b[k]);

// Business identity & general operating info. Edits live in page state until
// "Save Changes", which saves them to the server (the business record printed on documents).
export default function SettingsBusinessPage() {
  const { settings: saved, savedAt } = useBusinessSettings();
  const [form, setForm] = useState<BusinessSettings>(saved);
  // Show the server copy once it loads (and after each save).
  useEffect(() => setForm(saved), [saved]);
  const [submitted, setSubmitted] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const set = (patch: Partial<BusinessSettings>) => setForm((f) => ({ ...f, ...patch }));
  const knownCurrency = CURRENCIES.find((c) => c.code === form.currency);
  const [otherCurrency, setOtherCurrency] = useState(!knownCurrency);

  const errors = {
    name: !form.name.trim() ? 'Business name is required.' : undefined,
    customType: form.type === 'Custom' && !form.customType.trim() ? 'Describe your business type.' : undefined,
    email: form.email.trim() && !EMAIL.test(form.email.trim()) ? 'Enter a valid email address.' : undefined,
    phone: form.phone.trim() && !PHONE.test(form.phone.trim()) ? 'Use digits, spaces, and + ( ) - only.' : undefined,
    currency: !/^[A-Za-z]{3}$/.test(form.currency.trim()) ? 'Use a 3-letter currency code (e.g. PHP).' : undefined,
    currencySymbol: !form.currencySymbol.trim() ? 'Enter a currency symbol.' : undefined,
  };
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);
  const valid = Object.values(errors).every((e) => !e);
  const dirty = !same(form, saved);
  const isConfigured = savedAt !== null && saved.name.trim() !== '';

  const save = async () => {
    setSubmitted(true);
    if (!valid) {
      // Bring the first invalid field into view after errors render.
      requestAnimationFrame(() => document.querySelector('.settings-business .input--error')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return;
    }
    const clean: BusinessSettings = {
      ...form,
      name: form.name.trim(),
      customType: form.type === 'Custom' ? form.customType.trim() : '',
      tagline: form.tagline.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      currency: form.currency.trim().toUpperCase(),
      currencySymbol: form.currencySymbol.trim(),
    };
    try {
      await saveBusinessSettings(clean);
      setSubmitted(false);
      setFeedback('Business settings saved');
    } catch (e) {
      setFeedback(errorMessage(e));
    }
  };

  const reset = () => {
    setForm(BUSINESS_DEFAULTS);
    setOtherCurrency(false);
    setSubmitted(false);
    setConfirmReset(false);
    setFeedback('Form reset to defaults — Save Changes to apply');
  };

  const chooseCurrency = (value: string) => {
    if (value === OTHER) {
      setOtherCurrency(true);
      set({ currency: '', currencySymbol: '' });
      return;
    }
    const c = CURRENCIES.find((x) => x.code === value)!;
    setOtherCurrency(false);
    set({ currency: c.code, currencySymbol: c.symbol });
  };

  const typeLabel = form.type === 'Custom' ? form.customType.trim() || 'Custom' : form.type;

  return (
    <div className="settings-business">
      <div className="sb-main">
        <section className="sb-card">
          <header className="sb-card__head">
            <span className="sb-card__icon">
              <Store size={16} />
            </span>
            <div>
              <h2>Business Identity</h2>
              <p>Your business name and type, shown across BrewSync and on customer documents.</p>
            </div>
          </header>
          <div className="sb-card__body">
            <Input
              label="Business Name *"
              placeholder="e.g. Corner Street Café"
              maxLength={60}
              value={form.name}
              error={err('name')}
              hint="Appears at the top of receipts and order tickets."
              onChange={(e) => set({ name: e.target.value })}
            />
            <div className="sb-grid">
              <Select
                label="Business Type *"
                value={form.type}
                onChange={(e) => set({ type: e.target.value as BusinessType })}
                options={BUSINESS_TYPES.map((t) => ({ value: t, label: t }))}
              />
              {form.type === 'Custom' ? (
                <Input label="Custom Business Type *" placeholder="e.g. Tea House" maxLength={40} value={form.customType} error={err('customType')} onChange={(e) => set({ customType: e.target.value })} />
              ) : (
                <span />
              )}
            </div>
            <p className="sb-hint">
              <Info size={13} /> Describes your business. In a later update, changing it may suggest tailored defaults — it never removes existing products, orders, or other data.
            </p>
            <Input
              label="Tagline / Motto"
              placeholder="e.g. Fresh coffee, made your way"
              maxLength={80}
              value={form.tagline}
              hint="Optional line shown under your business name."
              onChange={(e) => set({ tagline: e.target.value })}
            />
          </div>
        </section>

        <section className="sb-card">
          <header className="sb-card__head">
            <span className="sb-card__icon">
              <MapPin size={16} />
            </span>
            <div>
              <h2>Contact &amp; Location</h2>
              <p>How customers can find and reach your business.</p>
            </div>
          </header>
          <div className="sb-card__body">
            <Input label="Address" placeholder="Street, city, province / state, country" maxLength={160} value={form.address} onChange={(e) => set({ address: e.target.value })} />
            <div className="sb-grid">
              <Input
                label="Contact Number"
                placeholder="e.g. +63 900 000 0000"
                inputMode="tel"
                maxLength={20}
                value={form.phone}
                error={err('phone')}
                hint="Printed on receipts for inquiries."
                onChange={(e) => set({ phone: e.target.value })}
              />
              <Input
                label="Email"
                type="email"
                placeholder="e.g. hello@yourbusiness.com"
                maxLength={80}
                value={form.email}
                error={err('email')}
                hint="Business contact email."
                onChange={(e) => set({ email: e.target.value })}
              />
            </div>
          </div>
        </section>

        <section className="sb-card">
          <header className="sb-card__head">
            <span className="sb-card__icon">
              <Coins size={16} />
            </span>
            <div>
              <h2>Currency</h2>
              <p>The currency used for prices, totals, and reports.</p>
            </div>
          </header>
          <div className="sb-card__body">
            <div className="sb-grid">
              <Select
                label="Currency"
                value={otherCurrency ? OTHER : form.currency}
                onChange={(e) => chooseCurrency(e.target.value)}
                options={[...CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })), { value: OTHER, label: 'Other…' }]}
              />
              <Input
                label="Currency Symbol"
                placeholder="e.g. ₱"
                maxLength={4}
                value={form.currencySymbol}
                error={err('currencySymbol')}
                hint="Shown before amounts, e.g. ₱120.00"
                onChange={(e) => set({ currencySymbol: e.target.value })}
              />
              {otherCurrency && (
                <Input
                  label="Currency Code"
                  placeholder="3 letters, e.g. MYR"
                  maxLength={3}
                  value={form.currency}
                  error={err('currency')}
                  onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
                />
              )}
            </div>
          </div>
        </section>

        <p className="sb-note">
          <Info size={14} /> Business settings define your business profile and general operating information. Changing these settings does not delete existing business data.
        </p>
      </div>

      <aside className="sb-side">
        <section className="sb-card sb-preview">
          <header className="sb-side__head">
            <h2>Business Preview</h2>
            <Badge tone="success" dot>
              Live Preview
            </Badge>
          </header>
          <div className="sb-preview__paper">
            <span className="sb-preview__logo">
              <Building2 size={20} />
            </span>
            <strong className={form.name.trim() ? '' : 'sb-placeholder'}>{form.name.trim() || 'Your Business Name'}</strong>
            {form.tagline.trim() && <em>“{form.tagline.trim()}”</em>}
            <span className="sb-preview__type">{typeLabel}</span>
            <dl>
              <dt>
                <MapPin size={12} /> Location
              </dt>
              <dd>{form.address.trim() || <span className="sb-placeholder">Not set</span>}</dd>
              <dt>
                <Phone size={12} /> Tel
              </dt>
              <dd>{form.phone.trim() || <span className="sb-placeholder">Not set</span>}</dd>
              <dt>
                <Mail size={12} /> Email
              </dt>
              <dd>{form.email.trim() || <span className="sb-placeholder">Not set</span>}</dd>
              <dt>
                <Coins size={12} /> Currency
              </dt>
              <dd>
                {form.currency || '—'} ({form.currencySymbol || '—'})
              </dd>
            </dl>
          </div>
          <p className="sb-side__foot">How your business appears in BrewSync headers and on customer receipts.</p>
        </section>

        <section className="sb-card sb-status">
          <header className="sb-side__head">
            <h2>Profile Status</h2>
            {dirty ? <Badge tone="info">Unsaved Changes</Badge> : isConfigured ? <Badge tone="success">Configured</Badge> : <Badge tone="warning">Needs Setup</Badge>}
          </header>
          <dl className="sb-status__rows">
            <dt>Last saved</dt>
            <dd>{savedAt ? savedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not saved from this browser yet'}</dd>
            <dt>Storage</dt>
            <dd>This session only</dd>
          </dl>
          <Link to="/settings/branding" className="sb-link">
            Configure logo &amp; brand colors <ChevronRight size={14} />
          </Link>
          <Link to="/settings/receipts" className="sb-link">
            Customize receipts <ChevronRight size={14} />
          </Link>
        </section>
      </aside>

      <footer className="sb-actions">
        <span className="sb-actions__state">{dirty ? 'You have unsaved changes.' : savedAt ? 'All changes saved.' : 'Fill in your business details and save.'}</span>
        <div className="sb-actions__buttons">
          <Button icon={<RotateCcw size={15} />} onClick={() => setConfirmReset(true)} disabled={same(form, BUSINESS_DEFAULTS)}>
            Reset to Defaults
          </Button>
          <Button variant="primary" icon={<Save size={15} />} onClick={save} disabled={!dirty}>
            Save Changes
          </Button>
        </div>
      </footer>

      <ConfirmDialog
        open={confirmReset}
        title="Reset business settings?"
        message="The form will be cleared back to its defaults (empty profile, PHP ₱). Nothing changes until you Save Changes, and no products, orders, or other data are affected."
        confirmLabel="Reset Form"
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

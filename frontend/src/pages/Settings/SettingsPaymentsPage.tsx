import { useCallback, useState, useEffect } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Banknote, Building2, ChevronDown, CreditCard, Info, MonitorSmartphone, RotateCcw, Save, Smartphone, type LucideIcon } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Toggle from '../../components/ui/Toggle';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { useBusinessSettings } from '../../stores/businessSettingsStore';
import {
  PAYMENT_DEFAULTS,
  PAYMENT_METHODS,
  enabledMethods,
  savePaymentSettings,
  usePaymentSettings,
  type PaymentMethodKey,
  type PaymentSettings,
  type ReferenceOptions,
} from '../../stores/paymentSettingsStore';
import { errorMessage } from '../../services/api';
import '../../components/settings/settingsPayments.css';

const ICONS: Record<PaymentMethodKey, LucideIcon> = { cash: Banknote, gcash: Smartphone, card: CreditCard, bank: Building2 };

// Sample figure for the checkout preview only.
const SAMPLE_DUE = 450;

type OptionRow = { key: string; label: string; description: string };

const CASH_OPTIONS: OptionRow[] = [
  { key: 'requireCashReceived', label: 'Require cash received amount', description: 'Staff enter how much cash the customer handed over.' },
  { key: 'autoChange', label: 'Calculate change automatically', description: 'Show the change to give back from the amount received.' },
  { key: 'openDrawer', label: 'Open cash drawer on payment', description: 'Open the connected cash drawer when a cash payment is completed.' },
];

const REFERENCE_OPTIONS: Record<Exclude<PaymentMethodKey, 'cash'>, OptionRow[]> = {
  gcash: [
    { key: 'requireReference', label: 'Require payment reference', description: 'Staff enter the GCash reference number from the customer’s receipt.' },
    { key: 'requireConfirmation', label: 'Require payment confirmation', description: 'Staff confirm the payment was received before completing the order.' },
  ],
  card: [
    { key: 'requireReference', label: 'Require payment reference', description: 'Staff enter the approval code printed by the card terminal.' },
    { key: 'requireConfirmation', label: 'Require payment confirmation', description: 'Staff confirm the terminal approved the payment before completing the order.' },
  ],
  bank: [
    { key: 'requireReference', label: 'Require payment reference', description: 'Staff enter the transfer reference number.' },
    { key: 'requireConfirmation', label: 'Require payment confirmation', description: 'Staff confirm the transfer arrived before completing the order.' },
  ],
};

const same = (a: PaymentSettings, b: PaymentSettings) => JSON.stringify(a) === JSON.stringify(b);

// Checkout payment method configuration only. Nothing is persisted and no
// payment service is contacted.
export default function SettingsPaymentsPage() {
  const { settings: saved, savedAt } = usePaymentSettings();
  const { settings: business } = useBusinessSettings();
  const [form, setForm] = useState<PaymentSettings>(saved);
  // Show the server copy once it loads (and after each save).
  useEffect(() => setForm(saved), [saved]);
  const [open, setOpen] = useState<PaymentMethodKey | null>('cash');
  const [previewPick, setPreviewPick] = useState<PaymentMethodKey | null>(null);
  const [lastMethodWarning, setLastMethodWarning] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const dirty = !same(form, saved);
  const active = enabledMethods(form);
  const cur = business.currencySymbol || '₱';
  const money = (n: number) => `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  const setEnabled = (key: PaymentMethodKey, value: boolean) => {
    if (!value && active.length === 1 && active[0] === key) {
      setLastMethodWarning(true);
      return;
    }
    setLastMethodWarning(false);
    setForm((f) => ({ ...f, enabled: { ...f.enabled, [key]: value } }));
  };

  const setOption = (method: PaymentMethodKey, option: string, value: boolean) =>
    setForm((f) => ({ ...f, [method]: { ...f[method], [option]: value } }));

  const move = (key: PaymentMethodKey, dir: -1 | 1) =>
    setForm((f) => {
      const order = [...f.order];
      const i = order.indexOf(key);
      const j = i + dir;
      if (j < 0 || j >= order.length) return f;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...f, order };
    });

  const save = async () => {
    try {
      await savePaymentSettings(form);
      setFeedback('Payment settings saved');
    } catch (e) {
      setFeedback(errorMessage(e));
    }
  };

  const reset = () => {
    setForm(PAYMENT_DEFAULTS);
    setLastMethodWarning(false);
    setConfirmReset(false);
    setFeedback('Payment settings reset to defaults — Save Changes to apply');
  };

  const picked = previewPick && form.enabled[previewPick] ? previewPick : active[0];
  const optionsFor = (key: PaymentMethodKey) => (key === 'cash' ? CASH_OPTIONS : REFERENCE_OPTIONS[key]);
  const optionValue = (key: PaymentMethodKey, opt: string) => (form[key] as unknown as Record<string, boolean>)[opt];
  const summary = (key: PaymentMethodKey) => {
    const on = optionsFor(key).filter((o) => optionValue(key, o.key)).length;
    return `${on} of ${optionsFor(key).length} rules on`;
  };

  return (
    <div className="settings-payments">
      <div className="py-main">
        <header className="py-head">
          <div>
            <h2>Payment Methods</h2>
            <p>Choose the payment methods staff can use at checkout, their order, and what staff must record for each.</p>
          </div>
          <Badge tone={active.length ? 'success' : 'neutral'} dot>
            {active.length} of {form.order.length} enabled
          </Badge>
        </header>

        {lastMethodWarning && (
          <p className="py-warning" role="alert">
            <AlertTriangle size={14} /> Keep at least one payment method enabled so orders can be paid.
          </p>
        )}

        <ol className="py-list" aria-label="Payment methods in checkout order">
          {form.order.map((key, index) => {
            const Icon = ICONS[key];
            const on = form.enabled[key];
            const isOpen = open === key;
            const position = on ? active.indexOf(key) + 1 : null;
            return (
              <li key={key} className={`py-method ${on ? '' : 'py-method--off'} ${isOpen ? 'py-method--open' : ''}`} data-method={key}>
                <div className="py-method__head">
                  <div className="py-order" aria-label={`Move ${PAYMENT_METHODS[key].name}`}>
                    <button type="button" className="py-order__btn" aria-label={`Move ${PAYMENT_METHODS[key].name} up`} disabled={index === 0} onClick={() => move(key, -1)}>
                      <ArrowUp size={13} />
                    </button>
                    <button type="button" className="py-order__btn" aria-label={`Move ${PAYMENT_METHODS[key].name} down`} disabled={index === form.order.length - 1} onClick={() => move(key, 1)}>
                      <ArrowDown size={13} />
                    </button>
                  </div>
                  <span className="py-method__icon">
                    <Icon size={18} />
                  </span>
                  <div className="py-method__text">
                    <div className="py-method__title">
                      <strong>{PAYMENT_METHODS[key].name}</strong>
                      <Badge tone={on ? 'success' : 'neutral'}>{on ? 'Enabled' : 'Disabled'}</Badge>
                      {position && <span className="py-position">Position {position}</span>}
                    </div>
                    <p>{PAYMENT_METHODS[key].description}</p>
                  </div>
                  <button type="button" className="py-configure" aria-expanded={isOpen} aria-label={`${PAYMENT_METHODS[key].name} settings (${summary(key)})`} onClick={() => setOpen(isOpen ? null : key)}>
                    <span>{summary(key)}</span>
                    <ChevronDown size={15} />
                  </button>
                  <Toggle checked={on} onChange={(v) => setEnabled(key, v)} label={`Enable ${PAYMENT_METHODS[key].name}`} />
                </div>
                {isOpen && (
                  <ul className="py-options" aria-label={`${PAYMENT_METHODS[key].name} settings`}>
                    {optionsFor(key).map((o) => (
                      <li key={o.key} data-option={o.key}>
                        <div>
                          <strong>{o.label}</strong>
                          <span>{o.description}</span>
                        </div>
                        <Toggle checked={optionValue(key, o.key)} disabled={!on} onChange={(v) => setOption(key, o.key, v)} label={o.label} />
                      </li>
                    ))}
                    {key === 'cash' && !form.cash.requireCashReceived && form.cash.autoChange && (
                      <li className="py-options__hint">
                        <Info size={13} /> Change can only be calculated when staff enter the cash received.
                      </li>
                    )}
                    {!on && (
                      <li className="py-options__hint">
                        <Info size={13} /> Turn {PAYMENT_METHODS[key].name} on to change these settings.
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>

        <p className="py-note">
          <Info size={14} /> Disabled payment methods will not appear during checkout. Existing transaction records are preserved.
        </p>
      </div>

      {/* POS preview */}
      <aside className="py-side">
        <section className="py-card">
          <header className="py-card__head">
            <div>
              <h2>
                <MonitorSmartphone size={16} /> POS Payment Preview
              </h2>
              <p>How payment options appear to staff at checkout.</p>
            </div>
            <Badge tone="success" dot>
              Live
            </Badge>
          </header>
          <div className="py-preview">
            <div className="py-due">
              <span>Sample total due</span>
              <strong>{money(SAMPLE_DUE)}</strong>
            </div>
            <span className="py-preview__label">Select Payment Method</span>
            <div className="py-tenders" role="radiogroup" aria-label="Preview payment methods">
              {active.map((key) => {
                const Icon = ICONS[key];
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={picked === key}
                    className={`py-tender ${picked === key ? 'py-tender--active' : ''}`}
                    data-tender={key}
                    onClick={() => setPreviewPick(key)}
                  >
                    <Icon size={16} />
                    <span>{PAYMENT_METHODS[key].name}</span>
                  </button>
                );
              })}
            </div>

            {picked && (
              <div className="py-step" data-step={picked}>
                <span className="py-preview__label">{PAYMENT_METHODS[picked].name} checkout</span>
                {picked === 'cash' ? (
                  <>
                    {form.cash.requireCashReceived ? (
                      <div className="py-field">
                        <span>Cash received</span>
                        <b>{cur} Enter amount</b>
                      </div>
                    ) : (
                      <p className="py-step__muted">Cash received is not recorded.</p>
                    )}
                    {form.cash.requireCashReceived && form.cash.autoChange && (
                      <div className="py-field py-field--result">
                        <span>Change due</span>
                        <b>Calculated automatically</b>
                      </div>
                    )}
                    {form.cash.openDrawer && <p className="py-step__muted">Cash drawer opens when payment is completed.</p>}
                  </>
                ) : (
                  <>
                    {(form[picked] as ReferenceOptions).requireReference ? (
                      <div className="py-field">
                        <span>Payment reference</span>
                        <b>Required</b>
                      </div>
                    ) : (
                      <p className="py-step__muted">No reference number needed.</p>
                    )}
                    {(form[picked] as ReferenceOptions).requireConfirmation && (
                      <label className="py-check">
                        <input type="checkbox" disabled /> Payment received and confirmed
                      </label>
                    )}
                  </>
                )}
                <button type="button" className="py-complete" tabIndex={-1}>
                  Complete {PAYMENT_METHODS[picked].name} Payment
                </button>
              </div>
            )}
          </div>
          <p className="py-preview__caption">
            <Info size={12} /> Preview only — no payment is processed and no payment service is contacted.
          </p>
        </section>
      </aside>

      <footer className="py-actions">
        <span className="py-actions__state">
          {dirty ? 'You have unsaved changes.' : savedAt ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : 'Using the default payment settings.'}
        </span>
        <div className="py-actions__buttons">
          <Button icon={<RotateCcw size={15} />} disabled={same(form, PAYMENT_DEFAULTS)} onClick={() => setConfirmReset(true)}>
            Reset to Defaults
          </Button>
          <Button
            disabled={!dirty}
            onClick={() => {
              setForm(saved);
              setLastMethodWarning(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" icon={<Save size={15} />} disabled={!dirty} onClick={save}>
            Save Changes
          </Button>
        </div>
      </footer>

      <ConfirmDialog
        open={confirmReset}
        title="Reset payment settings to defaults?"
        message="All payment methods are turned on in the default order, and each method’s rules return to their defaults. Nothing changes until you Save Changes."
        confirmLabel="Reset Payments"
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

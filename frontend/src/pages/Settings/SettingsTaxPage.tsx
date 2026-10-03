import { useCallback, useEffect, useState } from 'react';
import { Calculator, CheckCircle2, Circle, Info, Percent, ReceiptText, RotateCcw, Save, Scale } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Input from '../../components/ui/Input';
import Tabs from '../../components/ui/Tabs';
import Toggle from '../../components/ui/Toggle';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { useBusinessSettings } from '../../stores/businessSettingsStore';
import { errorMessage } from '../../services/api';
import { MAX_TAX_RATE, TAX_DEFAULTS, calculateTax, parseRate, saveTaxSettings, useTaxSettings, type TaxMode, type TaxSettings } from '../../stores/taxSettingsStore';
import '../../components/settings/settingsTax.css';

// Sample figures for the preview only — never a real transaction.
const SAMPLE_ITEMS = 500;
const SAMPLE_DISCOUNT = 50;

const MODES: { value: TaxMode; label: string; description: string; hint: string }[] = [
  { value: 'included', label: 'Tax Included', description: 'Displayed product prices already include the configured tax. The tax portion is shown for reporting and receipts.', hint: 'Customer pays the displayed price' },
  { value: 'excluded', label: 'Tax Excluded', description: 'Tax is calculated separately and added to the transaction total at checkout.', hint: 'Tax is added on top of the displayed price' },
];

const sameTax = (a: TaxSettings, b: TaxSettings) => (Object.keys(a) as (keyof TaxSettings)[]).every((k) => a[k] === b[k]);

function validate(s: TaxSettings) {
  if (!s.enabled) return {};
  const errors: { name?: string; rate?: string } = {};
  if (!s.name.trim()) errors.name = 'Enter a tax name, e.g. VAT or Sales Tax.';
  const rate = parseRate(s.rate);
  if (rate === null) errors.rate = `Enter a rate from 0 to ${MAX_TAX_RATE}.`;
  else if (rate === 0) errors.rate = 'Enter a rate above 0, or turn tax off.';
  return errors;
}

// Tax configuration, saved to the server's `tax` settings section. The preview is
// illustrative; real totals are always computed by the server.
export default function SettingsTaxPage() {
  const { settings: saved, savedAt, version, error: loadError } = useTaxSettings();
  const { settings: business } = useBusinessSettings();
  const [form, setForm] = useState<TaxSettings>(saved);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const [saving, setSaving] = useState(false);
  // Adopt the server values when they (re)load.
  useEffect(() => setForm(saved), [saved, version]);

  const set = (patch: Partial<TaxSettings>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = !sameTax(form, saved);
  const errors = validate(form);
  const visibleErrors = showErrors ? errors : {};
  const off = !form.enabled;

  const cur = business.currencySymbol || '₱';
  const money = (n: number) => `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const calc = calculateTax(SAMPLE_ITEMS, SAMPLE_DISCOUNT, form);
  const rate = parseRate(form.rate);
  const taxLabel = form.name.trim() || 'Tax';
  const rateLabel = rate !== null ? `${rate}%` : '—';

  const save = async () => {
    if (Object.keys(errors).length) {
      setShowErrors(true);
      setFeedback('Fix the highlighted fields before saving');
      return;
    }
    setSaving(true);
    try {
      await saveTaxSettings({ ...form, name: form.name.trim(), registrationNumber: form.registrationNumber.trim() });
      setShowErrors(false);
      setFeedback('Tax settings saved');
    } catch (e) {
      setFeedback(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setForm(TAX_DEFAULTS);
    setShowErrors(false);
    setConfirmReset(false);
    setFeedback('Tax settings reset to defaults — Save Changes to apply');
  };

  return (
    <div className="settings-tax">
      <div className="tx-main">
        {/* Enable tax */}
        <section className="tx-card tx-enable">
          <span className="tx-enable__icon">
            <Calculator size={18} />
          </span>
          <div className="tx-enable__text">
            <h2>
              Enable Tax
              <Badge tone={form.enabled ? 'success' : 'neutral'} dot>
                {form.enabled ? 'Tax Enabled' : 'Tax Disabled'}
              </Badge>
            </h2>
            <p>{form.enabled ? 'Tax is calculated on sales using the settings below.' : 'No tax is calculated. Your settings below are kept for when you turn tax on.'}</p>
          </div>
          <Toggle checked={form.enabled} onChange={(enabled) => set({ enabled })} label="Enable tax" />
        </section>

        {/* Details */}
        <section className={`tx-card ${off ? 'tx-card--off' : ''}`} aria-disabled={off}>
          <header className="tx-card__head">
            <div>
              <h2>
                <Percent size={16} /> Tax Details
              </h2>
              <p>The name and rate that apply to your sales. Use the rate required for your business.</p>
            </div>
          </header>
          <div className="tx-fields">
            <Input
              label="Tax Name"
              placeholder="e.g. VAT, GST, Sales Tax"
              maxLength={24}
              value={form.name}
              disabled={off}
              error={visibleErrors.name}
              hint="Shown on the register and receipts."
              onChange={(e) => set({ name: e.target.value })}
            />
            <div className={`field tx-rate ${visibleErrors.rate ? 'tx-rate--error' : ''}`}>
              <label className="field__label" htmlFor="tax-rate">
                Tax Rate (%)
              </label>
              <div className="tx-rate__wrap">
                <input
                  id="tax-rate"
                  className={`input ${visibleErrors.rate ? 'input--error' : ''}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={MAX_TAX_RATE}
                  step="0.01"
                  placeholder="0.00"
                  value={form.rate}
                  disabled={off}
                  onChange={(e) => set({ rate: e.target.value })}
                />
                <span aria-hidden>%</span>
              </div>
              {visibleErrors.rate ? <span className="field__error">{visibleErrors.rate}</span> : <span className="field__hint">Applied to taxable sales. Decimals allowed.</span>}
            </div>
            <Input
              className="tx-fields__wide"
              label="Tax Registration Number (optional)"
              placeholder="e.g. TIN or VAT registration number"
              maxLength={40}
              value={form.registrationNumber}
              disabled={off}
              hint="Printed on receipts when tax is shown."
              onChange={(e) => set({ registrationNumber: e.target.value })}
            />
          </div>
        </section>

        {/* Mode */}
        <section className={`tx-card ${off ? 'tx-card--off' : ''}`}>
          <header className="tx-card__head">
            <div>
              <h2>
                <Scale size={16} /> Tax Pricing Mode
              </h2>
              <p>Choose whether your product prices already include tax.</p>
            </div>
          </header>
          <div className="tx-modes" role="radiogroup" aria-label="Tax pricing mode">
            {MODES.map((m) => {
              const active = form.mode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={off}
                  data-mode={m.value}
                  className={`tx-mode ${active ? 'tx-mode--active' : ''}`}
                  onClick={() => set({ mode: m.value })}
                >
                  <span className="tx-mode__title">
                    {active ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                    <strong>{m.label}</strong>
                    {active && <Badge tone="neutral">Selected</Badge>}
                  </span>
                  <span className="tx-mode__desc">{m.description}</span>
                  <span className="tx-mode__hint">{m.hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Receipt display */}
        <section className={`tx-card ${off ? 'tx-card--off' : ''}`}>
          <header className="tx-card__head">
            <div>
              <h2>
                <ReceiptText size={16} /> Receipt Tax Display
              </h2>
              <p>How tax appears on printed and digital receipts.</p>
            </div>
          </header>
          <ul className="tx-toggles">
            <li data-toggle="showOnReceipt">
              <div>
                <strong>Show Tax on Receipt</strong>
                <span>Print a tax line on the receipt.</span>
              </div>
              <Toggle checked={form.showOnReceipt} disabled={off} onChange={(showOnReceipt) => set({ showOnReceipt })} label="Show tax on receipt" />
            </li>
            <li data-toggle="showRate">
              <div>
                <strong>Show Tax Rate</strong>
                <span>Include the percentage next to the tax name.</span>
              </div>
              <Toggle checked={form.showRate} disabled={off || !form.showOnReceipt} onChange={(showRate) => set({ showRate })} label="Show tax rate" />
            </li>
            <li data-toggle="showBreakdown">
              <div>
                <strong>Show Tax Breakdown</strong>
                <span>Show the amount before tax and the tax amount separately.</span>
              </div>
              <Toggle checked={form.showBreakdown} disabled={off || !form.showOnReceipt} onChange={(showBreakdown) => set({ showBreakdown })} label="Show tax breakdown" />
            </li>
          </ul>
        </section>

        <p className="tx-note">
          <Info size={14} /> Tax settings control how BrewSync calculates and displays tax. Verify your configuration against the requirements applicable to your business before using it for actual transactions.
        </p>
      </div>

      {/* Preview */}
      <aside className="tx-side">
        <section className="tx-card">
          <header className="tx-card__head">
            <div>
              <h2>
                <Calculator size={16} /> Example Calculation
              </h2>
              <p>Sample amounts for illustration only — not a real transaction.</p>
            </div>
            <Badge tone={calc.applied ? 'success' : 'neutral'}>{calc.applied ? `${rateLabel} ${form.mode === 'included' ? 'included' : 'added'}` : 'No tax applied'}</Badge>
          </header>

          <div className="tx-basis">
            <span>Pricing mode</span>
            <Tabs
              items={MODES.map((m) => ({ value: m.value, label: m.label }))}
              value={form.mode}
              onChange={(v) => !off && set({ mode: v as TaxMode })}
            />
          </div>

          <dl className="tx-calc" aria-label="Example calculation">
            <div data-row="items">
              <dt>Item Total</dt>
              <dd>{money(calc.itemTotal)}</dd>
            </div>
            <div data-row="discount">
              <dt>Discount</dt>
              <dd>−{money(calc.discount)}</dd>
            </div>
            {calc.applied && form.mode === 'included' && (
              <div data-row="net" className="tx-calc__sub">
                <dt>Amount before tax</dt>
                <dd>{money(calc.net)}</dd>
              </div>
            )}
            <div data-row="tax">
              <dt>
                {taxLabel} {calc.applied && `(${rateLabel}${form.mode === 'included' ? ' included' : ''})`}
              </dt>
              <dd>{calc.applied ? (form.mode === 'included' ? money(calc.tax) : `+${money(calc.tax)}`) : money(0)}</dd>
            </div>
            <div data-row="total" className="tx-calc__total">
              <dt>Total</dt>
              <dd>{money(calc.total)}</dd>
            </div>
          </dl>
          <p className="tx-calc__explain">
            {!calc.applied
              ? form.enabled
                ? 'Enter a tax rate to see tax in the example.'
                : 'Tax is off, so the total is the item total minus the discount.'
              : form.mode === 'included'
                ? `Prices already include ${taxLabel}: ${money(calc.taxable)} ÷ ${(1 + (rate ?? 0) / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} = ${money(calc.net)} before tax.`
                : `${taxLabel} is added: ${money(calc.taxable)} × ${rateLabel} = ${money(calc.tax)}.`}
          </p>

          <div className="tx-receipt" aria-label="Receipt preview">
            <span className="tx-receipt__label">Receipt preview</span>
            <div className="tx-receipt__line">
              <span>Subtotal</span>
              <span>{money(calc.taxable)}</span>
            </div>
            {calc.applied && form.showOnReceipt && form.showBreakdown && (
              <div className="tx-receipt__line" data-receipt="breakdown">
                <span>Amount before {taxLabel}</span>
                <span>{money(calc.net)}</span>
              </div>
            )}
            {calc.applied && form.showOnReceipt && (
              <div className="tx-receipt__line" data-receipt="tax">
                <span>
                  {taxLabel}
                  {form.showRate && ` (${rateLabel})`}
                  {form.mode === 'included' && ' incl.'}
                </span>
                <span>{money(calc.tax)}</span>
              </div>
            )}
            <div className="tx-receipt__line tx-receipt__total">
              <span>TOTAL</span>
              <span>{money(calc.total)}</span>
            </div>
            {calc.applied && form.showOnReceipt && form.registrationNumber.trim() && <div className="tx-receipt__reg">Tax Reg. No. {form.registrationNumber.trim()}</div>}
          </div>
        </section>
      </aside>

      <footer className="tx-actions">
        <span className="tx-actions__state">
          {loadError ? loadError : dirty ? 'You have unsaved changes.' : savedAt ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : saved.enabled ? 'Tax is configured.' : 'Tax is off.'}
        </span>
        <div className="tx-actions__buttons">
          <Button icon={<RotateCcw size={15} />} disabled={sameTax(form, TAX_DEFAULTS)} onClick={() => setConfirmReset(true)}>
            Reset to Defaults
          </Button>
          <Button
            disabled={!dirty}
            onClick={() => {
              setForm(saved);
              setShowErrors(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" icon={<Save size={15} />} disabled={!dirty || saving} onClick={() => void save()}>
            Save Changes
          </Button>
        </div>
      </footer>

      <ConfirmDialog
        open={confirmReset}
        title="Reset tax settings to defaults?"
        message="Tax is turned off and the name, rate, and registration number are cleared. Nothing changes until you Save Changes."
        confirmLabel="Reset Tax Settings"
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

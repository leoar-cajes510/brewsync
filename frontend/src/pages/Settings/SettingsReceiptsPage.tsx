import { useCallback, useRef, useState, useEffect } from 'react';
import { Building2, Clock, CreditCard, FileText, Hash, ImagePlus, Info, Mail, MapPin, MessageSquareText, MonitorSmartphone, Percent, Phone, Printer, ReceiptText, RefreshCw, RotateCcw, Save, Tag, Trash2, User, UserRound } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Tabs from '../../components/ui/Tabs';
import Toggle from '../../components/ui/Toggle';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { useBusinessSettings } from '../../stores/businessSettingsStore';
import { parseRate, useTaxSettings } from '../../stores/taxSettingsStore';
import {
  RECEIPT_DEFAULTS,
  RECEIPT_TEXT_LIMITS,
  saveReceiptSettings,
  useReceiptSettings,
  type ReceiptFormat,
  type ReceiptLogo,
  type ReceiptSettings,
  type ReceiptTextKey,
  type ReceiptToggleKey,
} from '../../stores/receiptSettingsStore';
import { errorMessage } from '../../services/api';
import '../../components/settings/settingsReceipts.css';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

// Sample lines for the preview only — clearly labelled, never business data.
const SAMPLE_LINES = [
  { name: 'Sample Item A', option: 'Sample option', qty: 1, price: 120 },
  { name: 'Sample Item B', option: '', qty: 2, price: 85 },
];
const SAMPLE_DISCOUNT = 29;

const TRANSACTION_TOGGLES: { key: ReceiptToggleKey; label: string; icon: typeof Hash }[] = [
  { key: 'showOrderNumber', label: 'Show Order Number', icon: Hash },
  { key: 'showReference', label: 'Show Transaction Reference', icon: ReceiptText },
  { key: 'showDateTime', label: 'Show Date and Time', icon: Clock },
  { key: 'showCashier', label: 'Show Cashier Name', icon: User },
  { key: 'showTerminal', label: 'Show Terminal', icon: MonitorSmartphone },
  { key: 'showCustomer', label: 'Show Customer Information', icon: UserRound },
  { key: 'showPaymentMethod', label: 'Show Payment Method', icon: CreditCard },
  { key: 'showDiscount', label: 'Show Discount', icon: Tag },
  { key: 'showTax', label: 'Show Tax', icon: Percent },
];

const TEXT_FIELDS: { key: ReceiptTextKey; label: string; hint: string; multiline?: boolean }[] = [
  { key: 'heading', label: 'Receipt Heading', hint: 'Title printed above the order details, e.g. RECEIPT or SALES INVOICE.' },
  { key: 'thankYou', label: 'Thank You Message', hint: 'Printed under the totals.' },
  { key: 'footer', label: 'Footer Message', hint: 'For example a return policy or Wi-Fi details.', multiline: true },
  { key: 'smallPrint', label: 'Small Print', hint: 'Optional fine print at the very bottom.', multiline: true },
];

const same = (a: ReceiptSettings, b: ReceiptSettings) =>
  (Object.keys(a) as (keyof ReceiptSettings)[]).every((k) => (k === 'logo' ? a.logo?.dataUrl === b.logo?.dataUrl : a[k] === b[k]));

function readLogo(file: File): Promise<ReceiptLogo> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file. Try another image.'));
    reader.onload = () => resolve({ dataUrl: String(reader.result), fileName: file.name });
    reader.readAsDataURL(file);
  });
}

// Receipt presentation only. Identity comes from Settings → Business, tax from
// Settings → Tax. Nothing is persisted; completed receipts are unaffected.
export default function SettingsReceiptsPage() {
  const { settings: saved, savedAt } = useReceiptSettings();
  const { settings: business } = useBusinessSettings();
  const { settings: tax } = useTaxSettings();
  const [form, setForm] = useState<ReceiptSettings>(saved);
  // Show the server copy once it loads (and after each save).
  useEffect(() => setForm(saved), [saved]);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const set = (patch: Partial<ReceiptSettings>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = !same(form, saved);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return setLogoError('Use a PNG, JPG, WEBP, or SVG image.');
    if (file.size > MAX_LOGO_BYTES) return setLogoError('Logo must be 2 MB or smaller.');
    try {
      const logo = await readLogo(file);
      setLogoError(null);
      set({ logo, showLogo: true });
    } catch (e) {
      setLogoError((e as Error).message);
    }
  };

  const save = async () => {
    try {
      await saveReceiptSettings({ ...form, heading: form.heading.trim(), thankYou: form.thankYou.trim(), footer: form.footer.trim(), smallPrint: form.smallPrint.trim() });
      setFeedback('Receipt settings saved');
    } catch (e) {
      setFeedback(errorMessage(e));
    }
  };

  const reset = () => {
    setForm(RECEIPT_DEFAULTS);
    setLogoError(null);
    setConfirmReset(false);
    setFeedback('Receipt settings reset to defaults — Save Changes to apply');
  };

  // Identity rows: values from Settings → Business (read-only here).
  const identity: { key: ReceiptToggleKey; label: string; value: string; icon: typeof Hash }[] = [
    { key: 'showBusinessName', label: 'Business Name', value: business.name.trim(), icon: Building2 },
    { key: 'showAddress', label: 'Business Address', value: business.address.trim(), icon: MapPin },
    { key: 'showPhone', label: 'Contact Number', value: business.phone.trim(), icon: Phone },
    { key: 'showEmail', label: 'Email', value: business.email.trim(), icon: Mail },
  ];

  // Preview math (display only).
  const cur = business.currencySymbol || '₱';
  const money = (n: number) => `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const subtotal = SAMPLE_LINES.reduce((s, l) => s + l.qty * l.price, 0);
  const afterDiscount = subtotal - SAMPLE_DISCOUNT;
  const rate = tax.enabled ? (parseRate(tax.rate) ?? 0) / 100 : 0;
  const included = tax.mode === 'included';
  const taxAmount = rate ? Math.round((included ? afterDiscount - afterDiscount / (1 + rate) : afterDiscount * rate) * 100) / 100 : 0;
  const total = included || !rate ? afterDiscount : afterDiscount + taxAmount;
  const now = new Date();
  const printed = form.format === 'printed';
  const showLogoInPreview = form.showLogo && form.logo;
  const taxLabel = `${tax.name.trim() || 'Tax'}${tax.showRate && rate ? ` (${Math.round(rate * 10000) / 100}%${included ? ' incl.' : ''})` : included && rate ? ' (incl.)' : ''}`;

  return (
    <div className="settings-receipts">
      <div className="rc-main">
        {/* Format */}
        <section className="rc-card">
          <header className="rc-card__head">
            <div>
              <h2>
                <Printer size={16} /> Receipt Format
              </h2>
              <p>Preview how receipts look when printed or shared digitally.</p>
            </div>
          </header>
          <div className="rc-format">
            <Tabs
              items={[
                { value: 'printed', label: 'Printed Receipt' },
                { value: 'digital', label: 'Digital Receipt' },
              ]}
              value={form.format}
              onChange={(v) => set({ format: v as ReceiptFormat })}
            />
            <p className="rc-hint">
              <Info size={13} /> Printer connection and digital delivery (email/SMS) are set up later; this only changes the layout.
            </p>
          </div>
        </section>

        {/* Header */}
        <section className="rc-card">
          <header className="rc-card__head">
            <div>
              <h2>
                <Building2 size={16} /> Receipt Header
              </h2>
              <p>Choose which business details appear at the top of each receipt.</p>
            </div>
          </header>

          <div className="rc-logo" data-testid="receipt-logo">
            <div className="rc-logo__frame">{form.logo ? <img src={form.logo.dataUrl} alt="Receipt logo preview" /> : <ImagePlus size={20} />}</div>
            <div className="rc-logo__text">
              <strong>Logo</strong>
              <span>{form.logo ? form.logo.fileName : 'No logo uploaded. PNG, JPG, WEBP, or SVG up to 2 MB.'}</span>
              {logoError && <span className="field__error">{logoError}</span>}
            </div>
            <div className="rc-logo__actions">
              {form.logo ? (
                <>
                  <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => fileRef.current?.click()}>
                    Replace
                  </Button>
                  <Button size="sm" className="rc-logo__remove" icon={<Trash2 size={13} />} onClick={() => set({ logo: null })}>
                    Remove
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="primary" icon={<ImagePlus size={13} />} onClick={() => fileRef.current?.click()}>
                  Upload Logo
                </Button>
              )}
              <Toggle checked={form.showLogo && !!form.logo} disabled={!form.logo} onChange={(showLogo) => set({ showLogo })} label="Show logo on receipt" />
            </div>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={LOGO_TYPES.join(',')}
              data-testid="receipt-logo-input"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>

          <ul className="rc-rows">
            {identity.map(({ key, label, value, icon: Icon }) => (
              <li key={key} className="rc-row" data-toggle={key}>
                <Icon size={15} className="rc-row__icon" />
                <div>
                  <strong>{label}</strong>
                  <span className={value ? '' : 'rc-row__missing'}>{value || 'Not set — add it in Settings → Business'}</span>
                </div>
                <Toggle checked={form[key]} onChange={(v) => set({ [key]: v })} label={`Show ${label.toLowerCase()}`} />
              </li>
            ))}
          </ul>
          <p className="rc-hint rc-hint--card">
            <Info size={13} /> Business details are edited in Settings → Business. This page only chooses what is printed.
          </p>
        </section>

        {/* Text */}
        <section className="rc-card">
          <header className="rc-card__head">
            <div>
              <h2>
                <MessageSquareText size={16} /> Receipt Text
              </h2>
              <p>Headings and messages printed on every receipt.</p>
            </div>
          </header>
          <div className="rc-text">
            {TEXT_FIELDS.map((f) => {
              const max = RECEIPT_TEXT_LIMITS[f.key];
              const props = {
                id: `rc-${f.key}`,
                className: 'input',
                maxLength: max,
                value: form[f.key],
                placeholder: f.key === 'smallPrint' ? 'Optional' : undefined,
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set({ [f.key]: e.target.value }),
              };
              return (
                <div key={f.key} className={`field ${f.multiline ? 'rc-text__wide' : ''}`} data-text={f.key}>
                  <label className="field__label rc-text__label" htmlFor={`rc-${f.key}`}>
                    {f.label}
                    <span>
                      {form[f.key].length}/{max}
                    </span>
                  </label>
                  {f.multiline ? <textarea rows={2} {...props} /> : <input {...props} />}
                  <span className="field__hint">{f.hint}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Transaction info */}
        <section className="rc-card">
          <header className="rc-card__head">
            <div>
              <h2>
                <FileText size={16} /> Transaction Information
              </h2>
              <p>Choose which order and payment details appear on the receipt.</p>
            </div>
          </header>
          <ul className="rc-grid">
            {TRANSACTION_TOGGLES.map(({ key, label, icon: Icon }) => (
              <li key={key} className="rc-row" data-toggle={key}>
                <Icon size={15} className="rc-row__icon" />
                <div>
                  <strong>{label}</strong>
                </div>
                <Toggle checked={form[key]} onChange={(v) => set({ [key]: v })} label={label} />
              </li>
            ))}
          </ul>
          {form.showTax && !rate && (
            <p className="rc-hint rc-hint--card">
              <Info size={13} /> Tax is off in Settings → Tax, so no tax line is printed.
            </p>
          )}
        </section>

        <p className="rc-note">
          <Info size={14} /> Receipt settings control displayed receipt information. Completed transaction records remain unchanged.
        </p>
      </div>

      {/* Preview */}
      <aside className="rc-side">
        <section className="rc-card">
          <header className="rc-card__head">
            <div>
              <h2>
                <ReceiptText size={16} /> Live Receipt Preview
              </h2>
              <p>Sample order for illustration only.</p>
            </div>
            <Badge tone="success" dot>
              Live
            </Badge>
          </header>
          <div className="rc-preview-wrap">
            <div className={`rc-paper ${printed ? 'rc-paper--printed' : 'rc-paper--digital'}`} aria-label="Receipt preview" data-testid="receipt-preview">
              <div className="rc-paper__head">
                {showLogoInPreview && <img className="rc-paper__logo" src={form.logo!.dataUrl} alt="" data-pv="logo" />}
                {form.showBusinessName && <strong data-pv="name">{business.name.trim() || 'Your Business Name'}</strong>}
                {form.showAddress && <span data-pv="address">{business.address.trim() || 'Business address'}</span>}
                {(form.showPhone || form.showEmail) && (
                  <span data-pv="contact">
                    {[form.showPhone && (business.phone.trim() || 'Contact number'), form.showEmail && (business.email.trim() || 'email@business')].filter(Boolean).join(' · ')}
                  </span>
                )}
                {form.showTax && rate > 0 && tax.registrationNumber.trim() && <span data-pv="taxreg">Tax Reg. No. {tax.registrationNumber.trim()}</span>}
              </div>
              {form.heading.trim() && (
                <div className="rc-paper__heading" data-pv="heading">
                  {form.heading.trim()}
                </div>
              )}
              <div className="rc-paper__meta">
                {form.showReference && (
                  <span data-pv="reference">
                    <b>Receipt</b> RCPT-000001
                  </span>
                )}
                {form.showOrderNumber && (
                  <span data-pv="order">
                    <b>Order</b> #0001 · Dine In
                  </span>
                )}
                {form.showDateTime && (
                  <span data-pv="datetime">
                    <b>Date</b> {now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                {form.showCashier && (
                  <span data-pv="cashier">
                    <b>Cashier</b> Sample Cashier
                  </span>
                )}
                {form.showTerminal && (
                  <span data-pv="terminal">
                    <b>Terminal</b> REG-01
                  </span>
                )}
                {form.showCustomer && (
                  <span data-pv="customer">
                    <b>Customer</b> Sample Customer
                  </span>
                )}
              </div>
              <div className="rc-paper__items">
                {SAMPLE_LINES.map((l) => (
                  <div key={l.name} className="rc-paper__item">
                    <div>
                      <span>
                        {l.qty} × {l.name}
                      </span>
                      <b>{money(l.qty * l.price)}</b>
                    </div>
                    {l.option && <em>↳ {l.option}</em>}
                  </div>
                ))}
              </div>
              <div className="rc-paper__totals">
                <div>
                  <span>Subtotal</span>
                  <span>{money(subtotal)}</span>
                </div>
                {form.showDiscount && (
                  <div data-pv="discount">
                    <span>Discount</span>
                    <span>−{money(SAMPLE_DISCOUNT)}</span>
                  </div>
                )}
                {form.showTax && rate > 0 && (
                  <div data-pv="tax">
                    <span>{taxLabel}</span>
                    <span>{money(taxAmount)}</span>
                  </div>
                )}
                <div className="rc-paper__total">
                  <span>TOTAL</span>
                  <span>{money(total)}</span>
                </div>
              </div>
              {form.showPaymentMethod && (
                <div className="rc-paper__payment" data-pv="payment">
                  <div>
                    <span>Payment</span>
                    <span>Cash</span>
                  </div>
                  <div>
                    <span>Cash received</span>
                    <span>{money(Math.ceil(total / 100) * 100)}</span>
                  </div>
                  <div>
                    <span>Change</span>
                    <span>{money(Math.ceil(total / 100) * 100 - total)}</span>
                  </div>
                </div>
              )}
              <div className="rc-paper__foot">
                {form.thankYou.trim() && (
                  <strong data-pv="thankyou">{form.thankYou.trim()}</strong>
                )}
                {form.footer.trim() && <span data-pv="footer">{form.footer.trim()}</span>}
                {form.smallPrint.trim() && <small data-pv="smallprint">{form.smallPrint.trim()}</small>}
              </div>
            </div>
          </div>
          <p className="rc-preview__caption">
            <Info size={12} /> Sample items and values — not a real transaction.
          </p>
        </section>
      </aside>

      <footer className="rc-actions">
        <span className="rc-actions__state">
          {dirty ? 'You have unsaved changes.' : savedAt ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : 'Using the default receipt layout.'}
        </span>
        <div className="rc-actions__buttons">
          <Button icon={<RotateCcw size={15} />} disabled={same(form, RECEIPT_DEFAULTS)} onClick={() => setConfirmReset(true)}>
            Reset to Defaults
          </Button>
          <Button
            disabled={!dirty}
            onClick={() => {
              setForm(saved);
              setLogoError(null);
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
        title="Reset receipt settings to defaults?"
        message="The logo is removed, display options return to their defaults, and receipt text is reset. Nothing changes until you Save Changes."
        confirmLabel="Reset Receipts"
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

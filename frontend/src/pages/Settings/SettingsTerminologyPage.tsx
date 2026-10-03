import { useCallback, useState, useEffect } from 'react';
import { BookA, CheckCircle2, Info, MonitorSmartphone, Plus, Receipt, RotateCcw, Save, ShieldCheck, Tags, Users } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import {
  MAX_TERM_LENGTH,
  TERMINOLOGY_DEFAULTS,
  TERMS,
  plural,
  saveTerminologySettings,
  termFor,
  useTerminologySettings,
  type TermKey,
  type Terminology,
} from '../../stores/terminologySettingsStore';
import { errorMessage } from '../../services/api';
import '../../components/settings/settingsTerminology.css';

const sameTerms = (a: Terminology, b: Terminology) => TERMS.every(({ key }) => a[key].trim() === b[key].trim());

// Displayed wording only. Edits update the live preview immediately and are
// saved to the `terminology` settings section.
export default function SettingsTerminologyPage() {
  const { terms: saved, savedAt } = useTerminologySettings();
  const [form, setForm] = useState<Terminology>(saved);
  // Show the server copy once it loads (and after each save).
  useEffect(() => setForm(saved), [saved]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const setTerm = (key: TermKey, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const isCustom = (key: TermKey) => {
    const v = form[key].trim();
    return v !== '' && v !== TERMS.find((t) => t.key === key)!.label;
  };
  const overrides = TERMS.filter((t) => isCustom(t.key)).length;
  const dirty = !sameTerms(form, saved);
  const w = (key: TermKey) => termFor(form, key);

  const save = async () => {
    try {
      await saveTerminologySettings(form);
      setFeedback('Terminology saved');
    } catch (e) {
      setFeedback(errorMessage(e));
    }
  };


  const reset = () => {
    setForm(TERMINOLOGY_DEFAULTS);
    setConfirmReset(false);
    setFeedback('Terminology reset to defaults — Save Changes to apply');
  };

  return (
    <div className="settings-terminology">
      <div className="tm-main">
        <section className="tm-card">
          <header className="tm-card__head">
            <div>
              <h2>
                <BookA size={16} /> Core Terms &amp; Vocabulary
                <Badge tone={overrides ? 'warning' : 'neutral'}>{overrides ? `${overrides} Override${overrides === 1 ? '' : 's'} Applied` : 'All Defaults'}</Badge>
              </h2>
              <p>Rename the words shown across the register, orders, admin screens, and receipts. Leave a term blank to keep the default.</p>
            </div>
          </header>

          <div className="tm-table" role="table" aria-label="Terminology">
            <div className="tm-row tm-row--head" role="row">
              <span role="columnheader">Default Term</span>
              <span role="columnheader">Display Term</span>
              <span role="columnheader">Where It Appears</span>
              <span role="columnheader" className="tm-col-action">Reset</span>
            </div>
            {TERMS.map((t) => {
              const custom = isCustom(t.key);
              return (
                <div key={t.key} className="tm-row" role="row" data-term={t.key}>
                  <div className="tm-term" role="cell">
                    <span className="tm-term__initial">{t.label[0]}</span>
                    <div>
                      <strong>{t.label}</strong>
                      <code>{t.systemKey}</code>
                    </div>
                  </div>
                  <div className="tm-input" role="cell">
                    <input
                      className="input"
                      aria-label={`Display term for ${t.label}`}
                      placeholder={t.label}
                      maxLength={MAX_TERM_LENGTH}
                      value={form[t.key]}
                      onChange={(e) => setTerm(t.key, e.target.value)}
                    />
                    <span className={`tm-state ${custom ? 'tm-state--active' : ''}`}>{custom ? 'Custom' : 'Default'}</span>
                  </div>
                  <p className="tm-context" role="cell">
                    {t.context}
                  </p>
                  <div className="tm-col-action" role="cell">
                    {custom || form[t.key] !== '' ? (
                      <button type="button" className="tm-reset" title={`Reset ${t.label} to default`} aria-label={`Reset ${t.label} to default`} onClick={() => setTerm(t.key, '')}>
                        <RotateCcw size={15} />
                      </button>
                    ) : (
                      <CheckCircle2 size={16} className="tm-default-icon" aria-label="Using default" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <p className="tm-note">
          <ShieldCheck size={15} />
          <span>
            <strong>Information Note</strong>
            Terminology changes affect displayed labels only. They do not change system functionality, database structure, or stored records.
          </span>
        </p>
      </div>

      <aside className="tm-side">
        <section className="tm-card">
          <header className="tm-card__head">
            <div>
              <h2>
                <MonitorSmartphone size={16} /> Live Terminology Preview
              </h2>
              <p>How your wording appears in BrewSync. Updates as you type.</p>
            </div>
            <Badge tone="success" dot>
              Live
            </Badge>
          </header>

          <div className="tm-preview">
            <div className="tm-surface">
              <span className="tm-surface__label">Register</span>
              <div className="tm-surface__row">
                <span className="tm-chip tm-chip--active">{plural(w('category'))}</span>
                <button type="button" className="tm-pv-btn" tabIndex={-1} data-pv="add-product">
                  <Plus size={13} /> Add {w('product')}
                </button>
              </div>
            </div>

            <div className="tm-surface">
              <span className="tm-surface__label">Orders</span>
              <div className="tm-surface__row">
                <span className="tm-ticket" data-pv="order">{w('order')} #1024</span>
                <span className="tm-muted" data-pv="customer">{w('customer')} Information</span>
              </div>
            </div>

            <div className="tm-surface">
              <span className="tm-surface__label">Admin</span>
              <div className="tm-surface__row">
                <span className="tm-admin" data-pv="staff">
                  <Users size={14} /> {w('staff')} Management
                </span>
                <span className="tm-admin">
                  <Tags size={14} /> {plural(w('category'))}
                </span>
              </div>
            </div>

            <div className="tm-receipt" data-pv="receipt">
              <div className="tm-receipt__head">
                <Receipt size={13} /> <strong>{w('receipt')}</strong>
                <span>{w('order')} #1024</span>
              </div>
              <div className="tm-receipt__line">
                <span>{w('customer')}:</span>
                <span>—</span>
              </div>
              <div className="tm-receipt__line">
                <span>1× Sample {w('product')}</span>
                <span>—</span>
              </div>
              <div className="tm-receipt__line">
                <span>{w('staff')}:</span>
                <span>—</span>
              </div>
            </div>
          </div>
          <p className="tm-preview__caption">
            <Info size={12} /> Sample labels only — no real orders or records are shown.
          </p>
        </section>
      </aside>

      <footer className="tm-actions">
        <span className="tm-actions__state">
          {dirty ? 'You have unsaved changes.' : savedAt ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : 'Using BrewSync default terminology.'}
        </span>
        <div className="tm-actions__buttons">
          <Button icon={<RotateCcw size={15} />} disabled={sameTerms(form, TERMINOLOGY_DEFAULTS)} onClick={() => setConfirmReset(true)}>
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
        title="Reset terminology to defaults?"
        message="All custom terms are cleared and BrewSync’s default wording returns. Nothing changes until you Save Changes."
        confirmLabel="Reset Terminology"
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

import { useEffect, useCallback, useMemo, useState } from 'react';
import { CheckCircle2, CircleOff, Info, Layers, MonitorSmartphone, Pencil, Plus, RotateCcw, Save, Tag, Trash2, Users } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Drawer from '../../components/ui/Drawer';
import EmptyState from '../../components/ui/EmptyState';
import SearchBar from '../../components/ui/SearchBar';
import Tabs from '../../components/ui/Tabs';
import Toggle from '../../components/ui/Toggle';
import DiscountForm, { toFormValues, validateDiscount, type DiscountFormErrors, type DiscountFormValues } from '../../components/settings/DiscountForm';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { useBusinessSettings } from '../../stores/businessSettingsStore';
import { parseRate, useTaxSettings } from '../../stores/taxSettingsStore';
import { errorMessage } from '../../services/api';
import {
  EMPTY_DISCOUNT,
  eligibilityLabel,
  newDiscountId,
  previewDiscount,
  saveDiscountSettings,
  useDiscountSettings,
  type Discount,
} from '../../stores/discountSettingsStore';
import '../../components/settings/settingsDiscounts.css';

// Sample figure for the checkout preview only.
const SAMPLE_SUBTOTAL = 500;

type Filter = 'all' | 'active' | 'inactive';

const sameList = (a: Discount[], b: Discount[]) => a.length === b.length && a.every((d, i) => d === b[i]);

// Discount definitions (GET/POST /discounts). Starts empty; the server's discount engine
// applies eligibility and computes every real order.
export default function SettingsDiscountsPage() {
  const { discounts: saved, savedAt } = useDiscountSettings();
  const { settings: business } = useBusinessSettings();
  const { settings: tax } = useTaxSettings();
  const [list, setList] = useState<Discount[]>(saved);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<{ id: string | null; values: DiscountFormValues } | null>(null);
  const [formErrors, setFormErrors] = useState<DiscountFormErrors>({});
  const [deleting, setDeleting] = useState<Discount | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const cur = business.currencySymbol || '₱';
  const money = (n: number) => `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const amountLabel = (d: Pick<Discount, 'type' | 'amount'>) => (d.type === 'percentage' ? `${d.amount}%` : money(d.amount));

  const active = list.filter((d) => d.active);
  const dirty = !sameList(list, saved);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter(
      (d) =>
        (filter === 'all' || (filter === 'active') === d.active) &&
        (!q || d.name.toLowerCase().includes(q) || eligibilityLabel(d).toLowerCase().includes(q)),
    );
  }, [list, query, filter]);

  const openAdd = () => {
    setFormErrors({});
    setEditing({ id: null, values: toFormValues(EMPTY_DISCOUNT) });
  };
  const openEdit = (d: Discount) => {
    setFormErrors({});
    setEditing({ id: d.id, values: toFormValues(d) });
  };

  const submit = () => {
    if (!editing) return;
    const taken = list.filter((d) => d.id !== editing.id).map((d) => d.name.toLowerCase());
    const { errors, draft } = validateDiscount(editing.values, taken);
    setFormErrors(errors);
    if (!draft) return;
    const now = new Date();
    if (editing.id) {
      setList((l) => l.map((d) => (d.id === editing.id ? { ...d, ...draft, updatedAt: now } : d)));
      setFeedback(`“${draft.name}” updated — Save Changes to apply`);
    } else {
      const id = newDiscountId();
      setList((l) => [...l, { ...draft, id, createdAt: now, updatedAt: now }]);
      setPreviewId(id);
      setFeedback(`“${draft.name}” added — Save Changes to apply`);
    }
    setEditing(null);
  };

  const setActive = (id: string, value: boolean) => setList((l) => l.map((d) => (d.id === id ? { ...d, active: value, updatedAt: new Date() } : d)));

  const save = async () => {
    try {
      await saveDiscountSettings(list);
      setFeedback('Discounts saved');
    } catch (e) {
      setFeedback(errorMessage(e));
    }
  };
  // Adopt the server list whenever it (re)loads.
  useEffect(() => setList(saved), [saved]);

  // Preview uses the Tax settings rate/mode when tax is turned on.
  const rate = tax.enabled ? (parseRate(tax.rate) ?? 0) / 100 : 0;
  const taxName = tax.name.trim() || 'Tax';
  const selected = active.find((d) => d.id === previewId) ?? active[0] ?? null;
  const calc = previewDiscount(selected, SAMPLE_SUBTOTAL, rate, tax.mode === 'included');

  // Live preview of the form while editing, so changes to type/amount/tax handling show immediately.
  const formPreview = useMemo(() => {
    if (!editing) return null;
    const v = editing.values;
    const amount = Number(v.amount);
    if (!(amount > 0)) return null;
    const min = v.minOrder.trim() === '' ? null : Number(v.minOrder);
    const max = v.maxDiscount.trim() === '' ? null : Number(v.maxDiscount);
    return previewDiscount({ type: v.type, amount: v.type === 'percentage' ? Math.min(amount, 100) : amount, minOrder: Number.isFinite(min) ? min : null, maxDiscount: Number.isFinite(max) && max! > 0 ? max : null, taxHandling: v.taxHandling }, SAMPLE_SUBTOTAL, rate, tax.mode === 'included');
  }, [editing, rate, tax.mode]);

  return (
    <div className="settings-discounts">
      <div className="ds-main">
        {/* Summary */}
        <section className="ds-card ds-summary" aria-label="Discount summary">
          <div className="ds-stat" data-stat="active">
            <span className="ds-stat__icon ds-stat__icon--on">
              <CheckCircle2 size={16} />
            </span>
            <div>
              <strong>{active.length}</strong>
              <span>Active Discounts</span>
            </div>
          </div>
          <div className="ds-stat" data-stat="inactive">
            <span className="ds-stat__icon">
              <CircleOff size={16} />
            </span>
            <div>
              <strong>{list.length - active.length}</strong>
              <span>Inactive Discounts</span>
            </div>
          </div>
          <div className="ds-stat" data-stat="total">
            <span className="ds-stat__icon">
              <Layers size={16} />
            </span>
            <div>
              <strong>{list.length}</strong>
              <span>Total Discounts</span>
            </div>
          </div>
          <Button variant="primary" icon={<Plus size={15} />} onClick={openAdd} className="ds-add">
            Add Discount
          </Button>
        </section>

        {/* List */}
        <section className="ds-card">
          <header className="ds-list__head">
            <h2>
              <Tag size={15} /> Configured Discounts
            </h2>
            {list.length > 0 && (
              <div className="ds-list__tools">
                <SearchBar placeholder="Search discounts…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search discounts" />
                <Tabs
                  variant="chips"
                  value={filter}
                  onChange={(v) => setFilter(v as Filter)}
                  items={[
                    { value: 'all', label: 'All', count: list.length },
                    { value: 'active', label: 'Active', count: active.length },
                    { value: 'inactive', label: 'Inactive', count: list.length - active.length },
                  ]}
                />
              </div>
            )}
          </header>

          {list.length === 0 ? (
            <EmptyState
              icon={<Tag size={22} />}
              title="No discounts configured yet"
              description="Create a discount to make promotional pricing available during checkout."
              action={
                <Button variant="primary" icon={<Plus size={15} />} onClick={openAdd}>
                  Add Discount
                </Button>
              }
            />
          ) : shown.length === 0 ? (
            <EmptyState title="No matching discounts" description="Try another search or filter." />
          ) : (
            <ol className="ds-list">
              {shown.map((d) => (
                <li key={d.id} className={`ds-row ${d.active ? '' : 'ds-row--off'}`} data-discount={d.name}>
                  <span className="ds-row__num">{list.indexOf(d) + 1}</span>
                  <div className="ds-row__body">
                    <div className="ds-row__title">
                      <strong>{d.name}</strong>
                      <Badge tone={d.active ? 'success' : 'neutral'}>{d.active ? 'Active' : 'Inactive'}</Badge>
                      <span className="ds-chip">
                        {d.type === 'percentage' ? 'Percentage' : 'Fixed Amount'} · {amountLabel(d)}
                      </span>
                    </div>
                    <p className="ds-row__meta">
                      <span>
                        <Users size={12} /> Eligibility: {eligibilityLabel(d)}
                      </span>
                      <span>Min Order: {d.minOrder === null ? 'None' : money(d.minOrder)}</span>
                      <span>Max: {d.maxDiscount === null ? 'No cap' : money(d.maxDiscount)}</span>
                    </p>
                  </div>
                  <div className="ds-row__actions">
                    <Button size="sm" icon={<Pencil size={13} />} onClick={() => openEdit(d)} aria-label={`Edit ${d.name}`}>
                      Edit
                    </Button>
                    <button type="button" className="ds-delete" aria-label={`Delete ${d.name}`} title="Delete" onClick={() => setDeleting(d)}>
                      <Trash2 size={14} />
                    </button>
                    <Toggle checked={d.active} onChange={(v) => setActive(d.id, v)} label={`${d.name} ${d.active ? 'active' : 'inactive'}`} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <p className="ds-note">
          <Info size={14} /> Discounts are defined here and applied by staff at checkout. Eligibility (for example Senior Citizen or PWD ID checks) is not verified automatically yet.
        </p>
      </div>

      {/* POS preview */}
      <aside className="ds-side">
        <section className="ds-card">
          <header className="ds-card__head">
            <div>
              <h2>
                <MonitorSmartphone size={16} /> POS Discount Preview
              </h2>
              <p>How active discounts appear to staff at checkout.</p>
            </div>
            <Badge tone="success" dot>
              Live
            </Badge>
          </header>
          <div className="ds-preview">
            <span className="ds-preview__label">Available Discounts</span>
            {active.length === 0 ? (
              <p className="ds-preview__empty">{list.length ? 'No active discounts. Turn a discount on to show it here.' : 'Active discounts will appear here.'}</p>
            ) : (
              <div className="ds-options" role="radiogroup" aria-label="Preview discounts">
                {active.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={selected?.id === d.id}
                    className={`ds-option ${selected?.id === d.id ? 'ds-option--active' : ''}`}
                    data-option={d.name}
                    onClick={() => setPreviewId(d.id)}
                  >
                    <span>
                      <strong>{d.name}</strong>
                      <em>{eligibilityLabel(d)}</em>
                    </span>
                    <b>{amountLabel(d)}</b>
                  </button>
                ))}
              </div>
            )}

            <span className="ds-preview__label">Example Calculation</span>
            <dl className="ds-calc" aria-label="Example calculation">
              <div data-row="subtotal">
                <dt>Subtotal</dt>
                <dd>{money(calc.subtotal)}</dd>
              </div>
              <div data-row="discount" className="ds-calc__discount">
                <dt>Discount{selected && calc.eligible ? ` (${selected.name}${calc.capped ? ', capped' : ''})` : ''}</dt>
                <dd>−{money(calc.discount)}</dd>
              </div>
              <div data-row="tax">
                <dt>
                  {rate ? `${taxName} (${Math.round(rate * 10000) / 100}%${tax.mode === 'included' ? ' incl.' : ''})` : 'Tax'}
                </dt>
                <dd>{money(calc.tax)}</dd>
              </div>
              <div data-row="total" className="ds-calc__total">
                <dt>Total</dt>
                <dd>{money(calc.total)}</dd>
              </div>
            </dl>
            {selected && !calc.eligible && <p className="ds-preview__hint">This sample order is below the {money(selected.minOrder ?? 0)} minimum, so the discount does not apply.</p>}
            <p className="ds-preview__hint">
              <Info size={12} /> Sample {money(SAMPLE_SUBTOTAL)} order.{' '}
              {rate ? `Tax uses your Tax settings (${tax.mode === 'included' ? 'included in prices' : 'added at checkout'}).` : 'Tax is off in Tax settings, so tax shows as zero.'} Not a real transaction.
            </p>
          </div>
        </section>
      </aside>

      <footer className="ds-actions">
        <span className="ds-actions__state">
          {dirty ? 'You have unsaved changes.' : savedAt ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : saved.length ? `${saved.length} saved discount${saved.length === 1 ? '' : 's'}.` : 'No discounts saved yet.'}
        </span>
        <div className="ds-actions__buttons">
          <Button icon={<RotateCcw size={15} />} disabled={list.length === 0} onClick={() => setConfirmReset(true)}>
            Reset to Defaults
          </Button>
          <Button disabled={!dirty} onClick={() => setList(saved)}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Save size={15} />} disabled={!dirty} onClick={() => void save()}>
            Save Changes
          </Button>
        </div>
      </footer>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit Discount' : 'Add Discount'}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={submit}>
              {editing?.id ? 'Update Discount' : 'Add Discount'}
            </Button>
          </>
        }
      >
        {editing && (
          <>
            <DiscountForm values={editing.values} errors={formErrors} currency={cur} onChange={(patch) => setEditing((e) => e && { ...e, values: { ...e.values, ...patch } })} />
            <div className="discount-form__preview" aria-label="Form preview">
              <span>On a sample {money(SAMPLE_SUBTOTAL)} order</span>
              {formPreview ? (
                formPreview.eligible ? (
                  <b>
                    −{money(formPreview.discount)} → {money(formPreview.total)}
                  </b>
                ) : (
                  <b>Below minimum order</b>
                )
              ) : (
                <b>Enter an amount</b>
              )}
            </div>
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={deleting !== null}
        title={`Remove “${deleting?.name ?? ''}”?`}
        message={`${deleting?.name ?? 'This discount'} will no longer be available at checkout. A saved discount is kept as inactive so past orders still show it.`}
        confirmLabel="Remove Discount"
        danger
        onConfirm={() => {
          if (deleting) setList((l) => l.filter((d) => d.id !== deleting.id));
          setFeedback(`“${deleting?.name}” removed — Save Changes to apply`);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={confirmReset}
        title="Remove all discounts?"
        message={`All ${list.length} discount${list.length === 1 ? '' : 's'} are removed and the list returns to empty. Nothing changes until you Save Changes.`}
        confirmLabel="Remove All"
        danger
        onConfirm={() => {
          setList([]);
          setConfirmReset(false);
          setFeedback('Discounts reset to defaults — Save Changes to apply');
        }}
        onCancel={() => setConfirmReset(false)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

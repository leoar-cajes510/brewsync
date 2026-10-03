import Input from '../ui/Input';
import Select from '../ui/Select';
import Tabs from '../ui/Tabs';
import Toggle from '../ui/Toggle';
import {
  DISCOUNT_TYPES,
  ELIGIBILITY_OPTIONS,
  type DiscountDraft,
  type DiscountType,
  type Eligibility,
  type TaxHandling,
} from '../../stores/discountSettingsStore';

export type DiscountFormErrors = Partial<Record<'name' | 'amount' | 'customEligibility' | 'minOrder' | 'maxDiscount', string>>;

/** Text values while typing; converted to a DiscountDraft on submit. */
export interface DiscountFormValues {
  name: string;
  type: DiscountType;
  amount: string;
  eligibility: Eligibility;
  customEligibility: string;
  taxHandling: TaxHandling;
  minOrder: string;
  maxDiscount: string;
  active: boolean;
}

export const toFormValues = (d: DiscountDraft): DiscountFormValues => ({
  ...d,
  amount: d.amount ? String(d.amount) : '',
  minOrder: d.minOrder === null ? '' : String(d.minOrder),
  maxDiscount: d.maxDiscount === null ? '' : String(d.maxDiscount),
});

const MONEY = /^\d+(\.\d{1,2})?$/;

export function validateDiscount(v: DiscountFormValues, takenNames: string[]): { errors: DiscountFormErrors; draft: DiscountDraft | null } {
  const errors: DiscountFormErrors = {};
  const name = v.name.trim();
  if (!name) errors.name = 'Discount name is required.';
  else if (takenNames.includes(name.toLowerCase())) errors.name = 'A discount with this name already exists.';

  const amount = Number(v.amount);
  if (v.amount.trim() === '') errors.amount = v.type === 'percentage' ? 'Enter a percentage.' : 'Enter a discount amount.';
  else if (v.type === 'percentage' && (!Number.isFinite(amount) || amount <= 0 || amount > 100)) errors.amount = 'Enter a percentage greater than 0 and up to 100.';
  else if (v.type === 'fixed' && (!MONEY.test(v.amount.trim()) || amount <= 0)) errors.amount = 'Enter an amount greater than 0 (up to 2 decimals).';

  if (v.eligibility === 'custom' && !v.customEligibility.trim()) errors.customEligibility = 'Name who this discount is for.';

  const optionalMoney = (raw: string, key: 'minOrder' | 'maxDiscount') => {
    if (raw.trim() === '') return null;
    if (!MONEY.test(raw.trim())) {
      errors[key] = 'Enter a valid amount (up to 2 decimals), or leave blank.';
      return null;
    }
    return Number(raw);
  };
  const minOrder = optionalMoney(v.minOrder, 'minOrder');
  const maxDiscount = optionalMoney(v.maxDiscount, 'maxDiscount');
  if (maxDiscount === 0) errors.maxDiscount = 'Leave blank for no cap, or enter an amount above 0.';
  if (v.type === 'fixed' && maxDiscount !== null && !errors.amount && maxDiscount < amount) errors.maxDiscount = 'The cap is lower than the discount amount.';

  if (Object.keys(errors).length) return { errors, draft: null };
  return {
    errors,
    draft: {
      name,
      type: v.type,
      amount,
      eligibility: v.eligibility,
      customEligibility: v.eligibility === 'custom' ? v.customEligibility.trim() : '',
      taxHandling: v.taxHandling,
      minOrder,
      maxDiscount,
      active: v.active,
    },
  };
}

interface DiscountFormProps {
  values: DiscountFormValues;
  errors: DiscountFormErrors;
  currency: string;
  onChange: (patch: Partial<DiscountFormValues>) => void;
}

// Shared Add / Edit discount form.
export default function DiscountForm({ values: v, errors, currency, onChange }: DiscountFormProps) {
  const pct = v.type === 'percentage';
  return (
    <div className="discount-form">
      <Input label="Discount Name" placeholder="e.g. Senior Citizen, Student, Loyalty" maxLength={40} value={v.name} error={errors.name} onChange={(e) => onChange({ name: e.target.value })} />

      <div className="field">
        <span className="field__label">Discount Type</span>
        <Tabs
          items={DISCOUNT_TYPES.map((t) => ({ value: t.value, label: t.value === 'percentage' ? 'Percentage (%)' : `Fixed Amount (${currency})` }))}
          value={v.type}
          onChange={(type) => onChange({ type: type as DiscountType })}
        />
      </div>

      <div className={`field discount-form__amount ${errors.amount ? 'discount-form__amount--error' : ''}`}>
        <label className="field__label" htmlFor="discount-amount">
          {pct ? 'Discount Rate' : 'Discount Amount'}
        </label>
        <div className="discount-form__affix">
          {!pct && <span className="discount-form__prefix">{currency}</span>}
          <input
            id="discount-amount"
            className={`input ${errors.amount ? 'input--error' : ''} ${pct ? 'discount-form__input--suffix' : 'discount-form__input--prefix'}`}
            inputMode="decimal"
            placeholder={pct ? 'e.g. 20' : '0.00'}
            value={v.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
          />
          {pct && <span className="discount-form__suffix">%</span>}
        </div>
        {errors.amount ? (
          <span className="field__error">{errors.amount}</span>
        ) : (
          <span className="field__hint">{pct ? 'Between 0 and 100.' : 'A set amount taken off the order.'}</span>
        )}
      </div>

      <Select
        label="Eligibility"
        options={ELIGIBILITY_OPTIONS}
        value={v.eligibility}
        onChange={(e) => onChange({ eligibility: e.target.value as Eligibility })}
      />
      {v.eligibility === 'custom' && (
        <Input label="Custom Eligibility" placeholder="e.g. Loyalty Members, Employees" maxLength={30} value={v.customEligibility} error={errors.customEligibility} onChange={(e) => onChange({ customEligibility: e.target.value })} />
      )}

      {/* Tax is always computed on the discounted amount (R5.5, Q-TAX-2); the former per-discount
          "Tax Handling" control is superseded and not part of the backend discount model (C-12). */}
      <p className="field__hint">Tax is calculated on the discounted amount.</p>

      <div className="discount-form__row">
        <Input label={`Minimum Order Amount (${currency})`} placeholder="No minimum" inputMode="decimal" value={v.minOrder} error={errors.minOrder} onChange={(e) => onChange({ minOrder: e.target.value })} />
        <Input label={`Maximum Discount Amount (${currency})`} placeholder="No cap" inputMode="decimal" value={v.maxDiscount} error={errors.maxDiscount} onChange={(e) => onChange({ maxDiscount: e.target.value })} />
      </div>

      <div className="discount-form__status">
        <div>
          <strong>Status</strong>
          <span>{v.active ? 'Active — available at checkout.' : 'Inactive — hidden at checkout, kept in this list.'}</span>
        </div>
        <Toggle checked={v.active} onChange={(active) => onChange({ active })} label={v.active ? 'Active' : 'Inactive'} />
      </div>
    </div>
  );
}

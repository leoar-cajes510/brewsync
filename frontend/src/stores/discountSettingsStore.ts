import { useEffect, useSyncExternalStore } from 'react';
import type { DiscountDto } from '../types/api';
import { api } from '../services/api';
import { listDiscounts } from '../services/productService';

// Discounts (Settings → Discounts), loaded from GET /discounts and created with
// POST /discounts. BrewSync starts with zero discounts. previewDiscount() only drives
// the settings preview — the server's discount engine computes every real order.

export type DiscountType = 'percentage' | 'fixed';
export type Eligibility = 'all' | 'senior' | 'pwd' | 'student' | 'custom';
export type TaxHandling = 'beforeTax' | 'afterTax' | 'notApplicable';

export interface Discount {
  id: string;
  name: string;
  type: DiscountType;
  /** Percent (0–100] for percentage, money amount for fixed. */
  amount: number;
  eligibility: Eligibility;
  /** Label used when eligibility is "custom". */
  customEligibility: string;
  taxHandling: TaxHandling;
  minOrder: number | null;
  maxDiscount: number | null;
  active: boolean;
  /** Audit preparation: when the definition was created / last changed. */
  createdAt: Date;
  updatedAt: Date;
}

export type DiscountDraft = Omit<Discount, 'id' | 'createdAt' | 'updatedAt'>;

export const DISCOUNT_TYPES: { value: DiscountType; label: string }[] = [
  { value: 'percentage', label: 'Percentage' },
  { value: 'fixed', label: 'Fixed Amount' },
];

export const ELIGIBILITY_OPTIONS: { value: Eligibility; label: string }[] = [
  { value: 'all', label: 'All Customers' },
  { value: 'senior', label: 'Senior Citizen' },
  { value: 'pwd', label: 'PWD' },
  { value: 'student', label: 'Student' },
  { value: 'custom', label: 'Custom' },
];

export const TAX_HANDLING_OPTIONS: { value: TaxHandling; label: string; description: string }[] = [
  { value: 'beforeTax', label: 'Before Tax', description: 'Discount is taken first; tax is calculated on the discounted amount.' },
  { value: 'afterTax', label: 'After Tax', description: 'Tax is calculated first; the discount comes off the amount including tax.' },
  { value: 'notApplicable', label: 'Not Applicable', description: 'Discount does not change the tax; tax is based on the full amount.' },
];

export const eligibilityLabel = (d: Pick<Discount, 'eligibility' | 'customEligibility'>) =>
  d.eligibility === 'custom' ? d.customEligibility.trim() || 'Custom' : ELIGIBILITY_OPTIONS.find((o) => o.value === d.eligibility)!.label;

export const taxHandlingLabel = (t: TaxHandling) => TAX_HANDLING_OPTIONS.find((o) => o.value === t)!.label;

export const EMPTY_DISCOUNT: DiscountDraft = {
  name: '',
  type: 'percentage',
  amount: 0,
  eligibility: 'all',
  customEligibility: '',
  taxHandling: 'beforeTax',
  minOrder: null,
  maxDiscount: null,
  active: true,
};

/* ------------------------------ Preview math ------------------------------ */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface DiscountPreview {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** False when the order is below the minimum order amount. */
  eligible: boolean;
  capped: boolean;
}

/** Discount value for a base amount, applying the maximum cap. */
function discountOn(d: Pick<Discount, 'type' | 'amount' | 'maxDiscount'>, base: number) {
  const raw = d.type === 'percentage' ? (base * d.amount) / 100 : d.amount;
  const capped = d.maxDiscount !== null && raw > d.maxDiscount;
  return { value: round2(Math.min(capped ? d.maxDiscount! : raw, base)), capped };
}

/**
 * Example checkout math.
 * taxRate is a fraction (0.12) or 0 when tax is off; taxIncluded mirrors the
 * Tax settings pricing mode (prices already contain tax).
 */
export function previewDiscount(
  d: Pick<Discount, 'type' | 'amount' | 'maxDiscount' | 'minOrder' | 'taxHandling'> | null,
  subtotal: number,
  taxRate: number,
  taxIncluded: boolean,
): DiscountPreview {
  const r = taxRate;
  const plainTax = taxIncluded ? round2(subtotal - subtotal / (1 + r)) : round2(subtotal * r);
  const plainTotal = taxIncluded ? subtotal : round2(subtotal + plainTax);
  const none = { subtotal, discount: 0, tax: plainTax, total: plainTotal, capped: false };
  if (!d) return { ...none, eligible: true };
  if (d.minOrder !== null && subtotal < d.minOrder) return { ...none, eligible: false };

  if (d.taxHandling === 'beforeTax') {
    const net = taxIncluded ? round2(subtotal / (1 + r)) : subtotal;
    const { value, capped } = discountOn(d, net);
    const tax = round2((net - value) * r);
    return { subtotal, discount: value, tax, total: round2(net - value + tax), eligible: true, capped };
  }
  if (d.taxHandling === 'afterTax') {
    const { value, capped } = discountOn(d, plainTotal);
    return { subtotal, discount: value, tax: plainTax, total: round2(plainTotal - value), eligible: true, capped };
  }
  const { value, capped } = discountOn(d, subtotal);
  return { subtotal, discount: value, tax: plainTax, total: round2(plainTotal - value), eligible: true, capped };
}

/* ---------------------------------- Store --------------------------------- */

interface State {
  discounts: Discount[];
  savedAt: Date | null;
  error: string | null;
}

let state: State = { discounts: [], savedAt: null, error: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** How taxes interact with a discount is fixed by the server's pricing engine; this UI field is informational. */
function fromDto(d: DiscountDto): Discount {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    amount: Number(d.value),
    eligibility: d.eligibility as Eligibility,
    customEligibility: d.custom_eligibility,
    taxHandling: 'beforeTax',
    minOrder: d.min_order === null ? null : Number(d.min_order),
    maxDiscount: d.max_discount === null ? null : Number(d.max_discount),
    active: d.active,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function loadDiscounts(): Promise<void> {
  try {
    setState({ discounts: (await listDiscounts()).map(fromDto), error: null });
  } catch (e) {
    setState({ error: e instanceof Error ? e.message : 'Could not load discounts' });
  }
}

export function useDiscountSettings(): State {
  useEffect(() => {
    void loadDiscounts();
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

const same = (a: Discount, b: Discount) =>
  a.name === b.name && a.type === b.type && a.amount === b.amount && a.eligibility === b.eligibility &&
  a.customEligibility === b.customEligibility && a.minOrder === b.minOrder && a.maxDiscount === b.maxDiscount && a.active === b.active;

const body = (d: Discount) => ({
  name: d.name,
  type: d.type,
  value: String(d.amount),
  eligibility: d.eligibility,
  custom_eligibility: d.customEligibility,
  min_order: d.minOrder === null ? null : d.minOrder.toFixed(2),
  max_discount: d.maxDiscount === null ? null : d.maxDiscount.toFixed(2),
});

/**
 * Persists the edited list: new discounts are created (POST /discounts), edited ones updated
 * (PATCH /discounts/{id}) and removed ones deactivated (POST /discounts/{id}/deactivate) —
 * discounts are never hard-deleted because past orders reference them (Q-DEL-1). Each call is
 * validated by the server; the list is reloaded from the server afterwards.
 */
export async function saveDiscountSettings(discounts: Discount[]): Promise<void> {
  const serverIds = new Set(state.discounts.map((d) => d.id));
  try {
    for (const saved of state.discounts) {
      const next = discounts.find((d) => d.id === saved.id);
      if (!next) {
        if (saved.active) await api.post<DiscountDto>(`/discounts/${saved.id}/deactivate`, {});
      } else if (!same(saved, next)) {
        await api.patch<DiscountDto>(`/discounts/${saved.id}`, { ...body(next), active: next.active });
      }
    }
    for (const d of discounts.filter((x) => !serverIds.has(x.id))) {
      await api.post<DiscountDto>('/discounts', body(d));
    }
  } finally {
    await loadDiscounts();
  }
  setState({ savedAt: new Date() });
}

let seq = 0;
export const newDiscountId = () => `disc-${Date.now().toString(36)}-${(seq++).toString(36)}`;

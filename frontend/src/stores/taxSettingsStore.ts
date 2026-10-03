import { useEffect, useSyncExternalStore } from 'react';
import { getSection, putSection } from '../services/settingsService';

// Tax (Settings → Tax), stored in the `tax` settings section (GET/PUT /settings/tax,
// optimistic `version`). No real-world rate is assumed — the business owner enters the
// applicable name and rate. The server's tax engine computes every real total;
// calculateTax() here only drives the settings preview.

export type TaxMode = 'included' | 'excluded';

export interface TaxSettings {
  enabled: boolean;
  name: string;
  /** Percentage as typed, e.g. "12" or "7.5". Empty until configured. */
  rate: string;
  /** Optional tax registration number shown on receipts. */
  registrationNumber: string;
  mode: TaxMode;
  showOnReceipt: boolean;
  showRate: boolean;
  showBreakdown: boolean;
}

export const TAX_DEFAULTS: TaxSettings = {
  enabled: false,
  name: '',
  rate: '',
  registrationNumber: '',
  mode: 'included',
  showOnReceipt: true,
  showRate: true,
  showBreakdown: false,
};

export const MAX_TAX_RATE = 100;

/** Parsed rate as a number, or null if empty/invalid. */
export function parseRate(rate: string): number | null {
  if (rate.trim() === '') return null;
  const n = Number(rate);
  return Number.isFinite(n) && n >= 0 && n <= MAX_TAX_RATE ? n : null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface TaxBreakdown {
  itemTotal: number;
  discount: number;
  /** Amount after discount that tax applies to (as displayed on prices). */
  taxable: number;
  /** Net amount before tax. */
  net: number;
  tax: number;
  total: number;
  applied: boolean;
}

/**
 * Tax on (itemTotal − discount).
 * included: prices already contain tax → tax = taxable − taxable / (1 + r); total = taxable.
 * excluded: tax is added on top → tax = taxable × r; total = taxable + tax.
 */
export function calculateTax(itemTotal: number, discount: number, settings: Pick<TaxSettings, 'enabled' | 'rate' | 'mode'>): TaxBreakdown {
  const taxable = round2(Math.max(0, itemTotal - discount));
  const rate = parseRate(settings.rate);
  if (!settings.enabled || rate === null || rate === 0) {
    return { itemTotal, discount, taxable, net: taxable, tax: 0, total: taxable, applied: false };
  }
  const r = rate / 100;
  if (settings.mode === 'included') {
    const net = round2(taxable / (1 + r));
    return { itemTotal, discount, taxable, net, tax: round2(taxable - net), total: taxable, applied: true };
  }
  const tax = round2(taxable * r);
  return { itemTotal, discount, taxable, net: taxable, tax, total: round2(taxable + tax), applied: true };
}

interface State {
  settings: TaxSettings;
  savedAt: Date | null;
  /** Server version of the section (0 = not configured). */
  version: number;
  loaded: boolean;
  error: string | null;
}

let state: State = { settings: TAX_DEFAULTS, savedAt: null, version: 0, loaded: false, error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

interface TaxData {
  enabled: boolean;
  mode: TaxMode;
  name: string;
  rate: string | null;
  registration_number?: string;
  show_on_receipt?: boolean;
  show_rate?: boolean;
  show_breakdown?: boolean;
}

function fromData(d: TaxData): TaxSettings {
  return {
    enabled: !!d.enabled,
    name: d.name ?? '',
    rate: d.rate === null || d.rate === undefined ? '' : String(d.rate),
    registrationNumber: d.registration_number ?? '',
    mode: d.mode ?? 'included',
    showOnReceipt: d.show_on_receipt ?? TAX_DEFAULTS.showOnReceipt,
    showRate: d.show_rate ?? TAX_DEFAULTS.showRate,
    showBreakdown: d.show_breakdown ?? TAX_DEFAULTS.showBreakdown,
  };
}

export async function loadTaxSettings(): Promise<void> {
  try {
    const section = await getSection<TaxData>('tax');
    set({ settings: section.data ? fromData(section.data) : TAX_DEFAULTS, version: section.version ?? 0, loaded: true, error: null });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : 'Could not load tax settings' });
  }
}

export function useTaxSettings(): State {
  useEffect(() => {
    void loadTaxSettings();
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Saves to the server; a stale version is rejected (VERSION_CONFLICT) rather than overwritten. */
export async function saveTaxSettings(settings: TaxSettings): Promise<void> {
  const saved = await putSection<TaxData>('tax', state.version, {
    enabled: settings.enabled,
    mode: settings.mode,
    name: settings.name,
    rate: settings.rate.trim() === '' ? null : settings.rate.trim(),
    registration_number: settings.registrationNumber,
    show_on_receipt: settings.showOnReceipt,
    show_rate: settings.showRate,
    show_breakdown: settings.showBreakdown,
  });
  set({ settings: saved.data ? fromData(saved.data) : settings, version: saved.version ?? state.version, savedAt: new Date(), error: null });
}

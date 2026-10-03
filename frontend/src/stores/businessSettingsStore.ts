import { createSectionStore } from './sectionStore';

// Business profile (Settings → Business), stored in the `business` settings section. Name, type,
// address, phone and email also update the business record printed on sales documents; the
// currency and timezone were chosen in the setup wizard and are read-only here (server-enforced).

export const BUSINESS_TYPES = ['Café', 'Restaurant', 'Grilling Restaurant', 'Bakery', 'Food & Beverage', 'Custom'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Common currencies for the picker; any code/symbol can be entered via "Other". */
export const CURRENCIES: { code: string; name: string; symbol: string }[] = [
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
];

export interface BusinessSettings {
  name: string;
  type: BusinessType;
  customType: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  currencySymbol: string;
}

export const BUSINESS_DEFAULTS: BusinessSettings = {
  name: '',
  type: 'Café',
  customType: '',
  tagline: '',
  address: '',
  phone: '',
  email: '',
  currency: 'PHP',
  currencySymbol: '₱',
};

function fromData(d: Record<string, unknown>): BusinessSettings {
  const type = String(d.business_type ?? '');
  const known = (BUSINESS_TYPES as readonly string[]).includes(type);
  const currency = String(d.currency_code ?? BUSINESS_DEFAULTS.currency);
  return {
    name: String(d.name ?? ''),
    type: (known ? type : type ? 'Custom' : BUSINESS_DEFAULTS.type) as BusinessType,
    customType: known ? '' : type,
    tagline: String(d.tagline ?? ''),
    address: String(d.address ?? ''),
    phone: String(d.phone ?? ''),
    email: String(d.email ?? ''),
    currency,
    currencySymbol: String(d.currency_symbol ?? CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency),
  };
}

function toData(s: BusinessSettings, current: Record<string, unknown> | null): Record<string, unknown> {
  return {
    ...(current ?? {}),
    name: s.name,
    business_type: s.type === 'Custom' ? s.customType : s.type,
    tagline: s.tagline,
    address: s.address,
    phone: s.phone,
    email: s.email,
    currency_code: s.currency,
    currency_symbol: s.currencySymbol,
  };
}

const store = createSectionStore<BusinessSettings>('business', BUSINESS_DEFAULTS, fromData, toData);

export const useBusinessSettings = store.use;
export const saveBusinessSettings = (settings: BusinessSettings) => store.save(settings);


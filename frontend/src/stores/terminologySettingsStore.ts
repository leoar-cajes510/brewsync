import { createSectionStore } from './sectionStore';

// Terminology (Settings → Terminology). Stored in the `terminology` settings
// section. Only displayed labels are affected —
// system keys, functionality, and stored records never change.

export type TermKey = 'product' | 'customer' | 'staff' | 'order' | 'category' | 'receipt';

export interface TermDefinition {
  key: TermKey;
  label: string;
  systemKey: string;
  context: string;
}

export const TERMS: TermDefinition[] = [
  { key: 'product', label: 'Product', systemKey: 'pos.item.product', context: 'Items you sell: drinks, food, retail goods, and add-ons.' },
  { key: 'customer', label: 'Customer', systemKey: 'pos.party.patron', context: 'Shown on orders, customer details, and receipts.' },
  { key: 'staff', label: 'Staff', systemKey: 'pos.roster.member', context: 'Used for staff accounts, shifts, and PIN sign-in.' },
  { key: 'order', label: 'Order', systemKey: 'pos.check.instance', context: 'Used in the order queue, history, and order numbers.' },
  { key: 'category', label: 'Category', systemKey: 'pos.catalog.group', context: 'Register tabs and menu organization.' },
  { key: 'receipt', label: 'Receipt', systemKey: 'pos.docket.fiscal', context: 'Printed and digital receipt titles.' },
];

/** Custom display terms; an empty string means "use the default". */
export type Terminology = Record<TermKey, string>;

export const TERMINOLOGY_DEFAULTS: Terminology = { product: '', customer: '', staff: '', order: '', category: '', receipt: '' };

export const MAX_TERM_LENGTH = 24;

/** Resolved display word for a term (custom value or default). */
export const termFor = (t: Terminology, key: TermKey) => t[key].trim() || TERMS.find((d) => d.key === key)!.label;

/** Simple English plural for preview labels. */
export const plural = (word: string) =>
  /[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`;

const store = createSectionStore<Terminology>(
  'terminology',
  TERMINOLOGY_DEFAULTS,
  (d) => ({ ...TERMINOLOGY_DEFAULTS, ...(d as Partial<Terminology>) }),
  (terms, current) => ({ ...(current ?? {}), ...terms }),
);

export function useTerminologySettings() {
  const s = store.use();
  return { ...s, terms: s.settings };
}

export const saveTerminologySettings = (terms: Terminology) =>
  store.save(Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, v.trim()])) as Terminology);


/** Display words for the app (TRM-02): custom term or default, singular or plural. */
export function useTerms() {
  const { terms } = useTerminologySettings();
  return {
    term: (key: TermKey) => termFor(terms, key),
    terms: (key: TermKey) => plural(termFor(terms, key)),
  };
}

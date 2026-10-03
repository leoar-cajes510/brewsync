import { createSectionStore } from './sectionStore';

// Receipts (Settings → Receipts). Stored in the `receipts` settings section. Controls receipt PRESENTATION only —
// business identity comes from Settings → Business, tax from Settings → Tax.
// Completed receipts keep their own snapshot and are never changed by this.

export type ReceiptFormat = 'printed' | 'digital';

export interface ReceiptLogo {
  /** Local preview (data URL) for this session only — never uploaded. */
  dataUrl: string;
  fileName: string;
}

export type ReceiptToggleKey =
  | 'showLogo'
  | 'showBusinessName'
  | 'showAddress'
  | 'showPhone'
  | 'showEmail'
  | 'showCashier'
  | 'showTerminal'
  | 'showOrderNumber'
  | 'showReference'
  | 'showDateTime'
  | 'showPaymentMethod'
  | 'showTax'
  | 'showDiscount'
  | 'showCustomer';

export type ReceiptTextKey = 'heading' | 'thankYou' | 'footer' | 'smallPrint';

export interface ReceiptSettings extends Record<ReceiptToggleKey, boolean>, Record<ReceiptTextKey, string> {
  format: ReceiptFormat;
  logo: ReceiptLogo | null;
}

export const RECEIPT_TEXT_LIMITS: Record<ReceiptTextKey, number> = { heading: 32, thankYou: 40, footer: 80, smallPrint: 120 };

// Neutral interface defaults only — no business identity is invented here.
export const RECEIPT_DEFAULTS: ReceiptSettings = {
  format: 'printed',
  logo: null,
  showLogo: true,
  showBusinessName: true,
  showAddress: true,
  showPhone: true,
  showEmail: false,
  showCashier: true,
  showTerminal: true,
  showOrderNumber: true,
  showReference: true,
  showDateTime: true,
  showPaymentMethod: true,
  showTax: true,
  showDiscount: true,
  showCustomer: false,
  heading: 'RECEIPT',
  thankYou: 'Thank you for your purchase!',
  footer: 'Please come again.',
  smallPrint: '',
};

/** Logo files are not uploaded (storage is an open decision, Q-ARCH-2): kept for this session only. */
let sessionLogo: ReceiptSettings['logo'] = null;

const store = createSectionStore<ReceiptSettings>(
  'receipts',
  RECEIPT_DEFAULTS,
  (d) => ({ ...RECEIPT_DEFAULTS, ...(d as Partial<ReceiptSettings>), logo: sessionLogo }),
  (s, current) => ({ ...(current ?? {}), ...s, logo: null }),
);

export const useReceiptSettings = store.use;
export const saveReceiptSettings = (settings: ReceiptSettings) => {
  sessionLogo = settings.logo;
  return store.save(settings);
};


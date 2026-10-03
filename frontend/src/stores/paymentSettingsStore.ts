import { createSectionStore } from './sectionStore';

// Payments (Settings → Payments), stored in the `payments` settings section (enabled methods and
// per-method options the server enforces). Cash rounding is not edited here and is preserved as
// saved (Q-PAY-2). No payment provider, GCash API, card terminal, or bank is contacted.

export type PaymentMethodKey = 'cash' | 'gcash' | 'card' | 'bank';

export interface CashOptions {
  requireCashReceived: boolean;
  autoChange: boolean;
  openDrawer: boolean;
}

export interface ReferenceOptions {
  requireReference: boolean;
  requireConfirmation: boolean;
}

export interface PaymentSettings {
  /** Checkout display order (all methods, enabled or not). */
  order: PaymentMethodKey[];
  enabled: Record<PaymentMethodKey, boolean>;
  cash: CashOptions;
  gcash: ReferenceOptions;
  card: ReferenceOptions;
  bank: ReferenceOptions;
}

export const PAYMENT_METHODS: Record<PaymentMethodKey, { name: string; description: string }> = {
  cash: { name: 'Cash', description: 'Accept cash at the counter and give change.' },
  gcash: { name: 'GCash', description: 'Accept GCash e-wallet payments. Confirmed manually by staff.' },
  card: { name: 'Card', description: 'Accept debit or credit cards on a separate card terminal.' },
  bank: { name: 'Bank Transfer', description: 'Accept direct bank transfers. Confirmed manually by staff.' },
};

export const PAYMENT_DEFAULTS: PaymentSettings = {
  order: ['cash', 'gcash', 'card', 'bank'],
  enabled: { cash: true, gcash: true, card: true, bank: true },
  cash: { requireCashReceived: true, autoChange: true, openDrawer: true },
  gcash: { requireReference: true, requireConfirmation: true },
  card: { requireReference: true, requireConfirmation: true },
  bank: { requireReference: true, requireConfirmation: true },
};

export const enabledMethods = (s: PaymentSettings) => s.order.filter((k) => s.enabled[k]);

const API_METHOD: Record<PaymentMethodKey, string> = { cash: 'cash', gcash: 'gcash', card: 'card', bank: 'bank_transfer' };
const KEYS = Object.keys(API_METHOD) as PaymentMethodKey[];

type Opts = { require_cash_received?: boolean; require_reference?: boolean; require_confirmation?: boolean };

function fromData(d: Record<string, unknown>): PaymentSettings {
  const enabled = new Set((d.enabled_methods as string[] | undefined) ?? []);
  const options = (d.options as Record<string, Opts> | undefined) ?? {};
  const ui = (d.ui as { order?: PaymentMethodKey[]; cash?: { autoChange?: boolean; openDrawer?: boolean } } | undefined) ?? {};
  const ref = (k: PaymentMethodKey): ReferenceOptions => ({
    requireReference: !!options[API_METHOD[k]]?.require_reference,
    requireConfirmation: !!options[API_METHOD[k]]?.require_confirmation,
  });
  const order = ui.order?.length === KEYS.length ? ui.order : PAYMENT_DEFAULTS.order;
  return {
    order,
    enabled: Object.fromEntries(KEYS.map((k) => [k, enabled.has(API_METHOD[k])])) as Record<PaymentMethodKey, boolean>,
    cash: {
      requireCashReceived: !!options.cash?.require_cash_received,
      autoChange: ui.cash?.autoChange ?? PAYMENT_DEFAULTS.cash.autoChange,
      openDrawer: ui.cash?.openDrawer ?? PAYMENT_DEFAULTS.cash.openDrawer,
    },
    gcash: ref('gcash'),
    card: ref('card'),
    bank: ref('bank'),
  };
}

function toData(s: PaymentSettings, current: Record<string, unknown> | null): Record<string, unknown> {
  const refOpts = (o: ReferenceOptions): Opts => ({ require_reference: o.requireReference, require_confirmation: o.requireConfirmation });
  return {
    ...(current ?? {}),
    enabled_methods: s.order.filter((k) => s.enabled[k]).map((k) => API_METHOD[k]),
    options: {
      cash: { require_cash_received: s.cash.requireCashReceived },
      gcash: refOpts(s.gcash),
      card: refOpts(s.card),
      bank_transfer: refOpts(s.bank),
    },
    // Required by the server; kept exactly as configured (never guessed here).
    cash_rounding: (current?.cash_rounding as object | undefined) ?? { enabled: false },
    ui: { order: s.order, cash: { autoChange: s.cash.autoChange, openDrawer: s.cash.openDrawer } },
  };
}

const store = createSectionStore<PaymentSettings>('payments', PAYMENT_DEFAULTS, fromData, toData);

export const usePaymentSettings = store.use;
export const savePaymentSettings = (settings: PaymentSettings) => store.save(settings);


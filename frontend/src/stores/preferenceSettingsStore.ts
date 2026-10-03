import { createSectionStore } from './sectionStore';

// Preferences (Settings → Preferences). Stored in the business-wide
// `preferences` settings section (Q-SET-1). These describe interface
// behavior and defaults; they never modify business records.

export type OrderType = 'dineIn' | 'takeout' | 'delivery';

export interface PreferenceSettings {
  interfaceSounds: boolean;
  paymentSound: boolean;
  notifications: boolean;
  liveUpdates: boolean;
  autoRefresh: boolean;
  defaultOrderType: OrderType;
  showOrderTypeAtCheckout: boolean;
  newOrderAlerts: boolean;
  orderWaitingAlerts: boolean;
  lowStockAlerts: boolean;
  paymentAlerts: boolean;
  autoClearCompleted: boolean;
  returnToPosAfterPayment: boolean;
  confirmCancelOrder: boolean;
  confirmRemoveCartItem: boolean;
}

export type PreferenceToggleKey = Exclude<keyof PreferenceSettings, 'defaultOrderType'>;

export const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: 'dineIn', label: 'Dine In' },
  { value: 'takeout', label: 'Takeout' },
  { value: 'delivery', label: 'Delivery' },
];

export const PREFERENCE_DEFAULTS: PreferenceSettings = {
  interfaceSounds: true,
  paymentSound: true,
  notifications: true,
  liveUpdates: true,
  autoRefresh: true,
  defaultOrderType: 'dineIn',
  showOrderTypeAtCheckout: true,
  newOrderAlerts: true,
  orderWaitingAlerts: true,
  lowStockAlerts: true,
  paymentAlerts: true,
  autoClearCompleted: true,
  returnToPosAfterPayment: true,
  confirmCancelOrder: true,
  confirmRemoveCartItem: false,
};

const store = createSectionStore<PreferenceSettings>(
  'preferences',
  PREFERENCE_DEFAULTS,
  (d) => ({ ...PREFERENCE_DEFAULTS, ...(d as Partial<PreferenceSettings>) }),
  (s, current) => ({ ...(current ?? {}), ...s }),
);

export const usePreferenceSettings = store.use;
export const savePreferenceSettings = (settings: PreferenceSettings) => store.save(settings);


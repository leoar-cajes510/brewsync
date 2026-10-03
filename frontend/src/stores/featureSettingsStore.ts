import { createSectionStore } from './sectionStore';

// Features (Settings → Features), stored in the `features` settings section. The server gates
// feature endpoints (403 FEATURE_DISABLED). Toggling a feature never deletes data and never
// removes routes — other screens may only show it as disabled.

export type FeatureKey =
  | 'inventory'
  | 'analytics'
  | 'expenses'
  | 'refunds'
  | 'discounts'
  | 'ingredients'
  | 'lowStockAlerts'
  | 'orderAlerts'
  | 'liveUpdates'
  | 'soundEffects';

export interface FeatureDefinition {
  key: FeatureKey;
  name: string;
  description: string;
}

export const FEATURES: FeatureDefinition[] = [
  { key: 'inventory', name: 'Inventory', description: 'Manage product stock levels, restocking, and stock adjustments.' },
  { key: 'analytics', name: 'Analytics & Insights', description: 'View sales performance, trends, product performance, and business insights.' },
  { key: 'expenses', name: 'Expenses', description: 'Record and monitor business expenses.' },
  { key: 'refunds', name: 'Refunds', description: 'Allow authorized staff to process refunds.' },
  { key: 'discounts', name: 'Discounts', description: 'Create and apply discounts to eligible orders.' },
  { key: 'ingredients', name: 'Ingredient Tracking', description: 'Track raw ingredients and connect them to product recipes.' },
  { key: 'lowStockAlerts', name: 'Low Stock Alerts', description: 'Show warnings when inventory or ingredients reach their configured threshold.' },
  { key: 'orderAlerts', name: 'Order Alerts', description: 'Notify staff about important order status changes or waiting orders.' },
  { key: 'liveUpdates', name: 'Live Updates', description: 'Keep orders and screens updated across terminals without refreshing.' },
  { key: 'soundEffects', name: 'Sound Effects', description: 'Play short sounds for new orders, alerts, and completed payments.' },
];

export type FeatureFlags = Record<FeatureKey, boolean>;

// Shown only until the server copy loads (Ingredient Tracking and
// Sound Effects off). It is a starting template, not a live business state.
export const FEATURE_DEFAULTS: FeatureFlags = {
  inventory: true,
  analytics: true,
  expenses: true,
  refunds: true,
  discounts: true,
  ingredients: false,
  lowStockAlerts: true,
  orderAlerts: true,
  liveUpdates: true,
  soundEffects: false,
};

const store = createSectionStore<FeatureFlags>(
  'features',
  FEATURE_DEFAULTS,
  (d) => Object.fromEntries(FEATURES.map((f) => [f.key, d[f.key] === true])) as FeatureFlags,
  (flags, current) => ({ ...(current ?? {}), ...flags }),
);

export function useFeatureSettings() {
  const s = store.use();
  return { ...s, flags: s.settings };
}

export const saveFeatureSettings = (flags: FeatureFlags) => store.save(flags);


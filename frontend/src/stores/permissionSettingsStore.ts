// Permissions (Settings → Permissions) catalogue and defaults. Role grants are stored on the
// server (GET/PUT /settings/permissions) and enforced by the backend, never by hiding UI.

export type RoleKey = 'admin' | 'cashier';

export interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
  /** Management function: not granted to Cashier by default. */
  protected?: boolean;
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionDefinition[];
}

const p = (key: string, label: string, description: string, isProtected = false): PermissionDefinition => ({ key, label, description, protected: isProtected });

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'pos',
    label: 'POS',
    permissions: [
      p('pos.view', 'View POS', 'Open the register screen.'),
      p('pos.createOrders', 'Create Orders', 'Ring up items and choices.'),
      p('pos.editOrders', 'Edit Orders', 'Change items on an open order.'),
      p('pos.cancelOrders', 'Cancel Orders', 'Cancel or void an order.', true),
      p('pos.applyDiscounts', 'Apply Discounts', 'Apply available discounts to an order.'),
      p('pos.processPayments', 'Process Payments', 'Take cash and other payments.'),
      p('pos.processRefunds', 'Process Refunds', 'Refund a completed payment.', true),
    ],
  },
  {
    key: 'orders',
    label: 'Orders',
    permissions: [
      p('orders.view', 'View Orders', 'See active and waiting orders.'),
      p('orders.changeStatus', 'Change Order Status', 'Move orders between preparing and ready.'),
      p('orders.complete', 'Complete Orders', 'Mark orders as completed.'),
    ],
  },
  {
    key: 'receipts',
    label: 'Receipts',
    permissions: [p('receipts.view', 'View Receipts', 'Open receipts for past orders.'), p('receipts.reprint', 'Reprint Receipts', 'Print a receipt again.')],
  },
  {
    key: 'history',
    label: 'History',
    permissions: [p('history.view', 'View Transaction History', 'Browse past transactions.')],
  },
  {
    key: 'products',
    label: 'Products',
    permissions: [
      p('products.view', 'View Products', 'Browse products, categories, and prices.'),
      p('products.create', 'Create Products', 'Add new products.', true),
      p('products.edit', 'Edit Products', 'Change names, prices, and availability.', true),
      p('products.delete', 'Delete Products', 'Remove products from the catalog.', true),
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    permissions: [
      p('inventory.view', 'View Inventory', 'See current stock levels.'),
      p('inventory.restock', 'Restock', 'Record incoming stock.', true),
      p('inventory.adjust', 'Adjust Stock', 'Correct stock for waste or counts.', true),
    ],
  },
  {
    key: 'choices',
    label: 'Choices',
    permissions: [p('choices.view', 'View Choices', 'See choice groups and options.'), p('choices.manage', 'Manage Choices', 'Create and edit choice groups and prices.', true)],
  },
  {
    key: 'ingredients',
    label: 'Ingredients',
    permissions: [
      p('ingredients.view', 'View Ingredients', 'See ingredient stock and costs.', true),
      p('ingredients.recipes', 'Manage Recipes', 'Link ingredients to products.', true),
      p('ingredients.adjust', 'Adjust Ingredient Stock', 'Correct ingredient quantities.', true),
    ],
  },
  {
    key: 'expenses',
    label: 'Expenses',
    permissions: [
      p('expenses.view', 'View Expenses', 'See recorded expenses.', true),
      p('expenses.record', 'Record Expenses', 'Add a new expense.', true),
      p('expenses.edit', 'Edit Expenses', 'Change recorded expenses.', true),
      p('expenses.delete', 'Delete Expenses', 'Remove recorded expenses.', true),
    ],
  },
  {
    key: 'analytics',
    label: 'Analytics',
    permissions: [
      p('analytics.view', 'View Analytics', 'Sales, orders, and product charts.', true),
      p('analytics.insights', 'View Business Insights', 'Profit, spending, and trend summaries.', true),
    ],
  },
  {
    key: 'staff',
    label: 'Staff',
    permissions: [
      p('staff.view', 'View Staff', 'See staff accounts and roles.', true),
      p('staff.add', 'Add Staff', 'Create staff accounts.', true),
      p('staff.edit', 'Edit Staff', 'Change staff details and roles.', true),
      p('staff.deactivate', 'Deactivate Staff', 'Turn off a staff account.', true),
      p('staff.resetPasswords', 'Reset Passwords', 'Issue a new password or PIN.', true),
      p('staff.managePermissions', 'Manage Permissions', 'Change what each role can do.', true),
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    permissions: [
      p('settings.view', 'View Settings', 'Open the Settings area.', true),
      p('settings.business', 'Edit Business Settings', 'Business details and hours.', true),
      p('settings.branding', 'Edit Branding', 'Logo and brand colors.', true),
      p('settings.features', 'Edit Features', 'Turn BrewSync features on or off.', true),
      p('settings.tax', 'Edit Tax', 'Tax rates and rules.', true),
      p('settings.payments', 'Edit Payments', 'Accepted payment methods.', true),
      p('settings.discounts', 'Edit Discounts', 'Available discounts.', true),
      p('settings.receipts', 'Edit Receipt Settings', 'Receipt layout and details.', true),
      p('settings.staffing', 'Edit Staffing', 'Shifts and staffing rules.', true),
      p('settings.preferences', 'Edit Preferences', 'Display and regional preferences.', true),
      p('settings.account', 'Manage Account Settings', 'Owner account and subscription.', true),
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.permissions);

export type PermissionSet = Record<string, boolean>;
export type RolePermissions = Record<RoleKey, PermissionSet>;

const build = (grant: (perm: PermissionDefinition) => boolean): PermissionSet => Object.fromEntries(ALL_PERMISSIONS.map((perm) => [perm.key, grant(perm)]));

// Configurable starting defaults: Admin gets everything; Cashier gets
// operating access only (no protected management functions).
export const PERMISSION_DEFAULTS: RolePermissions = {
  admin: build(() => true),
  cashier: build((perm) => !perm.protected),
};

export const ROLES: { key: RoleKey; label: string; description: string }[] = [
  { key: 'cashier', label: 'Cashier', description: 'Front counter: taking orders, payments, and receipts.' },
  { key: 'admin', label: 'Admin', description: 'Management role with broad access to admin and settings.' },
];

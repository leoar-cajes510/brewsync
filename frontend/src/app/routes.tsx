import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { CalendarDays, Lock } from 'lucide-react';

import AppLayout from '../components/layout/AppLayout';
import SectionLayout from '../components/layout/SectionLayout';
import AdminNavigation from '../components/layout/AdminNavigation';
import SettingsNavigation from '../components/layout/SettingsNavigation';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { formatLongDate } from '../utils/date';
import ProtectedRoute from '../components/auth/ProtectedRoute';
import AdminGuard from '../components/auth/AdminGuard';

import LoginPage from '../pages/Login/LoginPage';
import POSPage from '../pages/POS/POSPage';
import OrdersPage from '../pages/Orders/OrdersPage';



// Secondary pages load on first visit (code splitting); POS, Orders and Login stay in the main bundle.
// The router keeps the current page on screen while a lazy page loads, so there is no blank flash.
const page = (load: () => Promise<{ default: ComponentType }>) => async () => ({ Component: (await load()).default });

const adminActions = (
  <>
    <Button icon={<CalendarDays size={16} />}>{formatLongDate(new Date())}</Button>
    <Button icon={<Lock size={16} />} disabled title="Lock Admin is available in a later phase">
      Lock Admin
    </Button>
  </>
);

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/pos" replace /> },
      { path: 'pos', element: <POSPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'receipts', lazy: page(() => import('../pages/Receipts/ReceiptsPage')) },
      { path: 'history', lazy: page(() => import('../pages/History/HistoryPage')) },
      {
        path: 'admin',
        element: (
          <AdminGuard>
          <SectionLayout
            title="Admin Dashboard"
            subtitle="Business overview and operational insights."
            badge={<Badge tone="warning" dot>Admin Mode</Badge>}
            actions={adminActions}
            nav={<AdminNavigation />}
          />
          </AdminGuard>
        ),
        children: [
          { index: true, lazy: page(() => import('../pages/Admin/AdminOverviewPage')), handle: { title: 'Admin Overview' } },
          {
            path: 'products',
            lazy: page(() => import('../pages/Admin/AdminProductsPage')),
            handle: { title: 'Products', subtitle: 'Manage your products, pricing, categories, and availability.' },
          },
          {
            path: 'inventory',
            lazy: page(() => import('../pages/Admin/AdminInventoryPage')),
            handle: { title: 'Inventory', subtitle: 'Monitor stock levels, restock products, and manage inventory movement.' },
          },
          {
            path: 'choices',
            lazy: page(() => import('../pages/Admin/AdminChoicesPage')),
            handle: { title: 'Choices & Customizations', subtitle: 'Configure reusable choice groups, pricing surcharges, and options for your menu items.' },
          },
          {
            path: 'ingredients',
            lazy: page(() => import('../pages/Admin/AdminIngredientsPage')),
            handle: { title: 'Ingredients & Recipes', subtitle: 'Track raw material stock, unit costs, and configure product recipes.' },
          },
          {
            path: 'expenses',
            lazy: page(() => import('../pages/Admin/AdminExpensesPage')),
            handle: { title: 'Expenses', subtitle: 'Track and manage your operational store expenses and disbursements.' },
          },
          {
            path: 'analytics',
            lazy: page(() => import('../pages/Admin/AdminAnalyticsPage')),
            handle: { title: 'Analytics', subtitle: 'Analyze sales, orders, products, and spending over time.' },
          },
          {
            path: 'staff',
            lazy: page(() => import('../pages/Admin/AdminStaffPage')),
            handle: { title: 'Staff', subtitle: 'Manage staff accounts, roles, terminals, and access.' },
          },
          {
            path: 'archived-orders',
            lazy: page(() => import('../pages/Admin/AdminArchivedOrdersPage')),
            handle: { title: 'Archived Orders', subtitle: 'Review completed and archived orders stored for historical reference.' },
          },
        ],
      },
      {
        path: 'settings',
        element: (
          <AdminGuard permission="settings.view">
          <SectionLayout
            title="Settings"
            subtitle="Configure how BrewSync works for your business."
            nav={<SettingsNavigation />}
          />
          </AdminGuard>
        ),
        children: [
          { index: true, lazy: page(() => import('../pages/Settings/SettingsOverviewPage')) },
          {
            path: 'business',
            lazy: page(() => import('../pages/Settings/SettingsBusinessPage')),
            handle: { title: 'Business', subtitle: 'Manage your business information and operating details.' },
          },
          {
            path: 'branding',
            lazy: page(() => import('../pages/Settings/SettingsBrandingPage')),
            handle: { title: 'Branding', subtitle: 'Customize how your business looks throughout BrewSync.' },
          },
          {
            path: 'terminology',
            lazy: page(() => import('../pages/Settings/SettingsTerminologyPage')),
            handle: { title: 'Terminology', subtitle: 'Customize the terms used throughout BrewSync to match your business.' },
          },
          {
            path: 'features',
            lazy: page(() => import('../pages/Settings/SettingsFeaturesPage')),
            handle: { title: 'Features', subtitle: 'Control which BrewSync features are enabled for your business.' },
          },
          {
            path: 'permissions',
            lazy: page(() => import('../pages/Settings/SettingsPermissionsPage')),
            handle: { title: 'Permissions', subtitle: 'Control what each role can access and perform in BrewSync.' },
          },
          {
            path: 'tax',
            lazy: page(() => import('../pages/Settings/SettingsTaxPage')),
            handle: { title: 'Tax', subtitle: 'Configure how tax is calculated and displayed on your sales.' },
          },
          {
            path: 'payments',
            lazy: page(() => import('../pages/Settings/SettingsPaymentsPage')),
            handle: { title: 'Payments', subtitle: 'Configure the payment methods available at checkout.' },
          },
          {
            path: 'discounts',
            lazy: page(() => import('../pages/Settings/SettingsDiscountsPage')),
            handle: { title: 'Discounts', subtitle: 'Create and manage discounts that can be applied at checkout.' },
          },
          {
            path: 'receipts',
            lazy: page(() => import('../pages/Settings/SettingsReceiptsPage')),
            handle: { title: 'Receipts', subtitle: 'Customize the information displayed on printed and digital receipts.' },
          },
          {
            path: 'staffing',
            lazy: page(() => import('../pages/Settings/SettingsStaffingPage')),
            handle: { title: 'Staffing', subtitle: 'Configure account capacity, terminal limits, and operational thresholds.' },
          },
          {
            path: 'terminals',
            lazy: page(() => import('../pages/Settings/SettingsTerminalsPage')),
            handle: { title: 'Terminals', subtitle: 'Register devices, issue activation codes, and deactivate terminals.' },
          },
          {
            path: 'preferences',
            lazy: page(() => import('../pages/Settings/SettingsPreferencesPage')),
            handle: { title: 'Preferences', subtitle: 'Configure BrewSync behavior, interface preferences, and default operating settings.' },
          },
          {
            path: 'audit-log',
            lazy: page(() => import('../pages/Settings/SettingsAuditLogPage')),
            handle: { title: 'Audit Log', subtitle: 'Review the permanent record of sales, refunds, stock and settings changes.' },
          },
          {
            path: 'account',
            lazy: page(() => import('../pages/Settings/SettingsAccountPage')),
            handle: { title: 'Account', subtitle: 'Manage your profile, password, and current session.' },
          },
        ],
      },
      { path: '*', element: <Navigate to="/pos" replace /> },
    ],
  },
]);

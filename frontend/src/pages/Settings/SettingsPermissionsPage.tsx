import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Carrot,
  CheckSquare,
  ClipboardList,
  History,
  Info,
  Lock,
  Package,
  ReceiptText,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Square,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import LoadingState from '../../components/ui/LoadingState';
import Toggle from '../../components/ui/Toggle';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import {
  ALL_PERMISSIONS,
  PERMISSION_DEFAULTS,
  PERMISSION_GROUPS,
  ROLES,
  type PermissionDefinition,
  type RoleKey,
  type RolePermissions,
} from '../../stores/permissionSettingsStore';
import { errorMessage } from '../../services/api';
import { getPermissions, putPermissions } from '../../services/settingsService';
import '../../components/settings/settingsPermissions.css';

const GROUP_ICONS: Record<string, LucideIcon> = {
  pos: ShoppingCart,
  orders: ClipboardList,
  receipts: ReceiptText,
  history: History,
  products: Package,
  inventory: Boxes,
  choices: SlidersHorizontal,
  ingredients: Carrot,
  expenses: Wallet,
  analytics: BarChart3,
  staff: Users,
  settings: Settings,
};

const TOTAL = ALL_PERMISSIONS.length;
const countOn = (set: Record<string, boolean>) => ALL_PERMISSIONS.filter((perm) => set[perm.key]).length;
const sameRoles = (a: RolePermissions, b: RolePermissions) => ROLES.every(({ key }) => ALL_PERMISSIONS.every((perm) => a[key][perm.key] === b[key][perm.key]));

type Pending =
  | { kind: 'enableAll' | 'disableAll' | 'rolePreset' | 'resetAll' }
  | { kind: 'grantProtected'; perm: PermissionDefinition };

// Role access configuration. Grants are loaded from and saved to the server, which enforces
// them on every request — hiding UI is never the security layer.
export default function SettingsPermissionsPage() {
  const [saved, setSaved] = useState<RolePermissions | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [form, setForm] = useState<RolePermissions>(PERMISSION_DEFAULTS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<RoleKey>('cashier');
  const [pending, setPending] = useState<Pending | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { roles } = await getPermissions();
      setSaved(roles);
      setForm(roles);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = form[role];
  const roleInfo = ROLES.find((r) => r.key === role)!;
  const enabled = countOn(current);
  const dirty = saved !== null && !sameRoles(form, saved);

  const setRolePerms = (patch: Record<string, boolean>) => setForm((f) => ({ ...f, [role]: { ...f[role], ...patch } }));
  const setAll = (value: boolean) => setRolePerms(Object.fromEntries(ALL_PERMISSIONS.map((perm) => [perm.key, value])));

  const toggle = (perm: PermissionDefinition, value: boolean) => {
    // Granting a management function to Cashier needs an explicit confirmation.
    if (value && role === 'cashier' && perm.protected) return setPending({ kind: 'grantProtected', perm });
    setRolePerms({ [perm.key]: value });
  };

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === 'enableAll') setAll(true);
    if (pending.kind === 'disableAll') setAll(false);
    if (pending.kind === 'rolePreset') setRolePerms(PERMISSION_DEFAULTS[role]);
    if (pending.kind === 'resetAll') {
      setForm(PERMISSION_DEFAULTS);
      setFeedback('Permissions reset to defaults — Save Changes to apply');
    }
    if (pending.kind === 'grantProtected') setRolePerms({ [pending.perm.key]: true });
    setPending(null);
  };

  // "Saved" only after the server stored the grants; on failure the edits stay in the form.
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { roles } = await putPermissions(form);
      setSaved(roles);
      setForm(roles);
      setSavedAt(new Date());
      setFeedback('Permissions saved');
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const dialog = (() => {
    if (!pending) return null;
    const name = roleInfo.label;
    switch (pending.kind) {
      case 'enableAll':
        return { title: `Enable all permissions for ${name}?`, message: `All ${TOTAL} permissions are turned on for ${name}, including protected management functions.`, label: 'Enable All' };
      case 'disableAll':
        return { title: `Disable all permissions for ${name}?`, message: `All ${TOTAL} permissions are turned off for ${name}. Staff with this role would not be able to use BrewSync.`, label: 'Disable All', danger: true };
      case 'rolePreset':
        return { title: `Reset ${name} to its default permissions?`, message: `${name} returns to its default permissions. The other role is not changed.`, label: `Reset ${name}` };
      case 'resetAll':
        return { title: 'Reset all roles to defaults?', message: 'Admin and Cashier both return to their default permissions. Nothing changes until you Save Changes.', label: 'Reset Permissions' };
      case 'grantProtected':
        return { title: `Give Cashier “${pending.perm.label}”?`, message: `${pending.perm.label} is a protected management function that Cashier does not have by default.`, label: 'Allow for Cashier' };
    }
  })();

  const adminLockout = role === 'admin' && !current['staff.managePermissions'];

  if (saved === null) {
    return (
      <div className="settings-permissions">
        {loadError ? (
          <div className="api-status api-status--error" role="alert">
            {loadError}
            <Button size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          <LoadingState label="Loading permissions…" />
        )}
      </div>
    );
  }

  return (
    <div className="settings-permissions">
      <div className="pm-top">
        {/* Role selector */}
        <section className="pm-card pm-roles">
          <header className="pm-roles__head">
            <span>Select Role</span>
            <span>{ROLES.length} roles</span>
          </header>
          <div className="pm-roles__list" role="radiogroup" aria-label="Role">
            {ROLES.map((r) => {
              const on = countOn(form[r.key]);
              const active = r.key === role;
              return (
                <button
                  key={r.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`pm-role ${active ? 'pm-role--active' : ''}`}
                  data-role={r.key}
                  onClick={() => setRole(r.key)}
                >
                  <span className="pm-role__title">
                    <strong>{r.label}</strong>
                    {active && <Badge tone="neutral">Selected</Badge>}
                  </span>
                  <span className="pm-role__desc">{r.description}</span>
                  <span className="pm-role__meta">
                    <b>
                      {on} of {TOTAL} granted
                    </b>
                    <em>{on === TOTAL ? 'Full access' : r.key === 'cashier' ? 'Operating access' : 'Limited'}</em>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Role summary + bulk actions */}
        <section className="pm-card pm-summary">
          <div className="pm-summary__head">
            <span className="pm-summary__icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <h2>Role: {roleInfo.label}</h2>
              <p>{role === 'cashier' ? 'Cashier does not get protected management functions unless you allow them here.' : 'Management role with broad access. Adjust as needed.'}</p>
            </div>
          </div>
          <div className="pm-summary__stats" aria-label="Permission summary">
            <div data-stat="role">
              <span>Selected Role</span>
              <strong>{roleInfo.label}</strong>
            </div>
            <div data-stat="enabled" className="pm-stat--on">
              <span>Enabled</span>
              <strong>{enabled}</strong>
            </div>
            <div data-stat="disabled">
              <span>Disabled</span>
              <strong>{TOTAL - enabled}</strong>
            </div>
          </div>
          <div className="pm-bulk">
            <Button size="sm" icon={<CheckSquare size={14} />} disabled={enabled === TOTAL} onClick={() => setPending({ kind: 'enableAll' })}>
              Enable All
            </Button>
            <Button size="sm" icon={<Square size={14} />} disabled={enabled === 0} onClick={() => setPending({ kind: 'disableAll' })}>
              Disable All
            </Button>
            <Button size="sm" icon={<RotateCcw size={14} />} disabled={ALL_PERMISSIONS.every((perm) => current[perm.key] === PERMISSION_DEFAULTS[role][perm.key])} onClick={() => setPending({ kind: 'rolePreset' })}>
              Reset {roleInfo.label} Defaults
            </Button>
          </div>
          <p className="pm-note">
            <Info size={14} />
            Permissions determine which areas and actions a role can access. Final access control must be enforced by the backend, not only by the interface.
          </p>
          {adminLockout && (
            <p className="pm-warning" role="status">
              <AlertTriangle size={14} /> With “Manage Permissions” off, no role could change permissions later.
            </p>
          )}
        </section>
      </div>

      {/* Permission groups */}
      <div className="pm-groups">
        {PERMISSION_GROUPS.map((g) => {
          const Icon = GROUP_ICONS[g.key];
          const on = g.permissions.filter((perm) => current[perm.key]).length;
          return (
            <section key={g.key} className="pm-card pm-group" data-group={g.key}>
              <header className="pm-group__head">
                <h3>
                  <Icon size={15} /> {g.label}
                </h3>
                <span className={`pm-count ${on === g.permissions.length ? 'pm-count--full' : on === 0 ? 'pm-count--none' : ''}`}>
                  {on} of {g.permissions.length} enabled
                </span>
              </header>
              <ul>
                {g.permissions.map((perm) => (
                  <li key={perm.key} className={`pm-perm ${current[perm.key] ? '' : 'pm-perm--off'}`} data-perm={perm.key}>
                    <div>
                      <span className="pm-perm__label">
                        {perm.label}
                        {perm.protected && (
                          <span className="pm-protected" title="Management function — not given to Cashier by default">
                            <Lock size={9} /> Protected
                          </span>
                        )}
                      </span>
                      <small>{perm.description}</small>
                    </div>
                    <Toggle checked={current[perm.key]} onChange={(v) => toggle(perm, v)} label={`${perm.label} for ${roleInfo.label}`} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {saveError && (
        <div className="api-status api-status--error" role="alert">
          Permissions not saved: {saveError}
          <Button size="sm" onClick={() => setSaveError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <footer className="pm-actions">
        <span className="pm-actions__state">
          {dirty ? 'You have unsaved changes.' : savedAt ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : 'Showing the saved role permissions.'}
        </span>
        <div className="pm-actions__buttons">
          <Button icon={<RotateCcw size={15} />} disabled={sameRoles(form, PERMISSION_DEFAULTS)} onClick={() => setPending({ kind: 'resetAll' })}>
            Reset to Defaults
          </Button>
          <Button disabled={!dirty} onClick={() => setForm(saved)}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Save size={15} />} disabled={!dirty || saving} onClick={() => void save()}>
            Save Changes
          </Button>
        </div>
      </footer>

      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        message={dialog?.message}
        confirmLabel={dialog?.label}
        danger={dialog?.danger}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

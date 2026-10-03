import { useCallback, useEffect, useMemo, useState } from 'react';
import { MonitorSmartphone, SearchX, ShieldCheck, UserCheck, UserPlus, Users } from 'lucide-react';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import Pagination from '../../components/ui/Pagination';
import SearchBar from '../../components/ui/SearchBar';
import Select from '../../components/ui/Select';
import Tabs from '../../components/ui/Tabs';
import StaffTable from '../../components/admin/staff/StaffTable';
import StaffForm from '../../components/admin/staff/StaffForm';
import StaffDetails from '../../components/admin/staff/StaffDetails';
import PasswordReset from '../../components/admin/staff/PasswordReset';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import LoadingState from '../../components/ui/LoadingState';
import { TERMINALS, type StaffDraft, type StaffMember } from '../../types/auth';
import type { StaffDto } from '../../types/api';
import { errorMessage } from '../../services/api';
import { createStaff, listStaff, resetCredential, setStaffActive, updateStaff } from '../../services/staffService';
import { actionLabel, staffActivity } from '../../services/auditService';
import '../../components/admin/products/products.css';
import '../../components/admin/staff/staff.css';

const ALL = 'all';
const PAGE_SIZE = 10;

const REMOVE_BLOCKED = 'Staff accounts are never deleted (their history must be kept). Deactivate the account instead.';

function toMember(d: StaffDto): StaffMember {
  return {
    id: d.id,
    code: d.code,
    fullName: d.full_name,
    username: d.username,
    role: d.role === 'admin' ? 'Admin' : 'Cashier',
    terminal: 'Unassigned',
    status: d.status === 'active' ? 'Active' : 'Inactive',
    authMethod: d.auth_method,
    createdAt: new Date(),
    lastActiveAt: null,
    passwordSetAt: new Date(),
    mustChangePassword: d.must_change_credential,
    activity: [],
  };
}

// User access management (GET/POST/PATCH /staff, activate/deactivate, reset-credential).
// Credentials are sent once and never stored or shown. The server enforces the protections
// (last active Admin, no self-escalation, Admin → password only). Accounts are never deleted.

export default function AdminStaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setStaff((await listStaff()).map(toMember));
      setLoaded(true);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [terminal, setTerminal] = useState(ALL);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [resetting, setResetting] = useState<StaffMember | null>(null);
  const [deactivating, setDeactivating] = useState<{ member: StaffMember; draft?: StaffDraft } | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  // Recent Activity of the selected member (GET /staff/{id}/activity).
  const [activity, setActivity] = useState<Record<string, StaffMember['activity']>>({});
  useEffect(() => {
    if (!selectedId) return;
    staffActivity(selectedId)
      .then((rows) =>
        setActivity((prev) => ({
          ...prev,
          [selectedId]: rows.map((r) => ({ id: r.id, at: new Date(r.created_at), text: actionLabel(r.action) })).reverse(),
        })),
      )
      .catch(() => undefined);
  }, [selectedId, staff]);
  const found = staff.find((m) => m.id === selectedId) ?? null;
  const selected = found && { ...found, activity: activity[found.id] ?? found.activity };

  const counts = useMemo(() => {
    const active = staff.filter((m) => m.status === 'Active');
    const terminals = new Set(staff.filter((m) => m.status === 'Active' && m.terminal !== 'Unassigned' && m.terminal !== 'All Terminals').map((m) => m.terminal));
    return {
      total: staff.length,
      admins: staff.filter((m) => m.role === 'Admin').length,
      cashiers: staff.filter((m) => m.role === 'Cashier').length,
      active: active.length,
      inactive: staff.length - active.length,
      terminals: [...terminals].sort(),
    };
  }, [staff]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    return staff.filter(
      (m) =>
        (role === ALL || m.role === role) &&
        (status === ALL || m.status === status) &&
        (terminal === ALL || m.terminal === terminal) &&
        (!q || m.fullName.toLowerCase().includes(q) || m.username.includes(q)),
    );
  }, [staff, query, role, status, terminal]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const save = async (draft: StaffDraft, credential: { method: 'password' | 'pin'; value: string } | null) => {
    if (editing) {
      const role = draft.role === 'Admin' ? 'admin' : 'cashier';
      if (draft.username !== editing.username) await updateStaff(editing.id, { username: draft.username });
      await updateStaff(editing.id, { full_name: draft.fullName, ...(draft.role !== editing.role ? { role } : {}) });
      if (draft.status !== editing.status) await setStaffActive(editing.id, draft.status === 'Active');
      await refresh();
      setFeedback(`${draft.fullName} updated`);
      setFormOpen(false);
      setEditing(null);
      return;
    }
    if (!credential) return;
    const created = await createStaff({
      full_name: draft.fullName,
      username: draft.username,
      role: draft.role === 'Admin' ? 'admin' : 'cashier',
      auth_method: credential.method,
      credential: credential.value,
    });
    await refresh();
    setSelectedId(created.id);
    setFeedback(`${created.full_name} added · must change the temporary ${credential.method === 'pin' ? 'PIN' : 'password'} at first sign-in`);
    setFormOpen(false);
    setEditing(null);
  };

  const setActive = async (m: StaffMember, active: boolean) => {
    try {
      await setStaffActive(m.id, active);
      await refresh();
      setFeedback(`${m.fullName} ${active ? 'reactivated' : 'deactivated'}`);
    } catch (err) {
      setFeedback(errorMessage(err));
    }
  };
  const toggleStatus = (m: StaffMember) => (m.status === 'Active' ? setDeactivating({ member: m }) : void setActive(m, true));
  const confirmDeactivate = () => {
    if (!deactivating) return;
    const { member } = deactivating;
    setDeactivating(null);
    void setActive(member, false);
  };
  const confirmRemove = () => {
    setRemoving(null);
    setFeedback(REMOVE_BLOCKED);
  };
  const resetPassword = async (m: StaffMember, credential: string) => {
    await resetCredential(m.id, credential);
    setResetting(null);
    await refresh();
    setFeedback(`${m.fullName}'s ${m.authMethod === 'pin' ? 'PIN' : 'password'} was reset · must change it at next sign-in`);
  };
  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (m: StaffMember) => {
    setEditing(m);
    setFormOpen(true);
  };

  const kpis = [
    { key: 'total', label: 'Total Staff', value: String(counts.total), sub: `${counts.cashiers} Cashier${counts.cashiers === 1 ? '' : 's'} · ${counts.admins} Admin${counts.admins === 1 ? '' : 's'}`, icon: Users },
    { key: 'active', label: 'Active Accounts', value: String(counts.active), sub: `${counts.inactive} inactive`, icon: UserCheck, tone: 'success' },
    { key: 'terminals', label: 'Assigned Terminals', value: String(counts.terminals.length), sub: counts.terminals.length ? counts.terminals.join(', ') : 'None assigned yet', icon: MonitorSmartphone },
    { key: 'security', label: 'Access Security', value: 'Password / PIN', sub: `${staff.filter((m) => m.mustChangePassword).length} must change temporary credential`, icon: ShieldCheck },
  ];

  const noStaff = staff.length === 0;

  return (
    <div className={`admin-staff ${selected ? '' : 'admin-staff--no-panel'}`}>
      <div className="staff-main">
        <section className="staff-toolbar">
          <SearchBar
            className="staff-toolbar__search"
            placeholder="Search staff by name or username…"
            aria-label="Search staff"
            value={query}
            onChange={(e) => resetPage(setQuery)(e.target.value)}
          />
          <div className="staff-toolbar__role">
            <span>Role:</span>
            <Tabs
              items={[
                { value: ALL, label: 'All', count: counts.total },
                { value: 'Admin', label: 'Admin', count: counts.admins },
                { value: 'Cashier', label: 'Cashier', count: counts.cashiers },
              ]}
              value={role}
              onChange={resetPage(setRole)}
            />
          </div>
          <Select
            className="staff-toolbar__select"
            aria-label="Filter by status"
            value={status}
            onChange={(e) => resetPage(setStatus)(e.target.value)}
            options={[
              { value: ALL, label: 'Status: All Statuses' },
              { value: 'Active', label: 'Status: Active' },
              { value: 'Inactive', label: 'Status: Inactive' },
            ]}
          />
          <Select
            className="staff-toolbar__select"
            aria-label="Filter by terminal"
            value={terminal}
            onChange={(e) => resetPage(setTerminal)(e.target.value)}
            options={[{ value: ALL, label: 'Terminal: All' }, ...TERMINALS.map((t) => ({ value: t, label: `Terminal: ${t}` }))]}
          />
          <Button variant="primary" icon={<UserPlus size={16} />} onClick={openAdd}>
            Add Staff
          </Button>
        </section>

        <section className="staff-kpis" aria-label="Staff summary">
          {kpis.map(({ key, label, value, sub, icon: Icon, tone }) => (
            <article key={key} className={`staff-kpi ${tone ? `staff-kpi--${tone}` : ''}`}>
              <div>
                <span className="staff-kpi__label">{label}</span>
                <strong className="staff-kpi__value">{value}</strong>
                <p>{sub}</p>
              </div>
              <span className="staff-kpi__icon">
                <Icon size={18} />
              </span>
            </article>
          ))}
        </section>

        <section className="staff-card">
          {!loaded && (loadError ? (
            <EmptyState icon={<SearchX size={22} />} title="Could not load staff" description={loadError} action={<Button onClick={() => void refresh()}>Try again</Button>} />
          ) : (
            <LoadingState label="Loading staff…" />
          ))}
          {loaded && <StaffTable
            staff={rows}
            selectedId={selectedId}
            onSelect={(m) => setSelectedId(m.id)}
            onEdit={openEdit}
            onResetPassword={setResetting}
            onToggleStatus={toggleStatus}
            onRemove={setRemoving}
            empty={
              noStaff ? (
                <EmptyState
                  icon={<Users size={22} />}
                  title="No staff accounts yet"
                  description="Add staff members to give your team access to BrewSync."
                  action={
                    <Button variant="primary" icon={<UserPlus size={16} />} onClick={openAdd}>
                      Add Staff
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon={<SearchX size={22} />} title="No staff match" description="Try a different name, username, role, status, or terminal." />
              )
            }
          />}
          {!noStaff && (
            <footer className="staff-footer">
              <span>
                Showing {filtered.length ? (current - 1) * PAGE_SIZE + 1 : 0} to {Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length} staff profile{filtered.length === 1 ? '' : 's'}
              </span>
              {pageCount > 1 && <Pagination page={current} pageCount={pageCount} onChange={setPage} />}
            </footer>
          )}
        </section>
      </div>

      {selected && (
        <StaffDetails
          member={selected}
          onClose={() => setSelectedId(null)}
          onEdit={() => openEdit(selected)}
          onResetPassword={() => setResetting(selected)}
          onToggleStatus={() => toggleStatus(selected)}
        />
      )}

      <StaffForm
        open={formOpen}
        member={editing}
        existingUsernames={staff.map((m) => m.username)}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSave={save}
      />
      <PasswordReset member={resetting} onClose={() => setResetting(null)} onReset={resetPassword} />
      <ConfirmDialog
        open={deactivating !== null}
        title="Deactivate staff account?"
        message={deactivating && `${deactivating.member.fullName} (@${deactivating.member.username}) will no longer be able to access BrewSync. You can reactivate the account later.`}
        confirmLabel="Deactivate Account"
        danger
        onConfirm={confirmDeactivate}
        onCancel={() => setDeactivating(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Remove staff account?"
        message={removing && `${removing.fullName} (@${removing.username}) will be removed from this list. This cannot be undone.`}
        confirmLabel="Remove Account"
        danger
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

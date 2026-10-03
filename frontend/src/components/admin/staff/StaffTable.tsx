import { KeyRound, Pencil, Power, Trash2 } from 'lucide-react';
import Badge from '../../ui/Badge';
import Table, { type TableColumn } from '../../ui/Table';
import type { StaffMember } from '../../../types/auth';

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export function formatLastActive(d: Date | null) {
  if (!d) return 'Never signed in';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} hours ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function RoleBadge({ role }: { role: StaffMember['role'] }) {
  return <span className={`staff-role staff-role--${role.toLowerCase()}`}>{role}</span>;
}

export function StatusBadge({ status }: { status: StaffMember['status'] }) {
  return (
    <Badge tone={status === 'Active' ? 'success' : 'neutral'} dot>
      {status}
    </Badge>
  );
}

interface StaffTableProps {
  staff: StaffMember[];
  selectedId: string | null;
  onSelect: (m: StaffMember) => void;
  onEdit: (m: StaffMember) => void;
  onResetPassword: (m: StaffMember) => void;
  onToggleStatus: (m: StaffMember) => void;
  onRemove: (m: StaffMember) => void;
  empty: React.ReactNode;
}

export default function StaffTable({ staff, selectedId, onSelect, onEdit, onResetPassword, onToggleStatus, onRemove, empty }: StaffTableProps) {
  const columns: TableColumn<StaffMember>[] = [
    {
      key: 'staff',
      header: 'Staff',
      width: '26%',
      render: (m) => (
        <div className="staff-name">
          <span className={`staff-avatar staff-avatar--${m.role.toLowerCase()}`}>{initials(m.fullName)}</span>
          <div>
            <strong>{m.fullName}</strong>
            <span>#{m.code}</span>
          </div>
        </div>
      ),
    },
    { key: 'username', header: 'Username', width: '15%', render: (m) => <span className="staff-username">@{m.username}</span> },
    { key: 'role', header: 'Role', width: '11%', render: (m) => <RoleBadge role={m.role} /> },
    { key: 'terminal', header: 'Terminal', width: '13%', render: (m) => <span className={`staff-terminal ${m.terminal === 'Unassigned' ? 'staff-muted' : ''}`}>{m.terminal}</span> },
    { key: 'status', header: 'Status', width: '11%', render: (m) => <StatusBadge status={m.status} /> },
    { key: 'active', header: 'Last Active', width: '12%', render: (m) => <span className="staff-muted">{formatLastActive(m.lastActiveAt)}</span> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '12%',
      render: (m) => (
        <div className="staff-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="icon-btn" aria-label={`Edit ${m.fullName}`} title="Edit" onClick={() => onEdit(m)}>
            <Pencil size={14} />
          </button>
          <button type="button" className="icon-btn" aria-label={`Reset password for ${m.fullName}`} title="Reset password" onClick={() => onResetPassword(m)}>
            <KeyRound size={14} />
          </button>
          <button
            type="button"
            className={`icon-btn ${m.status === 'Active' ? 'staff-deactivate' : 'staff-activate'}`}
            aria-label={`${m.status === 'Active' ? 'Deactivate' : 'Activate'} ${m.fullName}`}
            title={m.status === 'Active' ? 'Deactivate' : 'Activate'}
            onClick={() => onToggleStatus(m)}
          >
            <Power size={14} />
          </button>
          {m.status === 'Inactive' && (
            <button type="button" className="icon-btn staff-remove" aria-label={`Remove ${m.fullName}`} title="Remove account" onClick={() => onRemove(m)}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="staff-table">
      <Table
        columns={columns}
        rows={staff}
        rowKey={(m) => m.id}
        onRowClick={onSelect}
        rowClassName={(m) => [m.id === selectedId && 'staff-row--selected', m.status === 'Inactive' && 'staff-row--inactive'].filter(Boolean).join(' ') || undefined}
        empty={empty}
      />
    </div>
  );
}

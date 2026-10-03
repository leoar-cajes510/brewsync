import { useNavigate } from 'react-router-dom';
import { CheckCircle2, KeyRound, Lock, MinusCircle, Pencil, Power, X } from 'lucide-react';
import Button from '../../ui/Button';
import { RoleBadge, StatusBadge, formatLastActive, initials } from './StaffTable';
import type { StaffMember } from '../../../types/auth';

// Role defaults shown for reference only. The actual permission configuration
// lives in Settings → Permissions and is not duplicated here.
const ACCESS: { area: string; cashier: boolean }[] = [
  { area: 'POS & Counter Sales', cashier: true },
  { area: 'Orders & Queue', cashier: true },
  { area: 'Receipts & Reprint', cashier: true },
  { area: 'Transaction History', cashier: true },
  { area: 'Admin (Products, Inventory, Expenses…)', cashier: false },
  { area: 'Settings', cashier: false },
];

const when = (d: Date) => d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

interface StaffDetailsProps {
  member: StaffMember;
  onClose: () => void;
  onEdit: () => void;
  onResetPassword: () => void;
  onToggleStatus: () => void;
}

export default function StaffDetails({ member: m, onClose, onEdit, onResetPassword, onToggleStatus }: StaffDetailsProps) {
  const navigate = useNavigate();
  return (
    <aside className="staff-panel" aria-label="Staff profile and access">
      <header className="staff-panel__header">
        <div className="staff-panel__title">
          <h2>Staff Profile &amp; Access</h2>
          <span className="code-chip">#{m.code}</span>
        </div>
        <button type="button" className="icon-btn" aria-label="Close details" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className="staff-panel__body">
        <div className="staff-profile">
          <span className={`staff-avatar staff-avatar--lg staff-avatar--${m.role.toLowerCase()}`}>{initials(m.fullName)}</span>
          <div className="staff-profile__text">
            <div className="staff-profile__name">
              <strong>{m.fullName}</strong>
              <RoleBadge role={m.role} />
            </div>
            <span>@{m.username}</span>
            <em>Added {m.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</em>
          </div>
          <StatusBadge status={m.status} />
        </div>

        <dl className="staff-facts">
          <dt>User ID</dt>
          <dd>{m.code}</dd>
          <dt>Last Active</dt>
          <dd>{formatLastActive(m.lastActiveAt)}</dd>
        </dl>

        <section className="staff-section">
          <h3>Assigned Terminal</h3>
          {/* Restricting staff to a terminal is an open decision (Q-TRM-6) and no assignment is stored:
              show the real behaviour instead of a selector that changes nothing (STF-10). */}
          <p className="staff-hint">Any activated terminal. Assigning staff to specific terminals is not available yet.</p>
        </section>

        <section className="staff-section staff-security">
          <div className="staff-section__head">
            <h3>Security Credentials</h3>
            <span className="staff-security__lock">
              <Lock size={12} /> Hidden
            </span>
          </div>
          <div className="staff-security__grid">
            <div>
              <span>Username</span>
              <strong>@{m.username}</strong>
            </div>
            <div>
              <span>Password</span>
              <strong aria-label="Password hidden">••••••••</strong>
            </div>
          </div>
          <div className="staff-security__foot">
            <span>
              Last set {when(m.passwordSetAt)}
              {m.mustChangePassword && ' · change required at next sign-in'}
            </span>
            <Button size="sm" icon={<KeyRound size={13} />} onClick={onResetPassword}>
              Reset Password
            </Button>
          </div>
        </section>

        <section className="staff-section">
          <div className="staff-section__head">
            <h3>Role Access</h3>
            <button type="button" className="staff-link" onClick={() => navigate('/settings/permissions')}>
              Settings → Permissions
            </button>
          </div>
          <ul className="staff-access">
            {ACCESS.map((a) => {
              const granted = m.role === 'Admin' || a.cashier;
              return (
                <li key={a.area} className={granted ? '' : 'staff-access--no'}>
                  {granted ? <CheckCircle2 size={14} /> : <MinusCircle size={14} />}
                  <span>{a.area}</span>
                  <em>{granted ? 'Granted' : 'No access'}</em>
                </li>
              );
            })}
          </ul>
          <p className="staff-hint">{m.role} role defaults. Configure permissions in Settings.</p>
        </section>

        <section className="staff-section">
          <h3>Recent Activity</h3>
          <ul className="staff-activity">
            {[...m.activity].reverse().slice(0, 6).map((a) => (
              <li key={a.id}>
                <span>{a.text}</span>
                <em>{when(a.at)}</em>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="staff-panel__footer">
        <div className="staff-panel__footer-row">
          <Button icon={<KeyRound size={14} />} onClick={onResetPassword}>
            Reset Password
          </Button>
          <Button variant="primary" icon={<Pencil size={14} />} onClick={onEdit}>
            Edit Staff
          </Button>
        </div>
        <button type="button" className={`staff-panel__status ${m.status === 'Active' ? 'staff-panel__status--off' : ''}`} onClick={onToggleStatus}>
          <Power size={13} /> {m.status === 'Active' ? `Deactivate ${m.fullName.split(' ')[0]}’s Account` : `Activate ${m.fullName.split(' ')[0]}’s Account`}
        </button>
      </footer>
    </aside>
  );
}

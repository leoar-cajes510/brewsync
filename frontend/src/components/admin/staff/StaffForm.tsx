import { useEffect, useId, useState } from 'react';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Modal from '../../ui/Modal';
import Select from '../../ui/Select';
import Tabs from '../../ui/Tabs';
import { PASSWORD_RULES, STAFF_ROLES, USERNAME_PATTERN, type StaffDraft, type StaffMember, type StaffRole, type StaffStatus } from '../../../types/auth';
import { errorMessage } from '../../../services/api';

/** Password input: hidden by default, with a show/hide control. Never pre-filled. */
export function PasswordField({ label, value, onChange, error, autoComplete = 'new-password' }: { label: string; value: string; onChange: (v: string) => void; error?: string; autoComplete?: string }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="pw-field">
        <input
          id={id}
          className={`input ${error ? 'input--error' : ''}`}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="pw-field__toggle" aria-label={visible ? `Hide ${label}` : `Show ${label}`} aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}

export function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="pw-rules" aria-label="Password requirements">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(password);
        return (
          <li key={r.label} className={ok ? 'pw-rules__ok' : ''}>
            {ok ? <Check size={12} /> : <X size={12} />} {r.label}
          </li>
        );
      })}
    </ul>
  );
}

interface StaffFormProps {
  open: boolean;
  /** null = adding a new account. */
  member: StaffMember | null;
  existingUsernames: string[];
  onClose: () => void;
  /** New accounts: the temporary credential is sent once to the server and never stored here. */
  onSave: (draft: StaffDraft, credential: { method: 'password' | 'pin'; value: string } | null) => Promise<void>;
}

const blank: StaffDraft = { fullName: '', username: '', role: 'Cashier', terminal: 'Unassigned', status: 'Active' };

// Shared by Add Staff and Edit Staff. In edit mode the username is fixed and
// passwords are handled by Reset Password instead.
export default function StaffForm({ open, member, existingUsernames, onClose, onSave }: StaffFormProps) {
  const [draft, setDraft] = useState<StaffDraft>(blank);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [method, setMethod] = useState<'password' | 'pin'>('password');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    setSaveError(null);
    setSaving(false);
    setMethod('password');
    setPassword('');
    setConfirm('');
    setDraft(member ? { fullName: member.fullName, username: member.username, role: member.role, terminal: member.terminal, status: member.status } : blank);
  }, [open, member]);

  const set = (patch: Partial<StaffDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const username = draft.username.trim().toLowerCase();
  // Admin accounts sign in with a password only (Q-AUTH-2).
  const effectiveMethod = draft.role === 'Admin' ? 'password' : method;
  const credentialLabel = effectiveMethod === 'pin' ? 'PIN' : 'Password';

  const errors = {
    fullName: !draft.fullName.trim() ? 'Full name is required.' : undefined,
    username: member
      ? undefined
      : !username
        ? 'Username is required.'
        : !USERNAME_PATTERN.test(username)
          ? '3–20 characters: lowercase letters, numbers, . _ -'
          : existingUsernames.includes(username)
            ? 'This username is already taken.'
            : undefined,
    // Length/format rules are the business's credential policy, enforced by the server.
    password: member ? undefined : !password ? `Enter a temporary ${credentialLabel.toLowerCase()}.` : undefined,
    confirm: member ? undefined : !confirm ? 'Confirm the password.' : confirm !== password ? 'Passwords do not match.' : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);

  const submit = async () => {
    setSubmitted(true);
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...draft, fullName: draft.fullName.trim(), username }, member ? null : { method: effectiveMethod, value: password });
      // Clear secrets from memory immediately.
      setPassword('');
      setConfirm('');
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={member ? `Edit Staff · #${member.code}` : 'Add Staff'}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : member ? 'Save Changes' : 'Create Account'}
          </Button>
        </>
      }
    >
      <form className="staff-form" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
        <Input className="staff-form__wide" label="Full Name" placeholder="e.g. Juan Dela Cruz" maxLength={60} value={draft.fullName} error={err('fullName')} onChange={(e) => set({ fullName: e.target.value })} autoFocus />
        {member ? (
          <div className="field staff-form__wide">
            <span className="field__label">Username</span>
            <p className="staff-form__readonly">
              @{member.username} <em>Usernames can’t be changed.</em>
            </p>
          </div>
        ) : (
          <Input
            className="staff-form__wide"
            label="Username"
            placeholder="e.g. juan"
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
            value={draft.username}
            error={err('username')}
            hint="Used to sign in. Lowercase letters, numbers, . _ -"
            onChange={(e) => set({ username: e.target.value.toLowerCase() })}
          />
        )}
        <div className="field">
          <span className="field__label">Role</span>
          <Tabs items={STAFF_ROLES.map((r) => ({ value: r, label: r }))} value={draft.role} onChange={(v) => set({ role: v as StaffRole })} />
          <span className="field__hint">{draft.role === 'Admin' ? 'Broader access, including Admin and Settings.' : 'Normal operating access (POS, Orders, Receipts, History).'}</span>
        </div>
        {!member && (
          <Select
            label="Sign-in Method"
            value={effectiveMethod}
            disabled={draft.role === 'Admin'}
            onChange={(e) => setMethod(e.target.value as 'password' | 'pin')}
            options={[
              { value: 'password', label: 'Password' },
              { value: 'pin', label: 'PIN' },
            ]}
          />
        )}
        {!member && (
          <>
            <PasswordField label={`Temporary ${credentialLabel}`} value={password} onChange={setPassword} error={err('password')} />
            <PasswordField label={`Confirm ${credentialLabel}`} value={confirm} onChange={setConfirm} error={err('confirm')} />
          </>
        )}
        {member && (
        <div className="field staff-form__wide">
          <span className="field__label">Status</span>
          <Tabs
            items={[
              { value: 'Active', label: 'Active' },
              { value: 'Inactive', label: 'Inactive' },
            ]}
            value={draft.status}
            onChange={(v) => set({ status: v as StaffStatus })}
          />
        </div>
        )}
        {saveError && (
          <div className="api-status api-status--error staff-form__wide" role="alert">
            {saveError}
          </div>
        )}
        <p className="staff-form__note staff-form__wide">
          {member ? 'Username changes are not available yet (open decision Q-AUTH-5). Terminal assignment is an open decision (Q-TRM-6).' : 'The new user must change this temporary credential at first sign-in.'}
        </p>
      </form>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import Button from '../../ui/Button';
import Modal from '../../ui/Modal';
import { PasswordField, PasswordRules } from './StaffForm';
import { errorMessage } from '../../../services/api';
import type { StaffMember } from '../../../types/auth';

interface PasswordResetProps {
  member: StaffMember | null;
  onClose: () => void;
  /** Sends the temporary credential once (POST /staff/{id}/reset-credential); it is never stored here. */
  onReset: (member: StaffMember, credential: string) => Promise<void>;
}

// Admin-initiated reset. The current credential can never be viewed. The temporary password or
// PIN (per the account's method) is checked against the business policy by the server, and the
// user must change it at next sign-in.
export default function PasswordReset({ member, onClose, onReset }: PasswordResetProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    setPassword('');
    setConfirm('');
    setSubmitted(false);
    setServerError(null);
  }, [member]);

  if (!member) return null;

  const label = member.authMethod === 'pin' ? 'PIN' : 'Password';
  const pwError = !password ? `Enter a temporary ${label.toLowerCase()}.` : undefined;
  const confirmError = !confirm ? `Confirm the new ${label.toLowerCase()}.` : confirm !== password ? `${label}s do not match.` : undefined;

  const submit = async () => {
    setSubmitted(true);
    if (pwError || confirmError || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      await onReset(member, password);
      setPassword('');
      setConfirm('');
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={
        <span className="pw-reset__title">
          <KeyRound size={16} /> Reset {label}
        </span>
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Resetting…' : `Reset ${label}`}
          </Button>
        </>
      }
    >
      <form className="pw-reset" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
        <div className="pw-reset__who">
          <strong>{member.fullName}</strong>
          <span>
            @{member.username} · #{member.code}
          </span>
        </div>
        <p className="pw-reset__info">
          <ShieldCheck size={14} /> The current {label.toLowerCase()} can’t be viewed. Set a temporary one and share it with {member.fullName.split(' ')[0]} in person.
        </p>
        <PasswordField label={`New ${label}`} value={password} onChange={setPassword} error={submitted ? pwError : undefined} />
        <PasswordField label={`Confirm New ${label}`} value={confirm} onChange={setConfirm} error={submitted ? confirmError : undefined} />
        {member.authMethod !== 'pin' && <PasswordRules password={password} />}
        {serverError && (
          <div className="api-status api-status--error" role="alert">
            {serverError}
          </div>
        )}
        <p className="staff-form__note">The user must change this temporary {label.toLowerCase()} at their next sign-in.</p>
      </form>
    </Modal>
  );
}

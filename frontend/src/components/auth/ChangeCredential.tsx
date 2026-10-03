import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { errorMessage } from '../../services/api';
import { changePassword, changePin } from '../../services/authService';
import { refreshUser, signOut } from '../../stores/authStore';

// Shown while must_change_credential is set: every other endpoint answers
// CREDENTIAL_CHANGE_REQUIRED until the temporary password/PIN is replaced.
// The account's method is not exposed by /auth/me, so the user picks it; the
// server rejects the wrong one (AUTH_METHOD_NOT_ALLOWED).
export default function ChangeCredential() {
  const [method, setMethod] = useState<'password' | 'pin'>('password');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!current || !next) return setError('Fill in both fields.');
    if (next !== confirm) return setError('The new values do not match.');
    setSubmitting(true);
    setError(null);
    try {
      await (method === 'pin' ? changePin(current, next) : changePassword(current, next));
      await refreshUser();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const label = method === 'pin' ? 'PIN' : 'Password';

  return (
    <form
      className="auth-card"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <header className="auth-card__header">
        <h1>Change your temporary {label.toLowerCase()}</h1>
        <p>Your account was created with a temporary credential. Set your own before continuing.</p>
      </header>
      <div className="auth-method">
        <Button variant={method === 'password' ? 'primary' : 'secondary'} size="sm" onClick={() => setMethod('password')}>
          Password account
        </Button>
        <Button variant={method === 'pin' ? 'primary' : 'secondary'} size="sm" onClick={() => setMethod('pin')}>
          PIN account
        </Button>
      </div>
      <Input label={`Current ${label}`} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Input label={`New ${label}`} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      <Input label={`Confirm New ${label}`} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && <div className="auth-error" role="alert">{error}</div>}
      <Button type="submit" variant="primary" size="lg" block icon={<KeyRound size={18} />} disabled={submitting}>
        {submitting ? 'Saving…' : `Save ${label}`}
      </Button>
      <Button block onClick={() => void signOut()}>
        Sign out
      </Button>
    </form>
  );
}

import { useState } from 'react';
import { ArrowRight, Clock, Eye, EyeOff, Info, Lock, LockKeyhole, MonitorSmartphone, UserSquare2 } from 'lucide-react';
import { ApiError, errorMessage } from '../../services/api';
import { hasDevice, signIn } from '../../stores/authStore';

interface LoginFormProps {
  notice: string | null;
  /** Pre-filled after a manual lock (R14.11). */
  initialUsername?: string;
  /** Terminal code just activated on this device (known only right after activation). */
  terminalCode?: string | null;
  onActivate: () => void;
}

// Username + password or PIN; the server accepts only the account's selected method (Q-AUTH-2)
// and returns one generic error for any sign-in failure. The credential field always starts
// empty: it stays read-only until focused so the browser cannot pre-fill a saved credential
// on a shared terminal.
export default function LoginForm({ notice, initialUsername = '', terminalCode, onActivate }: LoginFormProps) {
  const [username, setUsername] = useState(initialUsername);
  const [credential, setCredential] = useState('');
  const [credentialReady, setCredentialReady] = useState(false);
  const [showCredential, setShowCredential] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const device = hasDevice();

  const submit = async () => {
    if (!username.trim() || !credential) {
      setError('Enter your username and password or PIN.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(username.trim().toLowerCase(), credential);
    } catch (err) {
      setCredential('');
      if (err instanceof ApiError && err.code === 'TERMINAL_NOT_ACTIVATED') {
        setError('This device is not an activated terminal. Activate it with a code from an Admin (below).');
      } else if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
        setError('Sign-in failed. Check your username and password or PIN.');
      } else if (err instanceof ApiError && err.code === 'ACCOUNT_LOCKED') {
        setError('This account is temporarily locked after too many failed attempts.');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const invalid = error !== null;

  return (
    <form
      className="login-form"
      noValidate
      autoComplete="off"
      aria-busy={submitting}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <header className="login-form__header login-enter">
        <h1>Welcome back</h1>
        <p>Sign in to continue to BrewSync.</p>
      </header>

      <div className="login-notice login-enter" role="status">
        <Info size={16} />
        <div>
          <strong>{notice ? 'Session notice' : 'Terminal authentication'}</strong>
          <p>
            {notice ??
              (device
                ? 'This device is an activated terminal. Enter your credentials to start a session.'
                : 'This device is not activated as a terminal yet. An Admin can provide a terminal activation code.')}
          </p>
        </div>
      </div>

      <div className={`login-field login-enter ${invalid ? 'login-field--error' : ''}`}>
        <label htmlFor="login-username">Username</label>
        <div className="login-field__control">
          <UserSquare2 size={18} aria-hidden="true" />
          <input
            id="login-username"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Enter your username"
            value={username}
            disabled={submitting}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'login-error' : undefined}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <div className={`login-field login-enter ${invalid ? 'login-field--error' : ''}`}>
        <div className="login-field__label-row">
          <label htmlFor="login-credential">Password or PIN</label>
          <span>Use the one set for your account</span>
        </div>
        <div className="login-field__control">
          <Lock size={18} aria-hidden="true" />
          <input
            id="login-credential"
            className="input"
            type={showCredential ? 'text' : 'password'}
            autoComplete="off"
            readOnly={!credentialReady}
            onFocus={() => setCredentialReady(true)}
            placeholder="Enter your password or PIN"
            value={credential}
            disabled={submitting}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'login-error' : undefined}
            onChange={(e) => setCredential(e.target.value)}
          />
          <button
            type="button"
            className="login-field__toggle"
            aria-label={showCredential ? 'Hide password or PIN' : 'Show password or PIN'}
            aria-pressed={showCredential}
            aria-controls="login-credential"
            disabled={submitting}
            onClick={() => setShowCredential((v) => !v)}
          >
            {showCredential ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <div className="login-form__meta">
          <span>
            <Clock size={13} /> Auto-lock after inactivity
          </span>
        </div>
      </div>

      {error && (
        <div id="login-error" className="auth-error login-error" role="alert">
          {error}
        </div>
      )}

      <button type="submit" className={`login-submit login-enter ${submitting ? 'login-submit--busy' : ''}`} disabled={submitting}>
        {submitting ? (
          <>
            <span className="login-submit__spinner" aria-hidden="true" /> Signing in…
          </>
        ) : (
          <>
            Sign in <ArrowRight size={18} className="login-submit__arrow" />
          </>
        )}
      </button>

      <div className="login-secure login-enter">
        <LockKeyhole size={18} />
        <div>
          <strong>Admin area secured</strong>
          <span>Back-office pages require the Admin role, verified by the server.</span>
        </div>
        <span className="login-secure__badge">Role-based</span>
      </div>

      <div className="login-station login-enter">
        <span>
          <MonitorSmartphone size={14} />
          {terminalCode ? `Station: Terminal ${terminalCode}` : device ? 'Station: activated terminal' : 'Station: not activated'}
        </span>
        <button type="button" className="link-btn" onClick={onActivate} disabled={submitting}>
          {device ? 'Change terminal' : 'Activate this device'}
        </button>
      </div>
    </form>
  );
}

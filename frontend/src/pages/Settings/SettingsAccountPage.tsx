import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Circle, Eye, EyeOff, Info, KeyRound, Lock, LogOut, MonitorSmartphone, Save, ShieldCheck, UserRound } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Input from '../../components/ui/Input';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { refreshUser, signOut, useAuth } from '../../stores/authStore';
import { errorMessage } from '../../services/api';
import { changePassword as apiChangePassword, changePin as apiChangePin, updateMe } from '../../services/authService';
import '../../components/settings/settingsAccount.css';

type PwKey = 'current' | 'next' | 'confirm';
const PW_FIELDS: { key: PwKey; label: string; placeholder: string; autoComplete: string }[] = [
  { key: 'current', label: 'Current Password', placeholder: 'Enter current password', autoComplete: 'current-password' },
  { key: 'next', label: 'New Password', placeholder: 'Enter new password', autoComplete: 'new-password' },
  { key: 'confirm', label: 'Confirm New Password', placeholder: 'Repeat new password', autoComplete: 'new-password' },
];
const EMPTY_PW: Record<PwKey, string> = { current: '', next: '', confirm: '' };

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// The CURRENT user's profile, password UI, session, and logout. Sign-in is not
// connected yet: identity fields stay unassigned, passwords are only checked
// in the browser and then cleared, and logout is simulated.
export default function SettingsAccountPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sessionStartedAt] = useState(() => new Date());
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const savedName = user?.full_name ?? '';
  const online = useOnline();
  const now = useNow();
  const [fullName, setFullName] = useState(savedName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pw, setPw] = useState(EMPTY_PW);
  const [visible, setVisible] = useState<Record<PwKey, boolean>>({ current: false, next: false, confirm: false });
  const [pwErrors, setPwErrors] = useState<Partial<Record<PwKey, string>>>({});
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  useEffect(() => setFullName(savedName), [savedName]);

  const isPin = user?.auth_method === 'pin';
  const credLabel = isPin ? 'PIN' : 'password';
  const dirty = fullName.trim() !== savedName;
  const displayName = fullName.trim() || savedName || '—';
  const username = user?.username ?? '—';
  const roleLabel = user ? (user.role === 'admin' ? 'Admin' : 'Cashier') : '—';
  const terminalLabel = user?.terminal_code ? `${user.terminal_code}${user.terminal_name ? ` · ${user.terminal_name}` : ''}` : 'No terminal session';

  const saveProfile = async () => {
    const name = fullName.trim();
    if (name.length < 2) {
      setNameError('Enter at least 2 characters.');
      return;
    }
    setNameError(null);
    setBusy(true);
    try {
      await updateMe(name);
      await refreshUser();
      setSavedAt(new Date());
      setFeedback('Profile saved');
    } catch (e) {
      setFeedback(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const setPwField = (k: PwKey, v: string) => {
    setPw((p) => ({ ...p, [k]: v }));
    setPwErrors((e) => ({ ...e, [k]: undefined }));
  };

  // Length/format policy is the business's credential policy, enforced by the server.
  const changePassword = async () => {
    const errors: Partial<Record<PwKey, string>> = {};
    if (!pw.current) errors.current = `Enter your current ${credLabel}.`;
    if (!pw.next) errors.next = `Enter a new ${credLabel}.`;
    else if (pw.next === pw.current) errors.next = `Choose a ${credLabel} different from your current one.`;
    if (!pw.confirm) errors.confirm = `Re-enter the new ${credLabel}.`;
    else if (pw.confirm !== pw.next) errors.confirm = `${isPin ? 'PINs' : 'Passwords'} do not match.`;
    setPwErrors(errors);
    if (Object.keys(errors).length) {
      setFeedback(`${isPin ? 'PIN' : 'Password'} not changed — check the highlighted fields`);
      return;
    }
    setBusy(true);
    try {
      await (isPin ? apiChangePin : apiChangePassword)(pw.current, pw.next);
      setFeedback(`${isPin ? 'PIN' : 'Password'} changed`);
    } catch (e) {
      setFeedback(errorMessage(e));
    } finally {
      // Never keep credentials in memory longer than needed.
      setPw(EMPTY_PW);
      setVisible({ current: false, next: false, confirm: false });
      setBusy(false);
    }
  };

  const logout = () => {
    setConfirmLogout(false);
    void signOut('logout').then(() => navigate('/login'));
  };

  const lastActive = Math.round((now.getTime() - sessionStartedAt.getTime()) / 60000);

  return (
    <div className="settings-account">
      <div className="ac-main">
        {/* Profile */}
        <section className="ac-card">
          <header className="ac-card__head">
            <span className="ac-card__icon">
              <UserRound size={17} />
            </span>
            <div>
              <h2>Account Profile</h2>
              <p>Your name and sign-in identity in BrewSync.</p>
            </div>
          </header>
          <div className="ac-identity">
            <span className="ac-avatar" aria-label="Profile avatar">
              {initials(displayName) || <UserRound size={22} />}
            </span>
            <div className="ac-identity__text">
              <div className="ac-identity__name">
                <strong data-testid="display-name">{displayName}</strong>
                <span className="ac-code">User ID: {user?.code ?? '—'}</span>
              </div>
              <p>Signed in as @{username}.</p>
            </div>
          </div>
          <div className="ac-fields">
            <Input
              label="Full Name"
              placeholder="Enter your name"
              maxLength={60}
              value={fullName}
              error={nameError ?? undefined}
              hint="Shown on the sidebar, orders, and receipts."
              onChange={(e) => {
                setFullName(e.target.value);
                setNameError(null);
              }}
            />
            <div className="field">
              <label className="field__label" htmlFor="ac-username">
                Username <span className="ac-locked-label">(read-only)</span>
              </label>
              <div className="ac-locked">
                <input id="ac-username" className="input" value={username} readOnly aria-readonly />
                <Lock size={14} />
              </div>
              <span className="field__hint">Usernames are set in Admin → Staff.</span>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="ac-role">
                Role <span className="ac-locked-label">(read-only)</span>
              </label>
              <div className="ac-locked">
                <input id="ac-role" className="input" value={roleLabel} readOnly aria-readonly />
                <Lock size={14} />
              </div>
              <span className="field__hint">Roles are managed in Admin → Staff and Settings → Permissions.</span>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="ac-status">
                Account Status <span className="ac-locked-label">(read-only)</span>
              </label>
              <div className="ac-locked">
                <input id="ac-status" className="input" value="Pending sign-in" readOnly aria-readonly />
                <Lock size={14} />
              </div>
            </div>
          </div>
        </section>

        {/* Security */}
        <section className="ac-card">
          <header className="ac-card__head">
            <span className="ac-card__icon">
              <KeyRound size={17} />
            </span>
            <div>
              <h2>Account Security</h2>
              <p>Change your password. Your current password is never shown.</p>
            </div>
          </header>
          <div className="ac-passwords">
            {PW_FIELDS.map((f) => (
              <div key={f.key} className="field" data-pw={f.key}>
                <label className="field__label" htmlFor={`ac-pw-${f.key}`}>
                  {f.label}
                </label>
                <div className="ac-pw">
                  <input
                    id={`ac-pw-${f.key}`}
                    className={`input ${pwErrors[f.key] ? 'input--error' : ''}`}
                    type={visible[f.key] ? 'text' : 'password'}
                    autoComplete={f.autoComplete}
                    placeholder={f.placeholder}
                    value={pw[f.key]}
                    onChange={(e) => setPwField(f.key, e.target.value)}
                  />
                  <button
                    type="button"
                    className="ac-pw__eye"
                    aria-label={`${visible[f.key] ? 'Hide' : 'Show'} ${f.label.toLowerCase()}`}
                    aria-pressed={visible[f.key]}
                    onClick={() => setVisible((v) => ({ ...v, [f.key]: !v[f.key] }))}
                  >
                    {visible[f.key] ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {pwErrors[f.key] && <span className="field__error">{pwErrors[f.key]}</span>}
              </div>
            ))}
          </div>
          <div className="ac-rules">
            <span>Requirements: set by the business (credential policy)</span>
            {pw.confirm && (
              <span className={`ac-rule ${pw.confirm === pw.next ? 'ac-rule--ok' : 'ac-rule--bad'}`} data-rule="match">
                {pw.confirm === pw.next ? <Check size={12} /> : <Circle size={10} />} {pw.confirm === pw.next ? 'Passwords match' : 'Passwords do not match'}
              </span>
            )}
          </div>
          <div className="ac-security__foot">
            <p>
              <Info size={13} /> Your {credLabel} must meet the business's credential policy, which the server checks. Fields are cleared after each attempt.
            </p>
            <Button variant="primary" icon={<KeyRound size={15} />} onClick={() => void changePassword()} disabled={busy}>
              Change Password
            </Button>
          </div>
        </section>

        {/* Session */}
        <section className="ac-card">
          <header className="ac-card__head">
            <span className="ac-card__icon">
              <MonitorSmartphone size={17} />
            </span>
            <div>
              <h2>Current Session</h2>
              <p>This browser session on BrewSync.</p>
            </div>
          </header>
          <dl className="ac-session">
            <div data-session="session">
              <dt>Current Session</dt>
              <dd>Active</dd>
            </div>
            <div data-session="terminal">
              <dt>Terminal</dt>
              <dd>{terminalLabel}</dd>
            </div>
            <div data-session="status">
              <dt>Session Status</dt>
              <dd className={online ? 'ac-online' : 'ac-offline'}>● {online ? 'Online' : 'Offline'}</dd>
            </div>
            <div data-session="lastActive">
              <dt>Last Active</dt>
              <dd>{lastActive < 1 ? 'Just now' : `${lastActive} min ago`}</dd>
            </div>
          </dl>
          <div className="ac-logout">
            <div>
              <strong>Log Out</strong>
              <span>End this session and return to the sign-in screen.</span>
            </div>
            <Button icon={<LogOut size={15} />} className="ac-logout__btn" onClick={() => setConfirmLogout(true)}>
              Log Out
            </Button>
          </div>
        </section>
      </div>

      <aside className="ac-side">
        <section className="ac-card">
          <header className="ac-card__head ac-card__head--plain">
            <div>
              <h2>Account Status</h2>
            </div>
          </header>
          <dl className="ac-status">
            <div data-status="status">
              <dt>Account Status</dt>
              <dd>
                <Badge tone="neutral" dot>
                  Pending sign-in
                </Badge>
              </dd>
            </div>
            <div data-status="role">
              <dt>Role</dt>
              <dd>
                <Badge tone="neutral">{roleLabel}</Badge>
              </dd>
            </div>
            <div data-status="terminal">
              <dt>Terminal</dt>
              <dd>
                <Badge tone="neutral">{user?.terminal_code ?? 'None'}</Badge>
              </dd>
            </div>
            <div data-status="session">
              <dt>Session</dt>
              <dd>
                <Badge tone={online ? 'success' : 'warning'} dot>
                  {online ? 'Online' : 'Offline'}
                </Badge>
              </dd>
            </div>
          </dl>
          <p className="ac-status__hint">Role and terminal are assigned by an administrator and can’t be changed here.</p>
        </section>
        <p className="ac-note">
          <ShieldCheck size={15} /> Account information identifies the current BrewSync user. Passwords are never displayed, and security controls will be enforced by the authentication system.
        </p>
      </aside>

      <footer className="ac-actions">
        <span className="ac-actions__state">
          {dirty ? 'You have unsaved profile changes.' : savedAt ? `Profile saved ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : 'No profile changes.'}
        </span>
        <div className="ac-actions__buttons">
          <Button
            disabled={!dirty}
            onClick={() => {
              setFullName(savedName);
              setNameError(null);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" icon={<Save size={15} />} disabled={!dirty || busy} onClick={() => void saveProfile()}>
            Save Changes
          </Button>
        </div>
      </footer>

      <ConfirmDialog
        open={confirmLogout}
        title="Log out of BrewSync?"
        message="This ends your current session and returns to the sign-in screen. Orders, settings, and business data are not affected."
        confirmLabel="Log Out"
        danger
        onConfirm={logout}
        onCancel={() => setConfirmLogout(false)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

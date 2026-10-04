import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Coffee, CreditCard, MonitorSmartphone, ReceiptText, RefreshCw, ShieldCheck, Store, Users } from 'lucide-react';
import Button from '../../components/ui/Button';
import LoadingState from '../../components/ui/LoadingState';
import SetupWizard from '../../components/auth/SetupWizard';
import LoginForm from '../../components/auth/LoginForm';
import ActivateDevice from '../../components/auth/ActivateDevice';
import { bootstrap, hasDevice, useAuth } from '../../stores/authStore';
import '../../components/auth/auth.css';
import '../../components/auth/login.css';

// Rendered outside the app shell: setup wizard → device activation → sign in (API §1.7).
// Split layout from the Stitch reference. The left panel is static product copy only; the
// only live state shown is what the client actually knows (server reachable, device activated).
export default function LoginPage() {
  const { phase, notice, error, lockedUsername } = useAuth();
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (phase === 'loading') void bootstrap();
  }, [phase]);

  // Signed in → enter the app immediately. viewTransition cross-fades the login screen into the
  // next route where the browser supports it (no added delay; unsupported browsers just navigate).
  useEffect(() => {
    if (phase === 'signed-in') void navigate('/', { replace: true, viewTransition: true });
  }, [phase, navigate]);

  let body;
  if (phase === 'loading') body = <LoadingState label="Connecting to BrewSync…" />;
  else if (phase === 'error')
    body = (
      <div className="auth-card">
        <header className="auth-card__header">
          <h1>Cannot reach the server</h1>
          <p>{error}</p>
        </header>
        <Button variant="primary" icon={<RefreshCw size={16} />} onClick={() => void bootstrap()}>
          Try again
        </Button>
      </div>
    );
  else if (phase === 'setup') body = <SetupWizard />;
  else if (activating)
    body = (
      <ActivateDevice
        onCancel={() => setActivating(false)}
        onActivated={(code) => {
          setActivated(code);
          setActivating(false);
        }}
      />
    );
  else
    body = (
      <LoginForm
        notice={activated ? `This device is now terminal ${activated}. Sign in to continue.` : notice}
        initialUsername={activated ? '' : (lockedUsername ?? '')}
        terminalCode={activated}
        onActivate={() => setActivating(true)}
      />
    );

  const connected = phase !== 'loading' && phase !== 'error';
  const device = hasDevice();

  return (
    <div className="login-split">
      <aside className="login-hero" aria-label="BrewSync">
        <div className="login-hero__brand">
          <span className="login-hero__logo">
            <Coffee size={22} strokeWidth={2.2} />
          </span>
          <div>
            <strong>BrewSync</strong>
            <span>Point of Sale &amp; Business Management</span>
          </div>
        </div>

        <ul className="login-hero__tags">
          <li>
            <Store size={14} /> Cafe &amp; Restaurant Point of Sale
          </li>
          <li>
            <Users size={14} /> Admin &amp; Cashier Roles
          </li>
          <li>
            <ShieldCheck size={14} /> Terminal-Based Access Control
          </li>
        </ul>

        <div className="login-hero__pitch">
          <span className="login-hero__rule" aria-hidden="true" />
          <h2>
            Crafted for speed on the counter,
            <br />
            clarity in the back office.
          </h2>
          <p>Take orders, track them from pending to ready, settle payments and keep every receipt — with prices, stock and permissions checked by the server.</p>
          <hr />
          <div className="login-hero__cards">
            <div>
              <span>
                <ClipboardList size={13} /> Orders
              </span>
              <strong>Pending → Ready</strong>
            </div>
            <div>
              <span>
                <CreditCard size={13} /> Payments
              </span>
              <strong>Split &amp; Cash</strong>
            </div>
            <div>
              <span>
                <ReceiptText size={13} /> Receipts
              </span>
              <strong>Reprint-Safe</strong>
            </div>
          </div>
        </div>

        <footer className="login-hero__footer">
          <span>
            <Coffee size={14} /> BrewSync · Point of Sale &amp; Admin System
          </span>
          <span className="login-hero__caps">Engineered for touch service</span>
        </footer>
      </aside>

      <main className="login-panel">
        <header className="login-panel__top">
          <div className="login-chip">
            <MonitorSmartphone size={15} />
            <span>{activated ? `Terminal ${activated}` : device ? 'Activated terminal' : 'Terminal not activated'}</span>
            <span className="login-chip__sep" aria-hidden="true" />
            <span className={`login-chip__status ${connected ? 'login-chip__status--ok' : ''}`}>
              <span className="login-chip__dot" aria-hidden="true" />
              {connected ? 'Server connected' : phase === 'error' ? 'Server unreachable' : 'Connecting…'}
            </span>
          </div>
        </header>

        <div className={`login-panel__body ${phase === 'setup' ? 'login-panel__body--wide' : ''}`}>{body}</div>

        <footer className="login-panel__footer">
          <span>
            <ShieldCheck size={14} /> Authorized staff only.
          </span>
          <span>Sessions lock automatically after inactivity.</span>
        </footer>
      </main>
    </div>
  );
}

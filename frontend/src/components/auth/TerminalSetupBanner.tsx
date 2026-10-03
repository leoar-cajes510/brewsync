import { useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import { deviceStore, errorMessage } from '../../services/api';
import { activateTerminal, registerTerminal } from '../../services/terminalService';
import { signOut, useAuth } from '../../stores/authStore';

// Shown when the session is not bound to a terminal (Admin back-office sign-in, the interim
// Q-TRM-8 path). POS actions (orders, payments, reprints) require a terminal, so the Admin can
// register a terminal and activate THIS device with it, then sign in again on the terminal.
export default function TerminalSetupBanner() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.terminal_id) return null;
  const canRegister = user.permissions.includes('terminals.manage');

  const submit = async () => {
    const mins = Number(minutes);
    if (!code.trim() || !name.trim() || !Number.isInteger(mins) || mins < 1) {
      setError('Enter a terminal code, a name and the activation-code validity in minutes.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const registered = await registerTerminal(code.trim().toUpperCase(), name.trim(), mins);
      const activated = await activateTerminal(registered.code, registered.activation_code);
      deviceStore.set(activated.device_credential);
      await signOut('logout', `This device is now terminal ${activated.terminal.code}. Sign in again to start a terminal session.`);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="terminal-banner" role="status">
        <MonitorSmartphone size={16} />
        <span>
          <strong>No terminal session.</strong> Orders, payments and receipt printing need this device to be an activated terminal.
        </span>
        {canRegister && (
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
            Register this device
          </Button>
        )}
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Register & activate this device"
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={submitting}>
              {submitting ? 'Activating…' : 'Register & Activate'}
            </Button>
          </>
        }
      >
        <div className="auth-modal-form">
          <Input label="Terminal Code" placeholder="e.g. REG-01" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus />
          <Input label="Terminal Name" placeholder="e.g. Front Counter" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Activation Code Valid For (minutes)" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          {error && <div className="auth-error" role="alert">{error}</div>}
        </div>
      </Modal>
    </>
  );
}

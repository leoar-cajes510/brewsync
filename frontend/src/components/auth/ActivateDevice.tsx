import { useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { deviceStore, errorMessage } from '../../services/api';
import { activateTerminal } from '../../services/terminalService';

interface ActivateDeviceProps {
  onActivated: (terminalCode: string) => void;
  onCancel?: () => void;
  /** Pre-filled when an Admin just registered the terminal on this device. */
  terminalCode?: string;
  activationCode?: string;
}

// POST /terminals/activate: exchanges the one-time activation code for this device's
// credential. Only the credential is stored; the activation code is never kept.
export default function ActivateDevice({ onActivated, onCancel, terminalCode = '', activationCode = '' }: ActivateDeviceProps) {
  const [code, setCode] = useState(terminalCode);
  const [activation, setActivation] = useState(activationCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim() || !activation.trim()) {
      setError('Enter the terminal code and activation code.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await activateTerminal(code.trim(), activation.trim());
      deviceStore.set(result.device_credential);
      onActivated(result.terminal.code);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

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
        <h1>Activate this device</h1>
        <p>An Admin registers a terminal and gives you its one-time activation code.</p>
      </header>
      <Input label="Terminal Code" placeholder="e.g. REG-01" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      <Input label="Activation Code" autoComplete="off" value={activation} onChange={(e) => setActivation(e.target.value)} />
      {error && <div className="auth-error" role="alert">{error}</div>}
      <Button type="submit" variant="primary" size="lg" block icon={<MonitorSmartphone size={18} />} disabled={submitting}>
        {submitting ? 'Activating…' : 'Activate Device'}
      </Button>
      {onCancel && (
        <Button block onClick={onCancel}>
          Back to Sign in
        </Button>
      )}
    </form>
  );
}

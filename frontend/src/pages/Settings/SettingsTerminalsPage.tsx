import { useCallback, useEffect, useState } from 'react';
import { MonitorSmartphone, Plus } from 'lucide-react';
import Badge, { type BadgeTone } from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Input from '../../components/ui/Input';
import LoadingState from '../../components/ui/LoadingState';
import Modal from '../../components/ui/Modal';
import Table, { type TableColumn } from '../../components/ui/Table';
import { ActionFeedback } from '../../components/receipts/ReceiptPrinter';
import { errorMessage } from '../../services/api';
import { deactivateTerminal, listTerminals, registerTerminal, resetTerminalActivation } from '../../services/terminalService';
import type { TerminalDto, TerminalRegistered } from '../../types/api';
import { useAuth } from '../../stores/authStore';
import '../../components/settings/settingsTerminals.css';

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  active: { label: 'Active', tone: 'success' },
  pending_activation: { label: 'Awaiting activation', tone: 'warning' },
  inactive: { label: 'Deactivated', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'danger' },
};

const RESET_CODE_MINUTES = 15;

const when = (v: unknown) => (typeof v === 'string' ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Terminal management (✱terminals.manage, Q-TRM-1): the Admin registers a terminal, which
// returns a one-time activation code (shown once, never stored here); the new device enters
// it on its sign-in screen ("Activate this device").
export default function SettingsTerminalsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<TerminalDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', minutes: '15' });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<TerminalRegistered | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'reset' | 'deactivate'; terminal: TerminalDto } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setRows(await listTerminals());
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const register = async () => {
    const minutes = Number(form.minutes);
    if (!form.code.trim() || !form.name.trim()) return setFormError('Enter a terminal code and a name.');
    if (!Number.isInteger(minutes) || minutes < 1) return setFormError('Enter how many minutes the activation code stays valid.');
    setBusy(true);
    setFormError(null);
    try {
      const created = await registerTerminal(form.code.trim().toUpperCase(), form.name.trim(), minutes);
      setRegistering(false);
      setForm({ code: '', name: '', minutes: '15' });
      setIssued(created);
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const runConfirmed = async () => {
    if (!confirm) return;
    const { kind, terminal } = confirm;
    setConfirm(null);
    setActionError(null);
    try {
      if (kind === 'reset') {
        setIssued(await resetTerminalActivation(terminal.id, RESET_CODE_MINUTES));
      } else {
        await deactivateTerminal(terminal.id);
        setFeedback(`Terminal ${terminal.code} deactivated`);
      }
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const columns: TableColumn<TerminalDto>[] = [
    { key: 'code', header: 'Code', width: '14%', render: (t) => <strong>{t.code}</strong> },
    { key: 'name', header: 'Name', render: (t) => t.name },
    {
      key: 'status',
      header: 'Status',
      render: (t) => {
        const s = STATUS[t.status] ?? { label: t.status, tone: 'neutral' as BadgeTone };
        return (
          <Badge tone={s.tone}>
            {s.label}
            {t.id === user?.terminal_id ? ' · this device' : ''}
          </Badge>
        );
      },
    },
    { key: 'activated', header: 'Activated', render: (t) => when(t.activated_at) },
    { key: 'seen', header: 'Last Seen', render: (t) => when(t.last_seen_at) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) =>
        t.id === user?.terminal_id ? null : (
          <div className="tm-actions">
            <Button size="sm" onClick={() => setConfirm({ kind: 'reset', terminal: t })}>
              {t.status === 'active' ? 'Reset Activation' : 'New Activation Code'}
            </Button>
            {t.status === 'active' && (
              <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'deactivate', terminal: t })}>
                Deactivate
              </Button>
            )}
          </div>
        ),
    },
  ];

  return (
    <div className="settings-terminals">
      <section className="tm-card">
        <div className="tm-card__head">
          <div>
            <h2>Terminals</h2>
            <p>Each device that takes orders is a terminal. Register one here, then enter its activation code on that device.</p>
          </div>
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setRegistering(true)}>
            Register Terminal
          </Button>
        </div>
        {actionError && (
          <div className="api-status api-status--error" role="alert">
            {actionError}
            <Button size="sm" onClick={() => setActionError(null)}>
              Dismiss
            </Button>
          </div>
        )}
        {rows === null ? (
          loadError ? (
            <div className="api-status api-status--error" role="alert">
              {loadError}
              <Button size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : (
            <LoadingState label="Loading terminals…" />
          )
        ) : (
          <Table columns={columns} rows={rows} rowKey={(t) => t.id} emptyTitle="No terminals registered yet" />
        )}
      </section>

      <Modal
        open={registering}
        onClose={() => setRegistering(false)}
        title="Register Terminal"
        size="sm"
        footer={
          <>
            <Button onClick={() => setRegistering(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void register()} disabled={busy}>
              {busy ? 'Registering…' : 'Register'}
            </Button>
          </>
        }
      >
        <form
          className="tm-form"
          onSubmit={(e) => {
            e.preventDefault();
            void register();
          }}
        >
          <Input label="Terminal Code" placeholder="e.g. REG-02" value={form.code} maxLength={20} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} autoFocus />
          <Input label="Terminal Name" placeholder="e.g. Drive-thru Till" value={form.name} maxLength={80} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="Activation Code Valid For (minutes)" inputMode="numeric" value={form.minutes} onChange={(e) => setForm((f) => ({ ...f, minutes: e.target.value }))} />
          {formError && (
            <div className="api-status api-status--error" role="alert">
              {formError}
            </div>
          )}
        </form>
      </Modal>

      <Modal
        open={issued !== null}
        onClose={() => setIssued(null)}
        title={
          <span>
            <MonitorSmartphone size={16} /> Activation code for {issued?.code}
          </span>
        }
        size="sm"
        footer={
          <Button variant="primary" onClick={() => setIssued(null)}>
            Done
          </Button>
        }
      >
        <p className="text-muted">
          On the new device, open BrewSync and choose “Activate this device”. Enter terminal code {issued?.code} and this code. It is shown only once and expires{' '}
          {when(issued?.activation_expires_at)}.
        </p>
        <div className="tm-code" data-testid="activation-code">
          {issued?.activation_code}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'deactivate' ? `Deactivate ${confirm.terminal.code}?` : `Issue a new activation code for ${confirm?.terminal.code ?? ''}?`}
        message={
          confirm?.kind === 'deactivate'
            ? 'The device is signed out and can no longer be used until it is activated again with a new code.'
            : 'Any device bound to this terminal is signed out and must be activated again with the new code.'
        }
        confirmLabel={confirm?.kind === 'deactivate' ? 'Deactivate' : 'Issue Code'}
        danger={confirm?.kind === 'deactivate'}
        onConfirm={() => void runConfirmed()}
        onCancel={() => setConfirm(null)}
      />
      <ActionFeedback message={feedback} onDone={clearFeedback} />
    </div>
  );
}

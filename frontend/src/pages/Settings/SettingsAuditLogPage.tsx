import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Button from '../../components/ui/Button';
import LoadingState from '../../components/ui/LoadingState';
import Select from '../../components/ui/Select';
import Table, { type TableColumn } from '../../components/ui/Table';
import { errorMessage } from '../../services/api';
import { actionLabel, listAudit, type AuditEntryDto } from '../../services/auditService';
import '../../components/settings/settingsTerminals.css';

// Entity types written by the backend's audit() calls.
const ENTITY_TYPES = [
  { value: '', label: 'All records' },
  { value: 'session', label: 'Sign-ins' },
  { value: 'order', label: 'Orders & refunds' },
  { value: 'document', label: 'Receipts' },
  { value: 'product', label: 'Products & stock' },
  { value: 'category', label: 'Categories' },
  { value: 'choice_group', label: 'Choices' },
  { value: 'ingredient', label: 'Ingredients' },
  { value: 'discount', label: 'Discounts' },
  { value: 'expense', label: 'Expenses' },
  { value: 'user', label: 'Staff' },
  { value: 'role', label: 'Permissions' },
  { value: 'terminal', label: 'Terminals' },
  { value: 'settings', label: 'Settings' },
];

const summary = (e: AuditEntryDto) => {
  const after = Object.entries(e.after ?? {})
    .filter(([, v]) => v !== null && typeof v !== 'object')
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v)}`);
  return after.join(' · ') || '—';
};

// Read-only, immutable audit trail (SR-7). Admin only (✱audit.view).
export default function SettingsAuditLogPage() {
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState<AuditEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      setRows(await listAudit(entity || undefined));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [entity]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: TableColumn<AuditEntryDto>[] = [
    { key: 'at', header: 'When', width: '18%', render: (e) => new Date(e.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) },
    { key: 'who', header: 'By', width: '16%', render: (e) => e.actor_name ?? (e.actor_id ? 'Unknown user' : 'System') },
    { key: 'action', header: 'Action', width: '20%', render: (e) => actionLabel(e.action) },
    { key: 'entity', header: 'Record', width: '14%', render: (e) => e.entity_type },
    { key: 'details', header: 'Details', render: (e) => <span className="text-muted">{summary(e)}</span> },
  ];

  return (
    <div className="settings-terminals">
      <section className="tm-card">
        <div className="tm-card__head">
          <div>
            <h2>Audit Log</h2>
            <p>A permanent record of sign-ins, sales, refunds, stock changes and settings changes. Entries cannot be edited.</p>
          </div>
          <div className="tm-actions">
            <Select aria-label="Filter records" value={entity} onChange={(e) => setEntity(e.target.value)} options={ENTITY_TYPES} />
            <Button icon={<RefreshCw size={14} />} onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </div>
        {error ? (
          <div className="api-status api-status--error" role="alert">
            {error}
          </div>
        ) : rows === null ? (
          <LoadingState label="Loading audit log…" />
        ) : (
          <Table columns={columns} rows={rows} rowKey={(e) => e.id} emptyTitle="No audit entries" />
        )}
      </section>
    </div>
  );
}

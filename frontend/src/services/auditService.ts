import { api } from './api';

export interface AuditEntryDto {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  created_at: string;
}

/** Read-only audit log (✱audit.view, Admin only). */
export const listAudit = (entityType?: string) =>
  api.get<AuditEntryDto[]>(`/audit?limit=200${entityType ? `&entity_type=${encodeURIComponent(entityType)}` : ''}`);

/** What a staff member did, and what was done to their account (✱staff.view). */
export const staffActivity = (userId: string) => api.get<AuditEntryDto[]>(`/staff/${userId}/activity`);

/** "order.cancelled" → "Order cancelled". */
export function actionLabel(action: string): string {
  const text = action.replace(/[._]/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

import { api } from './api';
import type { SettingsSectionDto } from '../types/api';

/** Which sections are configured on the server (GET /settings). */
export const listSections = () => api.get<{ section: string; configured: boolean; version: number }[]>('/settings');

export const getSection = <T = Record<string, unknown>>(section: string) => api.get<SettingsSectionDto<T>>(`/settings/${section}`);

export const putSection = <T = Record<string, unknown>>(section: string, version: number, data: T) =>
  api.put<SettingsSectionDto<T>>(`/settings/${section}`, { version, data });

/** Role grants for the 48 configurable permission keys (GET/PUT /settings/permissions). */
export type RoleGrantsDto = Record<'admin' | 'cashier', Record<string, boolean>>;
export const getPermissions = () => api.get<{ roles: RoleGrantsDto }>('/settings/permissions');
export const putPermissions = (roles: RoleGrantsDto) => api.put<{ roles: RoleGrantsDto }>('/settings/permissions', { roles });

/** Display/operational sections (features, payments, branding, terminology, preferences) for any
 *  signed-in session, e.g. a Cashier without ✱settings.view. Read-only; one request shared by all stores. */
let operationalInflight: Promise<Record<string, SettingsSectionDto<Record<string, unknown>>>> | null = null;
export const getOperational = () => {
  operationalInflight ??= api
    .get<Record<string, SettingsSectionDto<Record<string, unknown>>>>('/settings/operational')
    .finally(() => setTimeout(() => (operationalInflight = null), 1000));
  return operationalInflight;
};

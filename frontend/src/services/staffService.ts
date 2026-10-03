import { api } from './api';
import type { AuthMethod, RoleKey, StaffDto } from '../types/api';

export const listStaff = () => api.get<StaffDto[]>('/staff');

export interface NewStaff {
  full_name: string;
  username: string;
  role: RoleKey;
  auth_method: AuthMethod;
  /** Initial credential; the user must change it at first sign-in. Never stored client-side. */
  credential: string;
}

export const createStaff = (staff: NewStaff) => api.post<StaffDto>('/staff', staff);

/** A username change is answered with DECISION_PENDING (Q-AUTH-5) by the server. */
export const updateStaff = (id: string, patch: { full_name?: string; role?: RoleKey; username?: string }) => api.patch<StaffDto>(`/staff/${id}`, patch);
export const setStaffActive = (id: string, active: boolean) => api.post<StaffDto>(`/staff/${id}/${active ? 'activate' : 'deactivate'}`);
/** Temporary password or PIN (per the account's method); the user must change it at next sign-in. */
export const resetCredential = (id: string, credential: string) => api.post<StaffDto>(`/staff/${id}/reset-credential`, { credential });

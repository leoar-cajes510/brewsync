import { api, request } from './api';
import type { LoginResponse, MeDto, SetupStatusDto } from '../types/api';

// Setup guard (API §1.7), sign-in and session endpoints (§1.8).

export const setupStatus = () => request<SetupStatusDto>('GET', '/setup/status', { anonymous: true });

export interface SetupPayload {
  business: { name: string; business_type: string; currency_code: string; timezone: string; address?: string; phone?: string; email?: string };
  admin: { full_name: string; username: string; password: string };
  security: {
    idle_timeout_minutes: number;
    credential_policy: { min_password_length: number; pin_length: number; max_failed_attempts: number; lockout_minutes: number };
  };
  settings?: Record<string, Record<string, unknown>>;
}

export interface FirstTerminal {
  code: string;
  name: string;
  activation_code: string;
  activation_expires_at: string;
}

/** Q-AUTH-8: the installer's setup token is required. Returns the first terminal's one-time code (Q-TRM-8). */
export const completeSetup = (payload: SetupPayload, setupToken: string) =>
  request<{ setup_status: string; business_id: string; admin_user_id: string; first_terminal: FirstTerminal }>('POST', '/setup/complete', {
    body: payload,
    anonymous: true,
    headers: { 'X-Setup-Token': setupToken },
  });

export const login = (username: string, credential: string) =>
  request<LoginResponse>('POST', '/auth/login', { body: { username, credential }, anonymous: true });

export const me = () => api.get<MeDto>('/auth/me');
/** The caller's own display name (✱settings.account). */
export const updateMe = (fullName: string) => api.patch<MeDto>('/auth/me', { full_name: fullName });
export const logout = () => api.post<{ ok: true }>('/auth/logout');
export const lock = () => api.post<{ ok: true }>('/auth/lock');
export const changePassword = (current: string, next: string) => api.post<{ ok: true }>('/auth/change-password', { current, new: next });
export const changePin = (current: string, next: string) => api.post<{ ok: true }>('/auth/change-pin', { current, new: next });

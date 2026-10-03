import { api, request } from './api';
import type { TerminalActivated, TerminalDto, TerminalRegistered } from '../types/api';

export const listTerminals = () => api.get<TerminalDto[]>('/terminals');

export const registerTerminal = (code: string, name: string, activationCodeMinutes: number) =>
  api.post<TerminalRegistered>('/terminals', { code, name, activation_code_minutes: activationCodeMinutes });

/** Unauthenticated: guarded by the one-time activation code. */
export const activateTerminal = (terminalCode: string, activationCode: string) =>
  request<TerminalActivated>('POST', '/terminals/activate', {
    body: { terminal_code: terminalCode, activation_code: activationCode },
    anonymous: true,
  });

/** Admin terminal management (✱terminals.manage). Reset returns a new one-time activation code. */
export const resetTerminalActivation = (id: string, activationCodeMinutes: number) =>
  api.post<TerminalRegistered>(`/terminals/${id}/reset-activation`, { activation_code_minutes: activationCodeMinutes });
export const deactivateTerminal = (id: string) => api.post<TerminalDto>(`/terminals/${id}/deactivate`, {});
export const renameTerminal = (id: string, name: string) => api.patch<TerminalDto>(`/terminals/${id}`, { name });

import { useSyncExternalStore } from 'react';
import { ApiError, deviceStore, onSessionEnded, tokenStore } from '../services/api';
import * as auth from '../services/authService';
import type { MeDto } from '../types/api';

// Session state for the whole app (API §1.7–1.8). The server is the authority:
// idle timeout, permissions and terminal identity are all enforced server-side;
// this store only mirrors /auth/me and reacts to SESSION_EXPIRED / UNAUTHENTICATED.

export type AuthPhase = 'loading' | 'setup' | 'signed-out' | 'signed-in' | 'error';

interface AuthState {
  phase: AuthPhase;
  user: MeDto | null;
  /** Why the last session ended, shown on the Login screen. */
  notice: string | null;
  error: string | null;
}

let state: AuthState = { phase: 'loading', user: null, notice: null, error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const hasDevice = () => deviceStore.get() !== null;
/** The signed-in user's server permissions (empty when signed out). */
export const currentPermissions = (): string[] => state.user?.permissions ?? [];

export function can(user: MeDto | null, permission: string): boolean {
  return !!user && user.permissions.includes(permission);
}

onSessionEnded((code) => {
  set({
    phase: 'signed-out',
    user: null,
    notice: code === 'SESSION_EXPIRED' ? 'Your session expired after a period of inactivity. Please sign in again.' : 'Your session has ended. Please sign in again.',
  });
});

/** Decide between setup wizard, Login and the app (API §1.7). */
export async function bootstrap(): Promise<void> {
  set({ phase: 'loading', error: null });
  try {
    const status = await auth.setupStatus();
    if (status.setup_status !== 'completed') {
      set({ phase: 'setup' });
      return;
    }
    if (!tokenStore.get()) {
      set({ phase: 'signed-out' });
      return;
    }
    const user = await auth.me();
    set({ phase: 'signed-in', user });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      set({ phase: 'signed-out', user: null });
      return;
    }
    set({ phase: 'error', error: error instanceof Error ? error.message : 'Cannot reach the server.' });
  }
}

export async function signIn(username: string, credential: string): Promise<MeDto> {
  const result = await auth.login(username, credential);
  tokenStore.set(result.token);
  const user = await auth.me();
  set({ phase: 'signed-in', user, notice: null });
  return user;
}

export async function refreshUser(): Promise<void> {
  const user = await auth.me();
  set({ user });
}

/** End the session on the server (logout or lock), then clear it locally regardless. */
export async function signOut(kind: 'logout' | 'lock' = 'logout', notice?: string): Promise<void> {
  try {
    if (tokenStore.get()) await (kind === 'lock' ? auth.lock() : auth.logout());
  } catch {
    /* the local session is cleared either way */
  }
  tokenStore.set(null);
  set({ phase: 'signed-out', user: null, notice: notice ?? (kind === 'lock' ? 'Terminal locked.' : null) });
}

export function setupCompleted(notice = 'Setup complete. Sign in with the Admin account you just created.') {
  set({ phase: 'signed-out', notice });
}

export function forgetDevice() {
  deviceStore.set(null);
}

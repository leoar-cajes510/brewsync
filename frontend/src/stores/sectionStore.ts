import { useEffect, useSyncExternalStore } from 'react';
import { ApiError, errorMessage } from '../services/api';
import { getOperational, getSection, putSection } from '../services/settingsService';
import { currentPermissions } from './authStore';

// One business-wide settings section (GET/PUT /settings/{section}, optimistic `version`).
// The server validates the rule-bearing sections; a stale version is rejected with
// VERSION_CONFLICT instead of overwriting someone else's change.

type Data = Record<string, unknown>;

export interface SectionState<T> {
  settings: T;
  /** When this browser last saved the section (null until then). */
  savedAt: Date | null;
  /** Server version (0 = not configured yet). */
  version: number;
  configured: boolean;
  loaded: boolean;
  error: string | null;
}

export interface SectionStore<T> {
  use: () => SectionState<T>;
  load: () => Promise<void>;
  /** Persists to the server; resolves with the saved settings, throws the API error otherwise. */
  save: (settings: T) => Promise<T>;
  get: () => SectionState<T>;
}

export function createSectionStore<T>(
  section: string,
  defaults: T,
  fromData: (data: Data) => T,
  toData: (settings: T, current: Data | null) => Data,
): SectionStore<T> {
  let state: SectionState<T> = { settings: defaults, savedAt: null, version: 0, configured: false, loaded: false, error: null };
  let raw: Data | null = null;
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<SectionState<T>>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const load = () => {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        let res;
        try {
          // Without ✱settings.view the section endpoint is always 403: go straight to the operational copy.
          if (!currentPermissions().includes('settings.view')) throw new ApiError(403, 'PERMISSION_DENIED', 'settings.view');
          res = await getSection<Data>(section);
        } catch (err) {
          // Sessions without ✱settings.view (Cashier) still need the operational values.
          const operational = err instanceof ApiError && err.status === 403 ? (await getOperational())[section] : undefined;
          if (!operational) throw err;
          res = operational;
        }
        raw = res.data ?? null;
        set({ settings: raw ? fromData(raw) : defaults, version: res.version ?? 0, configured: res.configured, loaded: true, error: null });
      } catch (err) {
        set({ loaded: true, error: errorMessage(err) });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  const save = async (settings: T) => {
    const res = await putSection<Data>(section, state.version, toData(settings, raw));
    raw = res.data ?? null;
    const saved = raw ? fromData(raw) : settings;
    set({ settings: saved, version: res.version ?? state.version, configured: true, savedAt: new Date(), error: null });
    return saved;
  };

  const use = () => {
    useEffect(() => {
      void load();
    }, []);
    return useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => state,
    );
  };

  return { use, load, save, get: () => state };
}

/** Status line for a settings page footer. */
export function savedLine(dirty: boolean, s: Pick<SectionState<unknown>, 'savedAt' | 'configured' | 'loaded' | 'error'>, unconfigured: string): string {
  if (dirty) return 'You have unsaved changes.';
  if (s.error) return `Could not load: ${s.error}`;
  if (!s.loaded) return 'Loading…';
  if (s.savedAt) return `Saved ${s.savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`;
  return s.configured ? 'Saved on the server.' : unconfigured;
}

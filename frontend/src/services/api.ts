// Centralized API client for the BrewSync backend (API.md §1).
// - Base URL from VITE_API_URL (default: same-origin /api/v1, proxied by Vite in dev).
// - Bearer session token + X-Device-Credential on every request.
// - Error envelope → ApiError with the stable `code`.
// - Idempotency-Key helper for the endpoints that require one (§1.5).
// The server is authoritative: this layer never computes totals, permissions or state.

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api/v1';

const TOKEN_KEY = 'brewsync.session';
const DEVICE_KEY = 'brewsync.device';

/** Session token: tab-scoped (sessionStorage), never the user's password or PIN. */
export const tokenStore = {
  get: (): string | null => safeGet(sessionStorage, TOKEN_KEY),
  set: (token: string | null) => safeSet(sessionStorage, TOKEN_KEY, token),
};

/** Device credential issued by POST /terminals/activate; identifies this browser as a terminal. */
export const deviceStore = {
  get: (): string | null => safeGet(localStorage, DEVICE_KEY),
  set: (credential: string | null) => safeSet(localStorage, DEVICE_KEY, credential),
};

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string | null) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    /* storage unavailable: the value lives only for this page load */
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Codes that end the local session (the client returns to Login). */
const SESSION_CODES = new Set(['SESSION_EXPIRED', 'UNAUTHENTICATED']);

type SessionEndListener = (code: string) => void;
const sessionEndListeners = new Set<SessionEndListener>();

export function onSessionEnded(listener: SessionEndListener): () => void {
  sessionEndListeners.add(listener);
  return () => sessionEndListeners.delete(listener);
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  /** Unauthenticated endpoints (setup, activation, login) must not trigger the session-ended flow. */
  anonymous?: boolean;
  /** Extra request headers (e.g. X-Setup-Token for the setup wizard). */
  headers?: Record<string, string>;
  /** Binary body sent as-is with its own type (product image upload) instead of JSON. */
  file?: Blob;
}

export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.file) headers['Content-Type'] = options.file.type;
  else if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (token && !options.anonymous) headers.Authorization = `Bearer ${token}`;
  const device = deviceStore.get();
  if (device) headers['X-Device-Credential'] = device;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  Object.assign(headers, options.headers ?? {});

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: options.file ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the BrewSync server. Check the connection and try again.');
  }

  const text = await response.text();
  const data = text ? safeJson(text) : null;

  if (!response.ok) {
    const envelope = (data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
    const error = new ApiError(
      response.status,
      envelope?.code ?? `HTTP_${response.status}`,
      envelope?.message ?? `Request failed (${response.status})`,
      envelope?.details ?? {},
    );
    if (!options.anonymous && token && response.status === 401 && SESSION_CODES.has(error.code)) {
      tokenStore.set(null);
      sessionEndListeners.forEach((l) => l(error.code));
    }
    throw error;
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>('POST', path, { body: body ?? {}, idempotencyKey }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** Display message for any error thrown by the API layer (the server message is already user-facing). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'PERMISSION_DENIED') return 'You do not have permission to do this.';
    if (error.code === 'DECISION_PENDING') return DECISION_MESSAGES[String(error.details.question_id ?? '')] ?? 'This action is not available yet.';
    if (error.code === 'TERMINAL_NOT_ACTIVATED') return 'This device is not an activated terminal. Ask an Admin for an activation code, then choose “Activate this device”.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

// Owner-facing wording for actions that wait on an open business decision (no internal IDs shown).
const DECISION_MESSAGES: Record<string, string> = {
  'Q-CAN-1': 'A paid order cannot be cancelled. Complete it, then refund it from History.',
  'Q-REF-5': 'Only full refunds are available.',
};

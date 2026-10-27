import { KEYS, readJson, writeJson } from './kv';

/** Backup server (see `server/`). Override with EXPO_PUBLIC_API_URL, e.g. for local testing. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://kitchen.darwish-tech.com').replace(/\/$/, '');

export type Auth = { token: string; phone: string; userId: string; isAdmin?: boolean };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

let cached: Auth | null | undefined;

export async function getAuth(): Promise<Auth | null> {
  if (cached === undefined) {
    const stored = await readJson<Auth>(KEYS.auth);
    // Logins from the email version have no phone: sign in again with a phone number.
    cached = stored?.phone ? stored : null;
  }
  return cached;
}

export async function setAuth(auth: Auth | null) {
  cached = auth;
  await writeJson(KEYS.auth, auth);
}

/** auth: true = must be signed in; 'optional' = send the login if there is one (public pages); false = never. */
type Options = { method?: string; json?: unknown; body?: ArrayBuffer; type?: string; auth?: boolean | 'optional' };

/** Calls the backup API. Throws ApiError with the server's error code; 'network' when offline. */
export async function api<T = unknown>(path: string, { method, json, body, type, auth = true }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth) {
    const a = await getAuth();
    if (!a && auth === true) throw new ApiError(401, 'signed-out');
    if (a) headers.Authorization = `Bearer ${a.token}`;
  }
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (type) headers['Content-Type'] = type;

  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: method ?? (json !== undefined ? 'POST' : 'GET'),
      headers,
      body: json !== undefined ? JSON.stringify(json) : body,
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // An expired or revoked login: forget it so the app shows the sign-in button again.
    if (res.status === 401 && auth === true) await setAuth(null);
    throw new ApiError(res.status, (data as { error?: string }).error ?? 'server-error');
  }
  return data as T;
}

export async function authHeader(): Promise<Record<string, string>> {
  const a = await getAuth();
  if (!a) throw new ApiError(401, 'signed-out');
  return { Authorization: `Bearer ${a.token}` };
}

/** 201001234567 → 01001234567 for Egyptian numbers; others as +<digits>. */
export function displayPhone(phone: string): string {
  return /^20\d{10}$/.test(phone) ? `0${phone.slice(2)}` : `+${phone}`;
}

/** Full URL for a server path such as `/api/catalog/images/x.jpg`. */
export const serverUrl = (path: string) => API_URL + path;

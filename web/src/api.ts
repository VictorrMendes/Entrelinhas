/** The backend, through /api on this same origin (nginx in production, Vite's proxy in development). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The email account signed in on this device; without one, an anonymous device account is used. */
export interface Account {
  email: string;
  name: string | null;
}

export function account(): Account | null {
  const email = localStorage.getItem('accountEmail');
  return email ? { email, name: localStorage.getItem('accountName') } : null;
}

/** Back to the anonymous device account; nothing on this device is deleted. */
export function signOut() {
  for (const k of ['token', 'accountEmail', 'accountName']) localStorage.removeItem(k);
}

/** Like the Android app: an anonymous account per install (random id + secret) carries the translation quota. */
async function token(): Promise<string> {
  const saved = localStorage.getItem('token');
  if (saved) return saved;
  let deviceId = localStorage.getItem('deviceId');
  let secret = localStorage.getItem('deviceSecret');
  if (!deviceId || !secret) {
    deviceId = crypto.randomUUID();
    secret = hex(crypto.getRandomValues(new Uint8Array(32)));
    localStorage.setItem('deviceId', deviceId);
    localStorage.setItem('deviceSecret', secret);
  }
  const data = await call<{ token: string }>('/auth/device', { deviceId, secret }, null);
  localStorage.setItem('token', data.token);
  return data.token;
}

async function exchange(path: string, body: unknown, auth: string | null): Promise<{ res: Response; json: { data?: unknown; error?: { code?: string } } | null }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${auth}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NO_CONNECTION');
  }
  return { res, json: await res.json().catch(() => null) };
}

async function call<T>(path: string, body: unknown, auth: string | null): Promise<T> {
  let { res, json } = await exchange(path, body, auth);
  // Cloudflare answers 502-504 on its own while the server restarts; one retry hides that. Auth calls aren't repeated:
  // a lost answer there may already have taken effect.
  if (res.status >= 502 && res.status <= 504 && !json?.error && !path.startsWith('/auth/')) {
    await new Promise((r) => setTimeout(r, 1000));
    ({ res, json } = await exchange(path, body, auth));
  }
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? `HTTP_${res.status}`);
  return json?.data as T;
}

/** An expired or unknown token signs out and registers the device again once; sync calls report the expired session instead. */
export async function post<T>(path: string, body: unknown): Promise<T> {
  try {
    return await call<T>(path, body, await token());
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
    const hadAccount = account() !== null;
    signOut();
    if (hadAccount && path.startsWith('/sync')) throw new ApiError(401, 'SESSION_EXPIRED');
    return call<T>(path, body, await token());
  }
}

function adopt(session: { token: string; email: string; name: string | null }) {
  localStorage.setItem('token', session.token);
  localStorage.setItem('accountEmail', session.email);
  if (session.name) localStorage.setItem('accountName', session.name);
  else localStorage.removeItem('accountName'); // accounts made before names existed
}

/** Creates the account when [name] is given, otherwise signs in. */
export async function signIn(email: string, password: string, name?: string) {
  adopt(await call(name ? '/auth/signup' : '/auth/login', { email, password, ...(name && { name }) }, null));
}

/** Emails a 6-digit code; the answer is the same whether the email has an account or not. */
export const requestPasswordReset = (email: string) => call('/auth/password/forgot', { email }, null);

/** Sets the new password with the emailed code and signs in; the account's other sessions stop working. */
export async function resetPassword(email: string, code: string, password: string) {
  adopt(await call('/auth/password/reset', { email, code, password }, null));
}

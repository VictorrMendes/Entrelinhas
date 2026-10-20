/** The backend, through /api on this same origin (nginx in production, Vite's proxy in development). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** The server's own message; shown only where it is written for the reader (why a book can't be read). */
    readonly detail?: string,
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

type Body = string | Uint8Array<ArrayBuffer> | null;
const JSON_TYPE = 'application/json';

async function exchange(method: string, path: string, body: Body, type: string, auth: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== null) headers['content-type'] = type;
  if (auth) headers.authorization = `Bearer ${auth}`;
  try {
    return await fetch(`/api${path}`, { method, headers, body });
  } catch {
    throw new ApiError(0, 'NO_CONNECTION');
  }
}

/** Our own error answers; null for anything else, such as a proxy's error page. */
const errorOf = (res: Response) =>
  res.json().then(
    (j) => (typeof j?.error?.code === 'string' ? { code: j.error.code as string, message: String(j.error.message ?? '') } : null),
    () => null,
  );

async function send(method: string, path: string, body: Body, type: string, auth: string | null): Promise<Response> {
  let res = await exchange(method, path, body, type, auth);
  // Cloudflare answers 502-504 on its own while the server restarts; one retry hides that. Auth calls aren't repeated:
  // a lost answer there may already have taken effect.
  if (res.status >= 502 && res.status <= 504 && !path.startsWith('/auth/') && !(await errorOf(res.clone()))) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await exchange(method, path, body, type, auth);
  }
  if (!res.ok) {
    const error = await errorOf(res);
    throw new ApiError(res.status, error?.code ?? `HTTP_${res.status}`, error?.message);
  }
  return res;
}

const data = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
const call = async <T>(path: string, body: unknown, auth: string | null) => data<T>(await send('POST', path, JSON.stringify(body), JSON_TYPE, auth));

/** An expired or unknown token signs out and registers the device again once; sync calls report the expired session instead. */
async function authed(method: string, path: string, body: Body = null, type = JSON_TYPE): Promise<Response> {
  try {
    return await send(method, path, body, type, await token());
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
    const hadAccount = account() !== null;
    signOut();
    // the account's own data: an anonymous session would only find nothing
    if (hadAccount && (path.startsWith('/sync') || path.startsWith('/books'))) throw new ApiError(401, 'SESSION_EXPIRED');
    return send(method, path, body, type, await token());
  }
}

export const post = async <T>(path: string, body: unknown) => data<T>(await authed('POST', path, JSON.stringify(body)));
export const getJson = async <T>(path: string) => data<T>(await authed('GET', path));
export const putJson = async <T>(path: string, body: unknown) => data<T>(await authed('PUT', path, JSON.stringify(body)));
export const getBytes = async (path: string) => new Uint8Array(await (await authed('GET', path)).arrayBuffer());
export const getBlob = async (path: string) => (await authed('GET', path)).blob();
export const putBytes = async (path: string, bytes: Uint8Array<ArrayBuffer>) => {
  await authed('PUT', path, bytes, 'application/octet-stream');
};
export const del = async (path: string) => {
  await authed('DELETE', path);
};

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

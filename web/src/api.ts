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

async function call<T>(path: string, body: unknown, auth: string | null): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await fetch(`/api${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? `HTTP_${res.status}`);
  return json.data as T;
}

/** An expired or unknown token registers the device again once. */
export async function post<T>(path: string, body: unknown): Promise<T> {
  try {
    return await call<T>(path, body, await token());
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
    localStorage.removeItem('token');
    return call<T>(path, body, await token());
  }
}

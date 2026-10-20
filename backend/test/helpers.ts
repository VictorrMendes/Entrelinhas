import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { Mailer } from '../src/mail.ts';
import type { Model } from '../src/translate/gemini.ts';

export async function makeApp(
  options: { gemini?: Model; nvidia?: Model | null; mailer?: Mailer | null; env?: Record<string, string> } = {},
) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leitor-test-'));
  const config = loadConfig({ DATA_DIR: dataDir, JWT_SECRET: 'test-secret-with-at-least-32-characters!', ...options.env });
  const app = buildApp(config, {
    gemini: options.gemini ?? (async () => ({ text: 'ok', usage: { tokens: { input: 0, output: 0, total: 0 } } })),
    nvidia: options.nvidia ?? null,
    mailer: options.mailer === undefined ? async () => {} : options.mailer,
    logger: false,
  });
  await app.ready();
  after(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return app;
}

type App = Awaited<ReturnType<typeof makeApp>>;

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** An email account: the kind that can add books. */
export async function emailToken(app: App, email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password 1', name: 'Ana' } });
  return res.json().data.token;
}

export async function deviceToken(app: App, deviceId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/device',
    payload: { deviceId, secret: `secret-of-${deviceId}`.padEnd(40, 'x') },
  });
  return res.json().data.token;
}

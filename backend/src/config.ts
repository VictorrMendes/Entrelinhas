import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  jwtSecret: string;
  geminiApiKey: string | undefined;
  geminiModel: string;
  /** Asked when the main model is rate limited or slow; each model has its own free-tier quota. */
  geminiFallbackModels: string[];
  /** Optional: NVIDIA's free hosted models back Gemini up (asked when it is rate limited or slow) and estimate book levels. */
  nvidiaApiKey: string | undefined;
  nvidiaModel: string;
  dailyCharLimit: number;
  maxAccountBytes: number;
  /** Behind a reverse proxy (Caddy, Nginx, Cloudflare Tunnel) the client IP comes from X-Forwarded-For. */
  trustProxy: boolean;
  logLevel: string;
  production: boolean;
  /** smtps://user:password@host:465; without it, password reset emails are unavailable in production. */
  smtpUrl: string | undefined;
  mailFrom: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const int = (name: string, fallback: number) => {
    const raw = env[name];
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
    return n;
  };
  const dataDir = path.resolve(env.DATA_DIR || path.join(import.meta.dirname, '..', 'data'));
  fs.mkdirSync(dataDir, { recursive: true });

  if (production && (env.JWT_SECRET ?? '').length < 32) throw new Error('JWT_SECRET must have at least 32 characters');
  if (production && !env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required');

  return {
    port: int('PORT', 8787),
    dataDir,
    jwtSecret: env.JWT_SECRET || devSecret(dataDir),
    geminiApiKey: env.GEMINI_API_KEY,
    // flash-lite measured ~0.85s per paragraph vs ~4s (and occasional 503s) for gemini-3.7-flash
    geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    geminiFallbackModels: (env.GEMINI_FALLBACK_MODELS || 'gemini-3.1-flash-lite')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    nvidiaApiKey: env.NVIDIA_API_KEY || undefined,
    // the best balance measured: 10/12 ambiguous words right in 0.7-1.2 s; reasoning models took 45 s or more
    nvidiaModel: env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
    dailyCharLimit: int('DAILY_CHAR_LIMIT', 200_000),
    maxAccountBytes: int('MAX_ACCOUNT_BYTES', 1024 ** 3),
    trustProxy: env.TRUST_PROXY === 'true',
    logLevel: env.LOG_LEVEL || 'info',
    production,
    smtpUrl: env.SMTP_URL || undefined,
    mailFrom: env.MAIL_FROM || 'Entrelinhas <no-reply@localhost>',
  };
}

/** Outside production a secret is generated once and kept with the data, so restarts don't sign everyone out. */
function devSecret(dataDir: string): string {
  const file = path.join(dataDir, 'jwt-secret');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

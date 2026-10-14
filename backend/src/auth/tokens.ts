import crypto from 'node:crypto';

const TTL_SECONDS = 30 * 24 * 3600;

export interface Tokens {
  issue(accountId: number): string;
  /** The account id of a well-signed, unexpired token; whether the account still exists is the guard's job. */
  verify(token: string): number | null;
}

/** HS256 JWTs. The signature is always checked as HS256 whatever the header claims, so `alg` tricks don't apply. */
export function createTokens(secret: string): Tokens {
  const hmac = (data: string) => crypto.createHmac('sha256', secret).update(data).digest();
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    issue(accountId) {
      const head = encode({ alg: 'HS256', typ: 'JWT' });
      const body = encode({ sub: String(accountId), exp: Math.floor(Date.now() / 1000) + TTL_SECONDS });
      return `${head}.${body}.${hmac(`${head}.${body}`).toString('base64url')}`;
    },
    verify(token) {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [head, body, sig] = parts as [string, string, string];
      const want = hmac(`${head}.${body}`);
      const got = Buffer.from(sig, 'base64url');
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
      let claims: { sub?: unknown; exp?: unknown };
      try {
        claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null;
      const id = Number(claims.sub);
      return Number.isInteger(id) ? id : null;
    },
  };
}

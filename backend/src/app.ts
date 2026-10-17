import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError } from 'fastify';
import { resetRoutes } from './auth/reset.ts';
import { authRoutes } from './auth/routes.ts';
import { createTokens, type Tokens } from './auth/tokens.ts';
import type { Config } from './config.ts';
import { crashRoutes } from './crashes/routes.ts';
import { openDb } from './db.ts';
import { ApiError, fail } from './errors.ts';
import { createMailer, type Mailer } from './mail.ts';
import { fileRoutes } from './sync/files.ts';
import { snapshotRoutes } from './sync/snapshot.ts';
import { createGemini, type Model, modelPool } from './translate/gemini.ts';
import { createNvidia } from './translate/nvidia.ts';
import { translateRoutes } from './translate/routes.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Error code for a request body that fails the route's schema (default INVALID_REQUEST). */
    invalidCode?: string;
  }
}

export interface Deps {
  config: Config;
  db: DatabaseSync;
  tokens: Tokens;
  gemini: Model;
  nvidia: Model | null;
  mailer: Mailer | null;
}

export function buildApp(
  config: Config,
  overrides: { gemini?: Model; nvidia?: Model | null; mailer?: Mailer | null; logger?: boolean } = {},
) {
  const app = Fastify({
    logger: overrides.logger === false ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 100_000,
  });
  const db = openDb(path.join(config.dataDir, 'leitor.db'));
  const nvidia = overrides.nvidia !== undefined ? overrides.nvidia : createNvidia(config.nvidiaApiKey, config.nvidiaModel);
  const gemini = (model: string) => createGemini(config.geminiApiKey, model);
  const deps: Deps = {
    config,
    db,
    tokens: createTokens(config.jwtSecret),
    // Gemini answers first (best quality); NVIDIA is next in line when it is rate limited or slow, then the other Gemini models
    gemini:
      overrides.gemini ??
      modelPool([gemini(config.geminiModel), nvidia, ...config.geminiFallbackModels.map(gemini)].filter((m): m is Model => m !== null)),
    nvidia,
    mailer: overrides.mailer !== undefined ? overrides.mailer : createMailer(config),
  };
  app.addHook('onClose', async () => db.close());

  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send(fail(error.code, error.message));
    if (error.validation) return reply.code(400).send(fail(request.routeOptions.config.invalidCode ?? 'INVALID_REQUEST', error.message));
    const status = error.statusCode ?? 500;
    if (status === 429) return reply.code(429).send(fail('TOO_MANY_REQUESTS', 'Too many requests, try again in a minute'));
    if (status < 500) return reply.code(status).send(fail(error.code ?? 'BAD_REQUEST', error.message));
    request.log.error(error);
    return reply.code(500).send(fail('INTERNAL', 'Internal error'));
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send(fail('NOT_FOUND', 'Route not found')));

  // used by the container healthcheck: answers only when the database does
  app.get('/health', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true, model: config.geminiModel };
  });

  app.register(rateLimit, { global: false });
  app.register(authRoutes, deps);
  app.register(resetRoutes, deps);
  app.register(translateRoutes, deps);
  app.register(snapshotRoutes, deps);
  app.register(fileRoutes, deps);
  app.register(crashRoutes, deps);
  return app;
}

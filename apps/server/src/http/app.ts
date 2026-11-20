/**
 * Builds the Fastify app, the services and Socket.IO. `main.ts` adds migrations, seeding and
 * listening; tests call this directly with an in-memory database.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AuthService, type AuthUser, SESSION_COOKIE, SESSION_TTL_MS } from '../auth/service';
import type { AppConfig } from '../config';
import type { ApiErrorBody } from '../contracts';
import type { Database } from '../db/database';
import { AppError } from '../errors';
import { DraftService } from '../games/draft';
import { SeasonService } from '../games/season';
import { GameService, NULL_HUB } from '../games/service';
import { createRealtime } from '../realtime/socket';
import { registerAdminRoutes } from './routes/admin';
import { registerAuthRoutes } from './routes/auth';
import { registerDraftRoutes } from './routes/draft';
import { registerGameRoutes } from './routes/games';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export interface ServerContext {
  config: AppConfig;
  database: Database;
  auth: AuthService;
  games: GameService;
  draft: DraftService;
  seasons: SeasonService;
  /** Sets or clears the session cookie. */
  setSession(reply: FastifyReply, token: string | null): void;
}

export interface BuildOptions {
  config: AppConfig;
  database: Database;
  logger?: boolean;
  bcryptCost?: number;
  /** Requests per minute per IP on login, register and guest. */
  authRateLimit?: number;
}

export interface BuiltServer {
  app: FastifyInstance;
  ctx: ServerContext;
  close(): Promise<void>;
}

export async function buildServer(options: BuildOptions): Promise<BuiltServer> {
  const { config, database } = options;
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: config.NODE_ENV === 'production',
    bodyLimit: 64 * 1024,
  });

  const auth = new AuthService(database, {
    adminUsername: config.ADMIN_USERNAME,
    ...(options.bcryptCost === undefined ? {} : { bcryptCost: options.bcryptCost }),
  });
  const games = new GameService(database, undefined, { countdownSeconds: config.START_COUNTDOWN_SECONDS });
  const draft = new DraftService(database, NULL_HUB, {
    botDelayMs: config.BOT_PICK_DELAY_MS,
    disconnectGraceMs: config.DISCONNECT_GRACE_SECONDS * 1000,
    autoStartSeasonMs: 10_000,
  });
  const seasons = new SeasonService(database, NULL_HUB, draft);
  games.setExtensions({
    snapshotExtras: async (game, parts, viewer) => ({
      draft: await draft.draftView(game, parts, viewer),
      ...(await seasons.snapshotExtras(game)),
    }),
    connectionChanged: (gameId, participantId, connected) => draft.connectionChanged(gameId, participantId, connected),
    draftStarted: (gameId) => draft.schedule(gameId),
  });

  const ctx: ServerContext = {
    config,
    database,
    auth,
    games,
    draft,
    seasons,
    setSession(reply, token) {
      if (token === null) {
        void reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return;
      }
      void reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.COOKIE_SECURE,
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      });
    },
  };

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    req.user = await auth.resolve(req.cookies[SESSION_COOKIE]);
  });

  app.setErrorHandler((err, req, reply) => {
    const send = (status: number, body: ApiErrorBody) => reply.status(status).send(body);
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return send(400, { error: { code: 'invalid_input', message: issues[0]?.message ?? 'Invalid input', issues } });
    }
    if (err instanceof AppError) return send(err.status, { error: { code: err.code, message: err.message } });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) return send(429, { error: { code: 'rate_limited', message: 'Too many attempts. Wait a minute and try again.' } });
    if (status < 500) return send(status, { error: { code: 'bad_request', message: (err as Error).message } });
    req.log.error(err);
    return send(500, { error: { code: 'internal', message: 'Something went wrong on our side' } });
  });

  app.get('/api/health', () => ({ ok: true }));
  registerAuthRoutes(app, ctx, { rateLimit: options.authRateLimit ?? 20 });
  registerGameRoutes(app, ctx);
  registerDraftRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  // Production: serve the built web app, with client-side routing falling back to index.html.
  const webDist = config.WEB_DIST ? path.resolve(config.WEB_DIST) : undefined;
  if (webDist && existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/socket.io')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } } satisfies ApiErrorBody);
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } } satisfies ApiErrorBody),
    );
  }

  await app.ready();
  const { io, hub } = createRealtime(app.server, auth, games, (header) => app.parseCookie(header));
  games.setHub(hub);
  draft.setHub(hub);
  seasons.setHub(hub);

  return {
    app,
    ctx,
    close: async () => {
      games.dispose();
      draft.dispose();
      io.disconnectSockets(true);
      await app.close();
      await io.close().catch(() => undefined);
    },
  };
}

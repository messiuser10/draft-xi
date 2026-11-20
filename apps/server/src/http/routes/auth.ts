import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE, toMeView } from '../../auth/service';
import { guestSchema, loginSchema, type MeView, registerSchema } from '../../contracts';
import { getSetting } from '../../settings/app-settings';
import type { ServerContext } from '../app';

export function registerAuthRoutes(app: FastifyInstance, ctx: ServerContext, opts: { rateLimit: number }): void {
  const limited = { config: { rateLimit: { max: opts.rateLimit, timeWindow: '1 minute' } } };

  app.post('/api/auth/register', limited, async (req, reply) => {
    const { user, token } = await ctx.auth.register(registerSchema.parse(req.body));
    ctx.setSession(reply, token);
    return reply.status(201).send({ user: toMeView(user) });
  });

  app.post('/api/auth/login', limited, async (req, reply) => {
    const { user, token } = await ctx.auth.login(loginSchema.parse(req.body));
    ctx.setSession(reply, token);
    return { user: toMeView(user) };
  });

  app.post('/api/auth/guest', limited, async (req, reply) => {
    const { user, token } = await ctx.auth.guest(guestSchema.parse(req.body));
    ctx.setSession(reply, token);
    return reply.status(201).send({ user: toMeView(user) });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await ctx.auth.logout(req.cookies[SESSION_COOKIE]);
    ctx.setSession(reply, null);
    return { ok: true };
  });

  app.get('/api/auth/me', (req): { user: MeView | null } => ({
    user: req.user ? toMeView(req.user) : null,
  }));

  /** Public site settings the web app needs before anyone signs in. */
  app.get('/api/site', async () => ({
    leagueName: await getSetting(ctx.database, 'league.name'),
    banner: await getSetting(ctx.database, 'site.banner'),
    registrationsOpen: await getSetting(ctx.database, 'registrations.open'),
    publicLobbiesEnabled: await getSetting(ctx.database, 'lobbies.publicEnabled'),
    maxHumansLimit: await getSetting(ctx.database, 'game.maxHumansLimit'),
    timerRange: await getSetting(ctx.database, 'draft.timerRange'),
    formations: await getSetting(ctx.database, 'formations.enabled'),
    gameDefaults: await getSetting(ctx.database, 'game.defaults'),
    tableBands: await getSetting(ctx.database, 'table.bands'),
    maintenance: await getSetting(ctx.database, 'site.maintenance'),
  }));
}

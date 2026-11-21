import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../../auth/service';
import {
  captainSchema,
  disconnectPolicySchema,
  extendTimerSchema,
  joinCodeSchema,
  monteCarloQuerySchema,
  pickSchema,
  playbackSchema,
  proposeTradeSchema,
  respondTradeSchema,
  transferSchema,
  windowReadySchema,
  type PoolView,
  queueSchema,
  replaceWithBotSchema,
  runSeasonsSchema,
} from '../../contracts';
import { loadPool } from '../../games/pool';
import type { ServerContext } from '../app';

const codeParams = z.object({ code: joinCodeSchema });
const seasonParams = codeParams.extend({ n: z.coerce.number().int().min(1) });
const tradeParams = codeParams.extend({ id: z.coerce.number().int().positive() });

/** Draft room (M3) and season (M4) endpoints. Every rule is enforced in the services. */
export function registerDraftRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { draft, seasons } = ctx;
  const code = (params: unknown) => codeParams.parse(params).code;

  /** The whole draftable pool. Changes only when an admin edits players. */
  app.get('/api/pool', async (): Promise<PoolView> => {
    const pool = await loadPool(ctx.database);
    return {
      clubs: pool.clubs.map((c) => ({
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        primaryColor: c.primaryColor,
        secondaryColor: c.secondaryColor,
        strengthRating: c.strengthRating,
      })),
      players: pool.players.map((p) => ({
        id: p.id,
        clubId: p.clubId,
        name: p.name,
        primaryPosition: p.primaryPosition,
        altPositions: [...p.altPositions],
        overall: p.overall,
        nationality: p.nationality,
      })),
    };
  });

  // ---------- Draft ----------

  app.post('/api/games/:code/picks', async (req, reply) => {
    const body = pickSchema.parse(req.body);
    const pick = await draft.pick(code(req.params), req.user, body.playerId, body.slotKey);
    return reply.status(201).send({ pick });
  });

  app.get('/api/games/:code/spin', async (req) => ({ spin: await draft.spinFor(code(req.params)) }));
  app.post('/api/games/:code/spin/respin', async (req) => ({ spin: await draft.respin(code(req.params), req.user) }));
  app.get('/api/games/:code/pack', async (req) => ({ options: await draft.packOptionsFor(code(req.params), req.user) }));
  app.post('/api/games/:code/pack/reroll', async (req) => ({ options: await draft.reroll(code(req.params), req.user) }));

  app.put('/api/games/:code/queue', async (req) => ({
    queue: await draft.setQueue(code(req.params), req.user, queueSchema.parse(req.body).playerIds),
  }));

  /** Host (or admin) controls during the draft. */
  const hostAction = (path: string, run: (c: string, r: { user: AuthUser | null; body: unknown }) => Promise<unknown>) => {
    app.post(`/api/games/:code/draft/${path}`, async (req) => (await run(code(req.params), { user: req.user, body: req.body })) ?? { ok: true });
  };
  hostAction('pause', (c, r) => draft.pause(c, r.user));
  hostAction('resume', (c, r) => draft.resume(c, r.user));
  hostAction('skip', async (c, r) => ({ pick: await draft.skip(c, r.user) }));
  hostAction('undo', (c, r) => draft.undo(c, r.user));
  hostAction('extend', (c, r) => draft.extend(c, r.user, extendTimerSchema.parse(r.body ?? {}).seconds));
  hostAction('end', (c, r) => draft.endEarly(c, r.user));
  hostAction('bot', (c, r) => {
    const body = replaceWithBotSchema.parse(r.body);
    return draft.setAutoDraft(c, r.user, body.participantId, body.enabled);
  });
  hostAction('disconnect-policy', (c, r) => draft.setDisconnectPolicy(c, r.user, disconnectPolicySchema.parse(r.body).policy));

  // ---------- Season ----------

  app.post('/api/games/:code/season', async (req, reply) => {
    const season = await seasons.start(code(req.params), req.user);
    return reply.status(201).send({ season });
  });

  app.post('/api/games/:code/seasons', async (req, reply) => {
    const created = await seasons.runMore(code(req.params), req.user, runSeasonsSchema.parse(req.body ?? {}).count);
    return reply.status(201).send({ seasons: created });
  });

  app.get('/api/games/:code/seasons', async (req) => {
    const c = code(req.params);
    const game = await ctx.games.getByCode(c);
    return { seasons: await seasons.list(game.id), titles: await seasons.titles(c) };
  });

  app.get('/api/games/:code/seasons/:n', async (req) => {
    const params = seasonParams.parse(req.params);
    return seasons.season(params.code, params.n);
  });

  app.get('/api/games/:code/league', async (req) => seasons.league(code(req.params)));

  app.get('/api/games/:code/montecarlo', async (req) =>
    seasons.monteCarlo(code(req.params), monteCarloQuerySchema.parse(req.query).runs),
  );

  // ---------- Rounds: captain, transfers, trades, windows ----------

  const { rounds } = ctx;
  app.get('/api/games/:code/round', async (req) => ({ round: await rounds.view(await ctx.games.getByCode(code(req.params))) }));
  app.put('/api/games/:code/captain', async (req) => {
    await rounds.setCaptain(code(req.params), req.user, captainSchema.parse(req.body).playerId);
    return { ok: true };
  });
  app.post('/api/games/:code/transfers', async (req, reply) => {
    const body = transferSchema.parse(req.body);
    await rounds.transfer(code(req.params), req.user, body.slotKey, body.playerId);
    return reply.status(201).send({ ok: true });
  });
  app.post('/api/games/:code/trades', async (req, reply) => {
    const trade = await rounds.proposeTrade(code(req.params), req.user, proposeTradeSchema.parse(req.body));
    return reply.status(201).send({ trade });
  });
  app.post('/api/games/:code/trades/:id', async (req) => {
    const { id } = tradeParams.parse(req.params);
    return { trade: await rounds.respondTrade(code(req.params), req.user, id, respondTradeSchema.parse(req.body).action) };
  });
  app.post('/api/games/:code/window/ready', async (req) => {
    await rounds.setReady(code(req.params), req.user, windowReadySchema.parse(req.body).ready);
    return { ok: true };
  });
  app.post('/api/games/:code/window/close', async (req) => {
    await rounds.close(code(req.params), req.user);
    return { ok: true };
  });
  app.get('/api/games/:code/leaderboard', async (req) => rounds.leaderboard(code(req.params)));

  app.post('/api/games/:code/playback', async (req) => ({
    playback: await seasons.playback(code(req.params), req.user, playbackSchema.parse(req.body)),
  }));
}

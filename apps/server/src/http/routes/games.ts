import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addBotSchema,
  chatSchema,
  createGameSchema,
  joinCodeSchema,
  joinGameSchema,
  pickOrderSchema,
  soloGameSchema,
  startGameSchema,
  transferHostSchema,
  updateMeSchema,
  updateSettingsSchema,
} from '../../contracts';
import { toGameView } from '../../games/views';
import type { ServerContext } from '../app';

const codeParams = z.object({ code: joinCodeSchema });
const participantParams = codeParams.extend({ participantId: z.coerce.number().int().positive() });

export function registerGameRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { games } = ctx;
  const code = (params: unknown) => codeParams.parse(params).code;

  app.get('/api/games/public', async () => ({ lobbies: await games.listPublicLobbies() }));

  app.post('/api/games', async (req, reply) => {
    const game = await games.create(req.user, createGameSchema.parse(req.body));
    return reply.status(201).send({ game: toGameView(game) });
  });

  app.post('/api/games/solo', async (req, reply) => {
    const game = await games.createSolo(req.user, soloGameSchema.parse(req.body).team);
    return reply.status(201).send({ game: toGameView(game) });
  });

  // Anyone with the code may spectate.
  app.get('/api/games/:code', async (req) => games.snapshotByCode(code(req.params), req.user));

  app.post('/api/games/:code/join', async (req, reply) => {
    const participant = await games.join(code(req.params), req.user, joinGameSchema.parse(req.body));
    return reply.status(201).send({ participantId: participant.id });
  });

  app.patch('/api/games/:code/me', async (req) => {
    const participant = await games.updateMe(code(req.params), req.user, updateMeSchema.parse(req.body));
    return { participantId: participant.id };
  });

  app.post('/api/games/:code/leave', async (req) => {
    await games.leave(code(req.params), req.user);
    return { ok: true };
  });

  app.patch('/api/games/:code/settings', async (req) => {
    const game = await games.updateSettings(code(req.params), req.user, updateSettingsSchema.parse(req.body));
    return { game: toGameView(game) };
  });

  app.post('/api/games/:code/bots', async (req, reply) => {
    const bot = await games.addBot(code(req.params), req.user, addBotSchema.parse(req.body).level);
    return reply.status(201).send({ participantId: bot.id });
  });

  app.delete('/api/games/:code/participants/:participantId', async (req) => {
    const params = participantParams.parse(req.params);
    await games.kick(params.code, req.user, params.participantId);
    return { ok: true };
  });

  app.post('/api/games/:code/host', async (req) => {
    await games.transferHost(code(req.params), req.user, transferHostSchema.parse(req.body).participantId);
    return { ok: true };
  });

  app.post('/api/games/:code/order', async (req) => ({
    order: await games.setPickOrder(code(req.params), req.user, pickOrderSchema.parse(req.body)),
  }));

  app.post('/api/games/:code/start', async (req) =>
    games.requestStart(code(req.params), req.user, startGameSchema.parse(req.body ?? {}).force ?? false),
  );

  app.post('/api/games/:code/start/cancel', async (req) => {
    await games.cancelStart(code(req.params), req.user);
    return { ok: true };
  });

  app.post('/api/games/:code/cancel', async (req) => {
    await games.cancel(code(req.params), req.user);
    return { ok: true };
  });

  app.post('/api/games/:code/chat', async (req, reply) => {
    const message = await games.chat(code(req.params), req.user, chatSchema.parse(req.body).body);
    return reply.status(201).send({ message });
  });
}

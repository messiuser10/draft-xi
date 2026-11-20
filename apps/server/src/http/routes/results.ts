/** Results, team pages, export, rematch, profiles and history (M5). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../auth/service';
import { exportQuerySchema, joinCodeSchema, seasonQuerySchema } from '../../contracts';
import { toGameView } from '../../games/views';
import type { ServerContext } from '../app';

const codeParams = z.object({ code: joinCodeSchema });
const teamParams = codeParams.extend({ teamId: z.string().regex(/^\d+$/) });
const userParams = z.object({ userId: z.coerce.number().int().positive() });

export function registerResultsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { results } = ctx;

  app.get('/api/games/:code/results', async (req) =>
    results.results(codeParams.parse(req.params).code, seasonQuerySchema.parse(req.query).season),
  );

  app.get('/api/games/:code/teams/:teamId', async (req) => {
    const { code, teamId } = teamParams.parse(req.params);
    return results.team(code, seasonQuerySchema.parse(req.query).season, teamId);
  });

  app.get('/api/games/:code/export', async (req, reply) => {
    const file = await results.export(codeParams.parse(req.params).code, req.user, exportQuerySchema.parse(req.query).format);
    return reply
      .header('content-type', `${file.contentType}; charset=utf-8`)
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .send(file.body);
  });

  app.post('/api/games/:code/rematch', async (req, reply) => {
    const game = await results.rematch(codeParams.parse(req.params).code, req.user);
    return reply.status(201).send({ game: toGameView(game) });
  });

  app.get('/api/profile', async (req) => results.profile(requireUser(req.user).id));
  app.get('/api/users/:userId/profile', async (req) => results.profile(userParams.parse(req.params).userId));
  app.get('/api/hall-of-fame', async () => ({ entries: await results.hallOfFame() }));
  app.get('/api/leaderboard', async () => ({ rows: await results.leaderboard() }));
  app.get('/api/records', async () => results.records());
}

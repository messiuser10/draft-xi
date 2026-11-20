/** Admin endpoints for M2: user list and promotion. The full admin panel arrives in M6. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, toMeView } from '../../auth/service';
import { promoteSchema } from '../../contracts';
import type { ServerContext } from '../app';

const userParams = z.object({ userId: z.coerce.number().int().positive() });

export function registerAdminRoutes(app: FastifyInstance, ctx: ServerContext): void {
  // Every /api/admin route is refused for non-admins, before its handler runs.
  app.addHook('preHandler', (req, _reply, done) => {
    try {
      if (req.url.startsWith('/api/admin')) requireAdmin(req.user);
      done();
    } catch (err) {
      done(err as Error);
    }
  });

  app.get('/api/admin/users', async (req) => ({
    users: (await ctx.auth.listUsers(requireAdmin(req.user))).map(toMeView),
  }));

  app.patch('/api/admin/users/:userId/role', async (req) => {
    const { userId } = userParams.parse(req.params);
    const user = await ctx.auth.setRole(requireAdmin(req.user), userId, promoteSchema.parse(req.body).role);
    return { user: toMeView(user) };
  });
}

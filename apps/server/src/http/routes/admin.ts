/** Admin panel endpoints (spec section 11). Every route is refused for non-admins before its handler runs. */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin, toMeView } from '../../auth/service';
import {
  adminAuditQuerySchema,
  adminBanSchema,
  adminBulkPlayersSchema,
  adminClubInputSchema,
  adminClubPatchSchema,
  adminGameQuerySchema,
  adminImportSchema,
  adminPlayerInputSchema,
  adminPlayerPatchSchema,
  adminPlayerQuerySchema,
  adminRebalanceSchema,
  adminSeedSchema,
  adminSettingSchema,
  adminUserQuerySchema,
  announcementSchema,
  exportQuerySchema,
  joinCodeSchema,
  labRunSchema,
  promoteSchema,
  testDraftSchema,
} from '../../contracts';
import type { ServerContext } from '../app';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const userParams = z.object({ userId: z.coerce.number().int().positive() });
const codeParams = z.object({ code: joinCodeSchema });
const keyParams = z.object({ key: z.string().min(1).max(60) });
/** Imports carry a whole players file (a full export is a few hundred KB). */
const IMPORT_BODY_LIMIT = 6 * 1024 * 1024;
const rankingQuery = z.object({ humans: z.coerce.number().int().min(1).max(20).default(3) });

export function registerAdminRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { admin } = ctx;

  // Every /api/admin route is refused for non-admins, before its handler runs.
  app.addHook('preHandler', (req, _reply, done) => {
    try {
      if (req.url.startsWith('/api/admin')) requireAdmin(req.user);
      done();
    } catch (err) {
      done(err as Error);
    }
  });

  const download = (reply: FastifyReply, file: { body: string; contentType: string; filename: string }) =>
    reply.header('content-type', `${file.contentType}; charset=utf-8`).header('content-disposition', `attachment; filename="${file.filename}"`).send(file.body);

  // Overview
  app.get('/api/admin/overview', async (req) => admin.overview(req.user));

  // Players
  app.get('/api/admin/players', async (req) => admin.listPlayers(req.user, adminPlayerQuerySchema.parse(req.query)));
  app.post('/api/admin/players', async (req, reply) => reply.status(201).send({ player: await admin.createPlayer(req.user, adminPlayerInputSchema.parse(req.body)) }));
  app.patch('/api/admin/players/:id', async (req) => ({ player: await admin.updatePlayer(req.user, idParams.parse(req.params).id, adminPlayerPatchSchema.parse(req.body)) }));
  app.delete('/api/admin/players/:id', async (req) => {
    await admin.deletePlayer(req.user, idParams.parse(req.params).id);
    return { ok: true };
  });
  app.post('/api/admin/players/bulk', async (req) => admin.bulkPlayers(req.user, adminBulkPlayersSchema.parse(req.body)));
  app.get('/api/admin/players/export', async (req, reply) => download(reply, await admin.exportPlayers(req.user, exportQuerySchema.parse(req.query).format)));
  app.post('/api/admin/players/import/preview', { bodyLimit: IMPORT_BODY_LIMIT }, async (req) => {
    const { format, content } = adminImportSchema.parse(req.body);
    return admin.importPreview(req.user, format, content);
  });
  app.post('/api/admin/players/import/apply', { bodyLimit: IMPORT_BODY_LIMIT }, async (req) => {
    const { format, content } = adminImportSchema.parse(req.body);
    return admin.importApply(req.user, format, content);
  });
  app.get('/api/admin/players/duplicates', async (req) => ({ groups: await admin.duplicates(req.user) }));

  // Clubs
  app.get('/api/admin/clubs', async (req) => ({ clubs: await admin.listClubs(req.user) }));
  app.post('/api/admin/clubs', async (req, reply) => reply.status(201).send({ club: await admin.createClub(req.user, adminClubInputSchema.parse(req.body)) }));
  app.patch('/api/admin/clubs/:id', async (req) => ({ club: await admin.updateClub(req.user, idParams.parse(req.params).id, adminClubPatchSchema.parse(req.body)) }));
  app.post('/api/admin/clubs/:id/rebalance', async (req) => admin.rebalance(req.user, idParams.parse(req.params).id, adminRebalanceSchema.parse(req.body).delta));
  app.get('/api/admin/clubs/ranking', async (req) => admin.ranking(req.user, rankingQuery.parse(req.query).humans));

  // Games (host controls such as pause, skip and undo use the game endpoints, which admins may call)
  app.get('/api/admin/games', async (req) => ({ games: await admin.listGames(req.user, adminGameQuerySchema.parse(req.query).status) }));
  app.post('/api/admin/games/:code/reset-draft', async (req) => {
    await admin.resetDraft(req.user, codeParams.parse(req.params).code);
    return { ok: true };
  });
  app.post('/api/admin/games/:code/rerun', async (req) => {
    await admin.rerun(req.user, codeParams.parse(req.params).code);
    return { ok: true };
  });
  app.post('/api/admin/games/:code/seed', async (req) => {
    await admin.setSeed(req.user, codeParams.parse(req.params).code, adminSeedSchema.parse(req.body).seed);
    return { ok: true };
  });
  app.delete('/api/admin/games/:code', async (req) => {
    await admin.deleteGame(req.user, codeParams.parse(req.params).code);
    return { ok: true };
  });

  // Settings
  app.get('/api/admin/settings', async (req) => ({ settings: await admin.listSettings(req.user) }));
  app.put('/api/admin/settings/:key', async (req) => ({
    setting: await admin.updateSetting(req.user, keyParams.parse(req.params).key, adminSettingSchema.parse(req.body).value),
  }));

  // Simulation Lab
  app.post('/api/admin/lab/run', async (req) => admin.labRun(req.user, labRunSchema.parse(req.body)));
  app.post('/api/admin/lab/test-draft', async (req, reply) => reply.status(201).send(await admin.testDraft(req.user, testDraftSchema.parse(req.body ?? {}))));

  // Users
  app.get('/api/admin/users', async (req) => {
    const q = adminUserQuerySchema.parse(req.query);
    return { users: await admin.listUsers(req.user, q.search, q.includeGuests) };
  });
  app.patch('/api/admin/users/:userId/role', async (req) => {
    const { userId } = userParams.parse(req.params);
    const user = await ctx.auth.setRole(requireAdmin(req.user), userId, promoteSchema.parse(req.body).role);
    return { user: toMeView(user) };
  });
  app.post('/api/admin/users/:userId/ban', async (req) => {
    await admin.setBanned(req.user, userParams.parse(req.params).userId, adminBanSchema.parse(req.body).banned);
    return { ok: true };
  });
  app.get('/api/admin/users/:userId/games', async (req) => ({ games: await admin.userGames(req.user, userParams.parse(req.params).userId) }));
  app.delete('/api/admin/users/:userId', async (req) => {
    await admin.deleteUser(req.user, userParams.parse(req.params).userId);
    return { ok: true };
  });

  // Audit log
  app.get('/api/admin/audit', async (req, reply) => {
    const q = adminAuditQuerySchema.parse(req.query);
    const rows = await admin.auditLog(req.user, q);
    if (q.format === 'csv') return download(reply, { body: admin.auditCsv(rows), contentType: 'text/csv', filename: 'audit-log.csv' });
    return { entries: rows };
  });

  // Announcements
  app.put('/api/admin/announcement', async (req) => {
    await admin.announce(req.user, announcementSchema.parse(req.body).text);
    return { ok: true };
  });
}

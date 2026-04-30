import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { adminActionLogs, roles, users } from '../db/schema.js';
import { getSessionIdentity } from './session-auth.js';

const ROLE_ORDER = ['owner', 'admin', 'moderator', 'user'] as const;
type AppRole = (typeof ROLE_ORDER)[number];

function hasAdminAccess(roleNames: string[]): boolean {
  return roleNames.includes('owner') || roleNames.includes('admin') || roleNames.includes('moderator');
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/users', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const query = String((request.query as { q?: string }).q ?? '').trim();
    const filters = query
      ? or(ilike(users.displayName, `%${query}%`), ilike(users.twitchLogin, `%${query}%`), ilike(users.twitchUserId, `%${query}%`))
      : undefined;

    const rows = await db
      .select({
        id: users.id,
        twitchUserId: users.twitchUserId,
        displayName: users.displayName,
        login: users.twitchLogin,
        isDeleted: users.isDeleted,
        role: roles.role
      })
      .from(users)
      .leftJoin(roles, eq(roles.userId, users.id))
      .where(filters)
      .orderBy(desc(users.createdAt))
      .limit(50);

    const byUser = new Map<string, { id: string; twitchUserId: string; displayName: string | null; login: string | null; isDeleted: boolean; roles: string[] }>();
    for (const row of rows) {
      if (!byUser.has(row.id)) {
        byUser.set(row.id, { id: row.id, twitchUserId: row.twitchUserId, displayName: row.displayName, login: row.login, isDeleted: row.isDeleted, roles: [] });
      }
      if (row.role) byUser.get(row.id)?.roles.push(row.role);
    }

    return { users: [...byUser.values()] };
  });

  app.get('/api/admin/users/:userId', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const userId = (request.params as { userId: string }).userId;
    const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const target = userRows[0];
    if (!target) return reply.code(404).send({ message: 'User not found' });

    const targetRoles = await db.select({ role: roles.role }).from(roles).where(eq(roles.userId, target.id));
    return { user: target, roles: targetRoles.map((x) => x.role) };
  });

  app.post('/api/admin/users/:userId/role', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !identity.roles.includes('owner')) return reply.code(403).send({ message: 'Owner required' });

    const userId = (request.params as { userId: string }).userId;
    const body = (request.body ?? {}) as { role?: string; action?: string; requestId?: string };
    const role = body.role as AppRole;
    const action = body.action;
    const requestId = body.requestId;

    if (!ROLE_ORDER.includes(role) || !['grant', 'revoke'].includes(String(action)) || !requestId) {
      return reply.code(400).send({ message: 'Invalid role mutation payload' });
    }

    const target = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (target.length === 0) return reply.code(404).send({ message: 'User not found' });

    const duplicate = await db.select({ id: adminActionLogs.id }).from(adminActionLogs).where(eq(adminActionLogs.requestId, requestId)).limit(1);
    if (duplicate.length > 0) return reply.code(200).send({ status: 'ok', idempotent: true });

    await db.transaction(async (tx) => {
      if (action === 'grant') {
        await tx
          .insert(roles)
          .values({ userId, role, createdByUserId: identity.userId })
          .onConflictDoNothing({ target: [roles.userId, roles.role] });
      } else {
        await tx.delete(roles).where(and(eq(roles.userId, userId), eq(roles.role, role)));
      }

      await tx.insert(adminActionLogs).values({
        actorUserId: identity.userId,
        targetUserId: userId,
        actionType: 'role_change',
        requestId,
        payload: { role, action }
      });
    });

    return { status: 'ok', idempotent: false };
  });

  app.get('/api/admin/logs', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const logRows = await db.select().from(adminActionLogs).orderBy(desc(adminActionLogs.createdAt)).limit(100);
    return { logs: logRows };
  });
}

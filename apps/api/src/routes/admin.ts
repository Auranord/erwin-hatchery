import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  adminActionLogs,
  consumableInventory,
  economyLedger,
  eggTypes,
  hiddenPetEggs,
  mysteryEggInventory,
  pets,
  resources,
  roles,
  twitchEvents,
  users
} from '../db/schema.js';
import { getSessionIdentity } from './session-auth.js';
import { getEventSubSubscriptionStatus, syncChannelPointRedemptionEventSub } from '../services/twitchEventSub.js';

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
    const requestId = body.requestId?.trim() || randomUUID();

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

  app.get('/api/admin/users/:userId/inventory', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });
    const userId = (request.params as { userId: string }).userId;

    const [mysteryEggs, hiddenEggRows, petRows, consumableRows, resourceRows] = await Promise.all([
      db.select().from(mysteryEggInventory).where(eq(mysteryEggInventory.userId, userId)),
      db.select({ id: hiddenPetEggs.id, eggTypeId: hiddenPetEggs.eggTypeId, state: hiddenPetEggs.state }).from(hiddenPetEggs).where(eq(hiddenPetEggs.ownerUserId, userId)),
      db.select({ id: pets.id, petTypeId: pets.petTypeId, createdAt: pets.createdAt }).from(pets).where(eq(pets.ownerUserId, userId)),
      db.select().from(consumableInventory).where(eq(consumableInventory.userId, userId)),
      db.select().from(resources).where(eq(resources.userId, userId))
    ]);

    return {
      inventory: {
        mysteryEggs,
        hiddenPetEggs: hiddenEggRows,
        hatchedPets: petRows,
        consumables: consumableRows,
        crackedEggResources: resourceRows
      }
    };
  });

  app.get('/api/admin/egg-types/active', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const activeTypes = await db
      .select({ id: eggTypes.id, displayName: eggTypes.displayName, isActive: eggTypes.isActive })
      .from(eggTypes)
      .where(eq(eggTypes.isActive, true))
      .orderBy(eggTypes.id);

    return {
      activeEggTypes: activeTypes.map((eggType) => ({
        ...eggType,
        isMysteryEggType: eggType.id.includes('mystery_egg')
      })),
      hasActiveMysteryEggType: activeTypes.some((eggType) => eggType.id.includes('mystery_egg'))
    };
  });



  app.get('/api/admin/debug/eventsub-subscription', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const refresh = String((request.query as { refresh?: string }).refresh ?? '').toLowerCase();
    if (refresh === '1' || refresh === 'true') {
      await syncChannelPointRedemptionEventSub(request.log);
    }

    return getEventSubSubscriptionStatus();
  });

  app.get('/api/admin/debug/eventsubs', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const events = await db
      .select({
        id: twitchEvents.id,
        twitchEventId: twitchEvents.twitchEventId,
        type: twitchEvents.type,
        source: twitchEvents.source,
        processingStatus: twitchEvents.processingStatus,
        receivedAt: twitchEvents.receivedAt,
        processedAt: twitchEvents.processedAt,
        error: twitchEvents.error
      })
      .from(twitchEvents)
      .orderBy(desc(twitchEvents.receivedAt))
      .limit(25);

    return { events };
  });

  app.get('/api/admin/ledger', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });
    const userId = String((request.query as { userId?: string }).userId ?? '').trim();

    const rows = await db.select().from(economyLedger)
      .where(userId ? eq(economyLedger.userId, userId) : undefined)
      .orderBy(desc(economyLedger.createdAt))
      .limit(200);
    return { entries: rows };
  });

  app.post('/api/admin/users/:userId/grant-test-mystery-egg', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });
    const userId = (request.params as { userId: string }).userId;
    const body = (request.body ?? {}) as { requestId?: string; eggTypeId?: string; amount?: number };
    const requestId = body.requestId?.trim() || randomUUID();
    const requestedEggTypeId = body.eggTypeId?.trim();
    const amount = Number(body.amount ?? 1);
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }
    const duplicate = await db.select({ id: adminActionLogs.id }).from(adminActionLogs).where(eq(adminActionLogs.requestId, requestId)).limit(1);
    if (duplicate.length > 0) return reply.code(200).send({ status: 'ok', idempotent: true });

    const eggTypeCandidates = requestedEggTypeId ? [requestedEggTypeId] : ['basic_mystery_egg', 'mystery_egg'];
    const availableEggTypes = await db.select({ id: eggTypes.id, isActive: eggTypes.isActive }).from(eggTypes);
    const activeEggTypes = availableEggTypes.filter((eggType) => eggType.isActive);
    const selectedEggType = eggTypeCandidates
      .map((candidate) => activeEggTypes.find((eggType) => eggType.id === candidate))
      .find((eggType) => eggType !== undefined)
      ?? activeEggTypes[0];

    if (!selectedEggType) {
      request.log.warn({ userId, requestedEggTypeId, eggTypeCandidates }, 'Admin test mystery egg grant blocked: no active egg types available');
      return reply.code(400).send({
        code: 'NO_ACTIVE_EGG_TYPES',
        message: `No active egg types found. Tried: ${eggTypeCandidates.join(', ')}`
      });
    }
    const eggTypeId = selectedEggType.id;

    await db.transaction(async (tx) => {
      await tx.insert(mysteryEggInventory).values({ userId, eggTypeId, amount })
        .onConflictDoUpdate({
          target: [mysteryEggInventory.userId, mysteryEggInventory.eggTypeId],
          set: { amount: sql`${mysteryEggInventory.amount} + ${amount}`, updatedAt: sql`now()` }
        });

      const insertedLedgerRows = await tx.insert(economyLedger).values({
        userId,
        actorUserId: identity.userId,
        eventType: 'admin_test_mystery_egg_grant',
        sourceType: 'admin_action',
        delta: { mysteryEggInventory: [{ eggTypeId, amountDelta: amount }] }
      }).returning({ id: economyLedger.id });
      const ledgerRow = insertedLedgerRows[0];
      if (!ledgerRow) throw new Error('Failed to create ledger entry for test mystery egg grant');

      await tx.insert(adminActionLogs).values({
        actorUserId: identity.userId,
        targetUserId: userId,
        actionType: 'grant_test_mystery_egg',
        requestId,
        payload: { eggTypeId, amount, ledgerId: ledgerRow.id, reversible: true }
      });
    });

    return { status: 'ok', idempotent: false };
  });

  app.post('/api/admin/ledger/:ledgerId/revert', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });
    const ledgerId = (request.params as { ledgerId: string }).ledgerId;
    const body = (request.body ?? {}) as { requestId?: string };
    if (!body.requestId) return reply.code(400).send({ message: 'requestId is required' });
    const requestId = body.requestId;
    const duplicate = await db.select({ id: adminActionLogs.id }).from(adminActionLogs).where(eq(adminActionLogs.requestId, requestId)).limit(1);
    if (duplicate.length > 0) return reply.code(200).send({ status: 'ok', idempotent: true });

    await db.transaction(async (tx) => {
      const [entry] = await tx.select().from(economyLedger).where(eq(economyLedger.id, ledgerId)).limit(1);
      if (!entry) throw new Error('Ledger entry not found');
      if (entry.isReverted) throw new Error('Ledger entry already reverted');
      if (entry.eventType !== 'admin_test_mystery_egg_grant') throw new Error('Only reversible admin test grant events are supported');
      const delta = entry.delta as { mysteryEggInventory?: Array<{ eggTypeId: string; amountDelta: number }> };
      const firstDelta = delta.mysteryEggInventory?.[0];
      if (!firstDelta || !entry.userId) throw new Error('Invalid ledger delta');
      await tx.insert(mysteryEggInventory).values({ userId: entry.userId, eggTypeId: firstDelta.eggTypeId, amount: 0 })
        .onConflictDoNothing();
      await tx.update(mysteryEggInventory)
        .set({ amount: sql`GREATEST(${mysteryEggInventory.amount} - ${firstDelta.amountDelta}, 0)`, updatedAt: sql`now()` })
        .where(and(eq(mysteryEggInventory.userId, entry.userId), eq(mysteryEggInventory.eggTypeId, firstDelta.eggTypeId)));

      await tx.insert(economyLedger).values({
        userId: entry.userId,
        actorUserId: identity.userId,
        eventType: 'admin_revert_test_mystery_egg_grant',
        sourceType: 'admin_revert',
        sourceId: entry.id,
        delta: { mysteryEggInventory: [{ eggTypeId: firstDelta.eggTypeId, amountDelta: -Math.abs(firstDelta.amountDelta) }] },
        revertsLedgerId: entry.id
      });
      await tx.update(economyLedger).set({ isReverted: true }).where(eq(economyLedger.id, entry.id));
      await tx.insert(adminActionLogs).values({
        actorUserId: identity.userId,
        targetUserId: entry.userId,
        actionType: 'revert_ledger_entry',
        requestId,
        payload: { ledgerId }
      });
    });
    return { status: 'ok', idempotent: false };
  });
}

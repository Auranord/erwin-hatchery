import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  adminActionLogs,
  consumableInventory,
  economyLedger,
  eggTypes,
  unhatchedEggs,
  mysteryEggInventory,
  incubatorSlots,
  pets,
  resources,
  roles,
  twitchEvents,
  users,
  gameEvents,
  gameEventParticipants,
  leaderboardScores
} from '../db/schema.js';
import { getSessionIdentity } from './session-auth.js';
import { getEventSubSubscriptionStatus, syncChannelPointRedemptionEventSub } from '../services/twitchEventSub.js';
import { listManagedCustomRewards, syncEggTypeCustomRewards } from '../services/twitchRewards.js';
import { getCurrentStreamState, getManualStreamStateOverride, setManualStreamStateOverride } from '../services/streamState.js';

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

    const [mysteryEggs, unhatchedEggRows, petRows, consumableRows, resourceRows, incubatorSlotRows] = await Promise.all([
      db.select().from(mysteryEggInventory).where(eq(mysteryEggInventory.userId, userId)),
      db.select({
        id: unhatchedEggs.id,
        eggTypeId: unhatchedEggs.eggTypeId,
        hiddenPetTypeId: unhatchedEggs.hiddenPetTypeId,
        state: unhatchedEggs.state
      }).from(unhatchedEggs).where(eq(unhatchedEggs.ownerUserId, userId)),
      db.select({ id: pets.id, petTypeId: pets.petTypeId, createdAt: pets.createdAt }).from(pets).where(eq(pets.ownerUserId, userId)),
      db.select().from(consumableInventory).where(eq(consumableInventory.userId, userId)),
      db.select().from(resources).where(eq(resources.userId, userId)),
      db.select().from(incubatorSlots).where(eq(incubatorSlots.ownerUserId, userId))
    ]);

    return {
      inventory: {
        mysteryEggs,
        unhatchedEggs: unhatchedEggRows,
        hatchedPets: petRows,
        consumables: consumableRows,
        crackedEggResources: resourceRows,
        incubatorSlots: incubatorSlotRows
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




  app.get('/api/admin/twitch/custom-rewards', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const rewards = await listManagedCustomRewards();
    return {
      rewards: rewards.map((reward) => ({
        id: reward.id,
        name: reward.title,
        description: reward.prompt,
        cost: reward.cost
      }))
    };
  });


  app.post('/api/admin/twitch/custom-rewards/sync', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const body = (request.body ?? {}) as { requestId?: string };
    const requestId = body.requestId?.trim() || randomUUID();
    const duplicate = await db.select({ id: adminActionLogs.id }).from(adminActionLogs).where(eq(adminActionLogs.requestId, requestId)).limit(1);
    if (duplicate.length > 0) return reply.code(200).send({ status: 'ok', idempotent: true });

    const result = await syncEggTypeCustomRewards();

    await db.insert(adminActionLogs).values({
      actorUserId: identity.userId,
      actionType: 'twitch_custom_rewards_sync',
      requestId,
      payload: result
    });

    return { status: 'ok', idempotent: false, ...result };
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

    const eggTypeCandidates = requestedEggTypeId ? [requestedEggTypeId] : ['common_mystery_egg', 'uncommon_mystery_egg', 'rare_mystery_egg'];
    const availableEggTypes = await db.select({ id: eggTypes.id, isActive: eggTypes.isActive }).from(eggTypes);
    const selectedEggType = eggTypeCandidates
      .map((candidate) => availableEggTypes.find((eggType) => eggType.id === candidate))
      .find((eggType) => eggType !== undefined)
      ?? availableEggTypes[0];

    if (!selectedEggType) {
      request.log.warn({ userId, requestedEggTypeId, eggTypeCandidates }, 'Admin test mystery egg grant blocked: no egg types available');
      return reply.code(400).send({
        code: 'NO_EGG_TYPES',
        message: `No egg types found. Tried: ${eggTypeCandidates.join(', ')}`
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

  app.post('/api/admin/users/:userId/grant-incubator-slot', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });
    const userId = (request.params as { userId: string }).userId;
    const body = (request.body ?? {}) as { requestId?: string };
    const requestId = body.requestId?.trim() || randomUUID();

    const duplicate = await db.select({ id: adminActionLogs.id }).from(adminActionLogs).where(eq(adminActionLogs.requestId, requestId)).limit(1);
    if (duplicate.length > 0) return reply.code(200).send({ status: 'ok', idempotent: true });

    await db.transaction(async (tx) => {
      const [targetUser] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
      if (!targetUser) throw new Error('User not found');

      const [createdSlot] = await tx.insert(incubatorSlots).values({
        ownerUserId: userId,
        slotSource: 'admin_grant',
        slotLevel: 1,
        isAvailable: true,
        removeWhenEmpty: false
      }).returning({ id: incubatorSlots.id });
      if (!createdSlot) throw new Error('Failed to create incubator slot');

      const [ledgerRow] = await tx.insert(economyLedger).values({
        userId,
        actorUserId: identity.userId,
        eventType: 'admin_incubator_slot_grant',
        sourceType: 'admin_action',
        delta: { incubatorSlots: [{ id: createdSlot.id, change: 1, source: 'admin_grant' }] }
      }).returning({ id: economyLedger.id });
      if (!ledgerRow) throw new Error('Failed to create ledger entry for incubator slot grant');

      await tx.insert(adminActionLogs).values({
        actorUserId: identity.userId,
        targetUserId: userId,
        actionType: 'grant_incubator_slot',
        requestId,
        payload: { incubatorSlotId: createdSlot.id, ledgerId: ledgerRow.id }
      });
    });

    return { status: 'ok', idempotent: false };
  });



  app.post('/api/admin/events/start', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const body = (request.body ?? {}) as { requestId?: string };
    const requestId = body.requestId?.trim() || randomUUID();

    const duplicate = await db.select({ id: adminActionLogs.id }).from(adminActionLogs).where(eq(adminActionLogs.requestId, requestId)).limit(1);
    if (duplicate.length > 0) return reply.code(200).send({ status: 'ok', idempotent: true });

    const result = await db.transaction(async (tx) => {
      const selectedPets = await tx
        .select({ id: pets.id, ownerUserId: pets.ownerUserId })
        .from(pets)
        .where(eq(pets.selectedForEvent, true))
        .orderBy(sql`random()`)
        .limit(3);

      if (selectedPets.length < 3) {
        return { kind: 'not_enough_pets' as const, selectedCount: selectedPets.length };
      }

      const [createdEvent] = await tx.insert(gameEvents).values({
        eventType: 'battle',
        status: 'resolved',
        startedByUserId: identity.userId,
        resolvedAt: new Date()
      }).returning({ id: gameEvents.id });
      if (!createdEvent) throw new Error('Failed to create game event');

      const placements = [
        { placement: 1, pointsAwarded: 3 },
        { placement: 2, pointsAwarded: 2 },
        { placement: 3, pointsAwarded: 1 }
      ] as const;

      for (let i = 0; i < selectedPets.length; i += 1) {
        const pet = selectedPets[i]!;
        const score = placements[i]!;

        await tx.insert(gameEventParticipants).values({
          gameEventId: createdEvent.id,
          userId: pet.ownerUserId,
          petId: pet.id,
          placement: score.placement,
          pointsAwarded: score.pointsAwarded
        });

        await tx.insert(leaderboardScores).values({
          userId: pet.ownerUserId,
          leaderboardType: 'battle_points',
          score: score.pointsAwarded,
          updatedAt: new Date()
        }).onConflictDoUpdate({
          target: [leaderboardScores.userId, leaderboardScores.leaderboardType],
          set: { score: sql`${leaderboardScores.score} + ${score.pointsAwarded}`, updatedAt: sql`now()` }
        });

        await tx.insert(economyLedger).values({
          userId: pet.ownerUserId,
          actorUserId: identity.userId,
          eventType: 'battle_points_awarded',
          sourceType: 'battle_event',
          sourceId: createdEvent.id,
          delta: { leaderboard: [{ leaderboardType: 'battle_points', pointsDelta: score.pointsAwarded, placement: score.placement, petId: pet.id }] }
        });
      }

      await tx.update(pets).set({ selectedForEvent: false }).where(eq(pets.selectedForEvent, true));

      await tx.update(gameEvents).set({
        resultJson: {
          winners: selectedPets.map((pet, index) => ({
            petId: pet.id,
            userId: pet.ownerUserId,
            placement: placements[index]!.placement,
            pointsAwarded: placements[index]!.pointsAwarded
          }))
        }
      }).where(eq(gameEvents.id, createdEvent.id));

      await tx.insert(adminActionLogs).values({
        actorUserId: identity.userId,
        actionType: 'start_battle_event',
        requestId,
        payload: { gameEventId: createdEvent.id }
      });

      return { kind: 'ok' as const, gameEventId: createdEvent.id };
    });

    if (result.kind === 'not_enough_pets') {
      return reply.code(400).send({ message: `At least 3 selected pets are required. Found: ${result.selectedCount}` });
    }

    return { status: 'ok', idempotent: false, gameEventId: result.gameEventId };
  });

  app.get('/api/admin/events', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const events = await db.select().from(gameEvents).where(eq(gameEvents.eventType, 'battle')).orderBy(desc(gameEvents.createdAt)).limit(25);
    return { events };
  });

  app.post('/api/admin/events/:eventId/revert', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });
    const eventId = (request.params as { eventId: string }).eventId;
    const body = (request.body ?? {}) as { requestId?: string };
    if (!body.requestId) return reply.code(400).send({ message: 'requestId is required' });
    const requestId = body.requestId;

    const duplicate = await db.select({ id: adminActionLogs.id }).from(adminActionLogs).where(eq(adminActionLogs.requestId, body.requestId)).limit(1);
    if (duplicate.length > 0) return reply.code(200).send({ status: 'ok', idempotent: true });

    await db.transaction(async (tx) => {
      const [eventRow] = await tx.select().from(gameEvents).where(eq(gameEvents.id, eventId)).limit(1);
      if (!eventRow) throw new Error('Game event not found');
      if (eventRow.eventType !== 'battle') throw new Error('Only battle events are reversible');
      if (eventRow.status === 'reverted') throw new Error('Game event already reverted');

      const participantRows = await tx.select().from(gameEventParticipants).where(eq(gameEventParticipants.gameEventId, eventId));
      if (participantRows.length === 0) throw new Error('No participants found for game event');

      for (const participant of participantRows) {
        await tx.insert(leaderboardScores).values({
          userId: participant.userId,
          leaderboardType: 'battle_points',
          score: 0
        }).onConflictDoNothing();

        await tx.update(leaderboardScores)
          .set({
            score: sql`GREATEST(${leaderboardScores.score} - ${participant.pointsAwarded}, 0)`,
            updatedAt: sql`now()`
          })
          .where(and(eq(leaderboardScores.userId, participant.userId), eq(leaderboardScores.leaderboardType, 'battle_points')));

        await tx.insert(economyLedger).values({
          userId: participant.userId,
          actorUserId: identity.userId,
          eventType: 'admin_revert_battle_points_award',
          sourceType: 'admin_revert',
          sourceId: eventId,
          delta: { leaderboard: [{ leaderboardType: 'battle_points', pointsDelta: -Math.abs(participant.pointsAwarded), placement: participant.placement, petId: participant.petId }] }
        });
      }

      await tx.update(gameEvents).set({
        status: 'reverted',
        revertedAt: new Date()
      }).where(eq(gameEvents.id, eventId));

      await tx.insert(adminActionLogs).values({
        actorUserId: identity.userId,
        actionType: 'revert_battle_event',
        requestId,
        payload: { eventId }
      });
    });

    return { status: 'ok', idempotent: false };
  });


  app.get('/api/admin/stream-state', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const state = await getCurrentStreamState();
    return { state: { ...state, manualOverride: getManualStreamStateOverride() } };
  });

  app.post('/api/admin/stream-state/override', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles)) return reply.code(403).send({ message: 'Forbidden' });

    const body = (request.body ?? {}) as { mode?: 'live' | 'offline' | 'auto'; requestId?: string };
    const requestId = body.requestId?.trim() || randomUUID();
    if (!body.mode || !['live', 'offline', 'auto'].includes(body.mode)) return reply.code(400).send({ message: 'Invalid mode' });

    const duplicate = await db.select({ id: adminActionLogs.id }).from(adminActionLogs).where(eq(adminActionLogs.requestId, requestId)).limit(1);
    if (duplicate.length > 0) return reply.code(200).send({ status: 'ok', idempotent: true });

    setManualStreamStateOverride(body.mode === 'auto' ? null : body.mode);
    await db.insert(adminActionLogs).values({
      actorUserId: identity.userId,
      actionType: 'stream_state_override_set',
      requestId,
      payload: { mode: body.mode }
    });

    return { status: 'ok', idempotent: false, mode: body.mode };
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

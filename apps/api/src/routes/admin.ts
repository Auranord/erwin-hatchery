import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  adminActionLogs,
  consumableInventorySlots,
  equipmentInventorySlots,
  equipmentSets,
  userHatUnlocks,
  economyLedger,
  eggTypes,
  unhatchedEggs,
  mysteryEggInventory,
  incubatorSlots,
  inventoryDimensions,
  pets,
  petClasses,
  resources,
  roles,
  twitchEvents,
  users,
  gameEvents,
  gatewayWebhookEvents,
  gameEventParticipants,
  leaderboardScores,
  twitchBackfillRuns
} from '../db/schema.js';
import { getSessionIdentity } from './session-auth.js';
import {
  getEventSubSubscriptionStatus,
  syncChannelPointRedemptionEventSub
} from '../services/twitchEventSub.js';
import {
  listEggTypeGatewayRewardStatusForAdmin,
  syncEggTypeGatewayRewardsForAdmin
} from '../services/gatewayEggRewards.js';
import {
  listGatewayRewardsForAdmin,
  syncGatewayRewardsForAdmin,
  type GatewayRewardMappingRequest
} from '../services/gatewayRewardMappings.js';
import { ErwinGatewayError } from '../services/erwinGatewayClient.js';
import {
  getCurrentStreamState,
  getManualStreamStateOverride,
  setManualStreamStateOverride
} from '../services/streamState.js';
import { config } from '../config.js';
import { calculateLevelStatBonus, levelForTrainingPoints, type PetStatId, type PetStats } from '@erwin/shared';

const ROLE_ORDER = ['owner', 'admin', 'moderator', 'user'] as const;
type AppRole = (typeof ROLE_ORDER)[number];


type TrainingLedgerDelta = {
  target_pet_id: string;
  consumed_pet_ids: string[];
  consumed_pet_previous_slots?: Array<{ id: string; slotIndex: number | null }>;
  training_points_awarded: number;
  training_points_before: number;
  training_points_after: number;
  target_level_before: number;
  target_level_after: number;
  levels_gained: number;
  stat_bonus_before: PetStats;
  stat_bonus_after: PetStats;
  stat_changes: PetStats;
};

function isPetStatId(value: string): value is PetStatId {
  return ['HP', 'ATK', 'DEF', 'SPD', 'GAIN', 'POW'].includes(value);
}

function normalizePetStat(value: string): PetStatId {
  if (!isPetStatId(value)) throw new Error(`Invalid pet stat id: ${value}`);
  return value;
}

function petStatsToBonusColumns(stats: PetStats) {
  return {
    levelBonusHp: stats.HP,
    levelBonusAtk: stats.ATK,
    levelBonusDef: stats.DEF,
    levelBonusSpd: stats.SPD,
    levelBonusGain: stats.GAIN,
    levelBonusPow: stats.POW
  };
}


function gatewayAdminErrorPayload(error: unknown, fallbackMessage: string) {
  if (error instanceof ErwinGatewayError) {
    return {
      message: fallbackMessage,
      gatewayStatus: error.status,
      gatewayCode: error.code,
      gatewayError: error.message,
      gatewayDetails: error.details,
      twitchStatus: error.twitchStatus,
      twitchErrorExcerpt: error.twitchErrorExcerpt,
      gatewayIssues: error.issues
    };
  }
  return { message: fallbackMessage };
}

function gatewayAdminLogPayload(error: unknown) {
  if (error instanceof ErwinGatewayError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
      twitchStatus: error.twitchStatus,
      twitchErrorExcerpt: error.twitchErrorExcerpt,
      gatewayIssues: error.issues
    };
  }
  return { error: error instanceof Error ? error.message : 'unknown' };
}

function hasAdminAccess(roleNames: string[]): boolean {
  return (
    roleNames.includes('owner') ||
    roleNames.includes('admin') ||
    roleNames.includes('moderator')
  );
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/overlay-config', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    return { overlaySecret: config.OVERLAY_SECRET ?? null };
  });

  app.get('/api/admin/users', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const query = String((request.query as { q?: string }).q ?? '').trim();
    const filters = query
      ? or(
          ilike(users.displayName, `%${query}%`),
          ilike(users.twitchLogin, `%${query}%`),
          ilike(users.twitchUserId, `%${query}%`)
        )
      : undefined;

    const rows = await db
      .select({
        id: users.id,
        twitchUserId: users.twitchUserId,
        displayName: users.displayName,
        login: users.twitchLogin,
        isDeleted: users.isDeleted,
        isSubscriber: users.isSubscriber,
        subscriberEndsAt: users.subscriberEndsAt,
        role: roles.role
      })
      .from(users)
      .leftJoin(roles, eq(roles.userId, users.id))
      .where(filters)
      .orderBy(desc(users.createdAt))
      .limit(50);

    const byUser = new Map<
      string,
      {
        id: string;
        twitchUserId: string;
        displayName: string | null;
        login: string | null;
        isDeleted: boolean;
        isSubscriber: boolean;
        subscriberEndsAt: Date | null;
        roles: string[];
      }
    >();
    for (const row of rows) {
      if (!byUser.has(row.id)) {
        byUser.set(row.id, {
          id: row.id,
          twitchUserId: row.twitchUserId,
          displayName: row.displayName,
          login: row.login,
          isDeleted: row.isDeleted,
          isSubscriber: row.isSubscriber,
          subscriberEndsAt: row.subscriberEndsAt,
          roles: []
        });
      }
      if (row.role) byUser.get(row.id)?.roles.push(row.role);
    }

    return { users: [...byUser.values()] };
  });

  app.get('/api/admin/users/:userId', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const userId = (request.params as { userId: string }).userId;
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const target = userRows[0];
    if (!target) return reply.code(404).send({ message: 'User not found' });

    const targetRoles = await db
      .select({ role: roles.role })
      .from(roles)
      .where(eq(roles.userId, target.id));
    return { user: target, roles: targetRoles.map((x) => x.role) };
  });

  app.post('/api/admin/users/:userId/role', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !identity.roles.includes('owner'))
      return reply.code(403).send({ message: 'Owner required' });

    const userId = (request.params as { userId: string }).userId;
    const body = (request.body ?? {}) as {
      role?: string;
      action?: string;
      requestId?: string;
    };
    const role = body.role as AppRole;
    const action = body.action;
    const requestId = body.requestId?.trim() || randomUUID();

    if (
      !ROLE_ORDER.includes(role) ||
      !['grant', 'revoke'].includes(String(action)) ||
      !requestId
    ) {
      return reply.code(400).send({ message: 'Invalid role mutation payload' });
    }

    const target = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (target.length === 0)
      return reply.code(404).send({ message: 'User not found' });

    const duplicate = await db
      .select({ id: adminActionLogs.id })
      .from(adminActionLogs)
      .where(eq(adminActionLogs.requestId, requestId))
      .limit(1);
    if (duplicate.length > 0)
      return reply.code(200).send({ status: 'ok', idempotent: true });

    await db.transaction(async (tx) => {
      if (action === 'grant') {
        await tx
          .insert(roles)
          .values({ userId, role, createdByUserId: identity.userId })
          .onConflictDoNothing({ target: [roles.userId, roles.role] });
      } else {
        await tx
          .delete(roles)
          .where(and(eq(roles.userId, userId), eq(roles.role, role)));
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
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const logRows = await db
      .select()
      .from(adminActionLogs)
      .orderBy(desc(adminActionLogs.createdAt))
      .limit(100);
    return { logs: logRows };
  });

  app.get('/api/admin/users/:userId/inventory', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });
    const userId = (request.params as { userId: string }).userId;

    const [
      dimensions,
      mysteryEggs,
      unhatchedEggRows,
      petRows,
      consumableRows,
      equipmentRows,
      hatRows,
      resourceRows,
      incubatorSlotRows
    ] = await Promise.all([
      db
        .select()
        .from(inventoryDimensions)
        .where(eq(inventoryDimensions.userId, userId)),
      db
        .select()
        .from(mysteryEggInventory)
        .where(eq(mysteryEggInventory.userId, userId)),
      db
        .select({
          id: unhatchedEggs.id,
          eggTypeId: unhatchedEggs.eggTypeId,
          hiddenPetSpeciesId: unhatchedEggs.hiddenPetSpeciesId,
          state: unhatchedEggs.state,
          slotIndex: unhatchedEggs.slotIndex
        })
        .from(unhatchedEggs)
        .where(eq(unhatchedEggs.ownerUserId, userId)),
      db
        .select({
          id: pets.id,
          speciesId: pets.speciesId,
          slotIndex: pets.slotIndex,
          createdAt: pets.createdAt
        })
        .from(pets)
        .where(and(eq(pets.ownerUserId, userId), eq(pets.isScrapped, false), eq(pets.status, 'active'))),
      db
        .select()
        .from(consumableInventorySlots)
        .where(eq(consumableInventorySlots.userId, userId)),
      db
        .select()
        .from(equipmentInventorySlots)
        .where(eq(equipmentInventorySlots.userId, userId)),
      db
        .select()
        .from(userHatUnlocks)
        .where(eq(userHatUnlocks.userId, userId)),
      db.select().from(resources).where(eq(resources.userId, userId)),
      db
        .select()
        .from(incubatorSlots)
        .where(eq(incubatorSlots.ownerUserId, userId))
    ]);

    return {
      inventory: {
        dimensions,
        mysteryEggs,
        unhatchedEggs: unhatchedEggRows,
        hatchedPets: petRows,
        consumables: consumableRows,
        equipment: equipmentRows,
        hatUnlocks: hatRows,
        crackedEggResources: resourceRows,
        incubatorSlots: incubatorSlotRows
      }
    };
  });

  app.get('/api/admin/egg-types/active', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const activeTypes = await db
      .select({
        id: eggTypes.id,
        displayName: eggTypes.displayName,
        isActive: eggTypes.isActive
      })
      .from(eggTypes)
      .where(eq(eggTypes.isActive, true))
      .orderBy(eggTypes.id);

    return {
      activeEggTypes: activeTypes.map((eggType) => ({
        ...eggType,
        isMysteryEggType: eggType.id.includes('mystery_egg')
      })),
      hasActiveMysteryEggType: activeTypes.some((eggType) =>
        eggType.id.includes('mystery_egg')
      )
    };
  });

  app.get('/api/admin/erwin-gateway/egg-rewards', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    try {
      return await listEggTypeGatewayRewardStatusForAdmin();
    } catch (error) {
      request.log.warn(gatewayAdminLogPayload(error), 'Failed to list Hatchery egg gateway rewards');
      return reply.code(502).send(gatewayAdminErrorPayload(error, 'Gateway-Ei-Rewards konnten nicht geladen werden.'));
    }
  });

  app.post('/api/admin/erwin-gateway/egg-rewards/sync', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const body = (request.body ?? {}) as { requestId?: string };
    const requestId = body.requestId?.trim() || randomUUID();
    const duplicate = await db
      .select({ id: adminActionLogs.id })
      .from(adminActionLogs)
      .where(eq(adminActionLogs.requestId, requestId))
      .limit(1);
    if (duplicate.length > 0)
      return reply.code(200).send({ status: 'ok', idempotent: true });

    try {
      const result = await syncEggTypeGatewayRewardsForAdmin();

      await db.insert(adminActionLogs).values({
        actorUserId: identity.userId,
        actionType: 'erwin_gateway_egg_rewards_sync',
        requestId,
        payload: result
      });

      return { status: 'ok', idempotent: false, ...result };
    } catch (error) {
      request.log.warn(gatewayAdminLogPayload(error), 'Failed to sync Hatchery egg gateway rewards');
      return reply.code(502).send(gatewayAdminErrorPayload(error, 'Gateway-Ei-Reward-Sync fehlgeschlagen.'));
    }
  });

  app.get('/api/admin/erwin-gateway/rewards', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    try {
      return await listGatewayRewardsForAdmin();
    } catch (error) {
      request.log.warn(gatewayAdminLogPayload(error), 'Failed to list erwin-gateway rewards');
      return reply.code(502).send(gatewayAdminErrorPayload(error, 'erwin-gateway rewards could not be loaded'));
    }
  });

  app.post('/api/admin/erwin-gateway/rewards/sync', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const body = (request.body ?? {}) as { requestId?: string; mappings?: GatewayRewardMappingRequest[] };
    const requestId = body.requestId?.trim() || randomUUID();
    const duplicate = await db
      .select({ id: adminActionLogs.id })
      .from(adminActionLogs)
      .where(eq(adminActionLogs.requestId, requestId))
      .limit(1);
    if (duplicate.length > 0)
      return reply.code(200).send({ status: 'ok', idempotent: true });

    try {
      const result = await syncGatewayRewardsForAdmin(Array.isArray(body.mappings) ? body.mappings : []);

      await db.insert(adminActionLogs).values({
        actorUserId: identity.userId,
        actionType: 'erwin_gateway_rewards_sync',
        requestId,
        payload: result
      });

      return { status: 'ok', idempotent: false, ...result };
    } catch (error) {
      request.log.warn(gatewayAdminLogPayload(error), 'Failed to sync erwin-gateway rewards');
      return reply.code(502).send(gatewayAdminErrorPayload(error, 'erwin-gateway reward sync failed'));
    }
  });


  app.get('/api/admin/erwin-gateway/sub-bits-diagnostics', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const subBitsTypes = [
      'twitch.channel.subscribe',
      'twitch.channel.subscription.end',
      'twitch.channel.subscription.message',
      'twitch.channel.subscription.gift',
      'twitch.channel.cheer'
    ];

    const [recentEvents, voucherGrants, ignoredOrFailedEvents, backfillRuns] = await Promise.all([
      db
        .select({
          id: gatewayWebhookEvents.id,
          deliveryId: gatewayWebhookEvents.deliveryId,
          eventId: gatewayWebhookEvents.eventId,
          eventType: gatewayWebhookEvents.eventType,
          twitchMessageId: gatewayWebhookEvents.twitchMessageId,
          twitchUserId: gatewayWebhookEvents.twitchUserId,
          twitchUserLogin: gatewayWebhookEvents.twitchUserLogin,
          twitchUserDisplayName: gatewayWebhookEvents.twitchUserDisplayName,
          processingStatus: gatewayWebhookEvents.processingStatus,
          error: gatewayWebhookEvents.error,
          createdAt: gatewayWebhookEvents.createdAt,
          processedAt: gatewayWebhookEvents.processedAt
        })
        .from(gatewayWebhookEvents)
        .where(inArray(gatewayWebhookEvents.eventType, subBitsTypes))
        .orderBy(desc(gatewayWebhookEvents.createdAt))
        .limit(50),
      db
        .select({
          id: economyLedger.id,
          userId: economyLedger.userId,
          eventType: economyLedger.eventType,
          sourceId: economyLedger.sourceId,
          delta: economyLedger.delta,
          createdAt: economyLedger.createdAt
        })
        .from(economyLedger)
        .where(eq(economyLedger.sourceType, 'gateway_twitch_event'))
        .orderBy(desc(economyLedger.createdAt))
        .limit(50),
      db
        .select({
          id: gatewayWebhookEvents.id,
          deliveryId: gatewayWebhookEvents.deliveryId,
          eventId: gatewayWebhookEvents.eventId,
          eventType: gatewayWebhookEvents.eventType,
          processingStatus: gatewayWebhookEvents.processingStatus,
          error: gatewayWebhookEvents.error,
          createdAt: gatewayWebhookEvents.createdAt,
          processedAt: gatewayWebhookEvents.processedAt
        })
        .from(gatewayWebhookEvents)
        .where(and(inArray(gatewayWebhookEvents.eventType, subBitsTypes), inArray(gatewayWebhookEvents.processingStatus, ['ignored', 'failed'])))
        .orderBy(desc(gatewayWebhookEvents.createdAt))
        .limit(50),
      db.select().from(twitchBackfillRuns).where(inArray(twitchBackfillRuns.source, ['erwin-gateway/subscriptions/backfill', 'erwin-gateway/bits/backfill'])).orderBy(desc(twitchBackfillRuns.startedAt)).limit(10)
    ]);

    return {
      enabled: config.ERWIN_GATEWAY_ENABLED,
      observeOnly: config.ERWIN_GATEWAY_OBSERVE_ONLY,
      recentEvents,
      voucherGrants,
      ignoredOrFailedEvents,
      backfillRuns
    };
  });

  app.get('/api/admin/debug/eventsub-subscription', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const refresh = String(
      (request.query as { refresh?: string }).refresh ?? ''
    ).toLowerCase();
    if (refresh === '1' || refresh === 'true') {
      await syncChannelPointRedemptionEventSub(request.log);
    }

    return getEventSubSubscriptionStatus();
  });

  app.get('/api/admin/debug/eventsubs', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

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
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });
    const userId = String(
      (request.query as { userId?: string }).userId ?? ''
    ).trim();

    const rows = await db
      .select()
      .from(economyLedger)
      .where(userId ? eq(economyLedger.userId, userId) : undefined)
      .orderBy(desc(economyLedger.createdAt))
      .limit(200);
    return { entries: rows };
  });

  app.post(
    '/api/admin/users/:userId/grant-test-mystery-egg',
    async (request, reply) => {
      const identity = await getSessionIdentity(request);
      if (!identity || !hasAdminAccess(identity.roles))
        return reply.code(403).send({ message: 'Forbidden' });
      const userId = (request.params as { userId: string }).userId;
      const body = (request.body ?? {}) as {
        requestId?: string;
        eggTypeId?: string;
        amount?: number;
      };
      const requestId = body.requestId?.trim() || randomUUID();
      const requestedEggTypeId = body.eggTypeId?.trim();
      const amount = Number(body.amount ?? 1);
      if (!Number.isInteger(amount) || amount <= 0 || amount > 100) {
        return reply.code(400).send({ message: 'Invalid payload' });
      }
      const duplicate = await db
        .select({ id: adminActionLogs.id })
        .from(adminActionLogs)
        .where(eq(adminActionLogs.requestId, requestId))
        .limit(1);
      if (duplicate.length > 0)
        return reply.code(200).send({ status: 'ok', idempotent: true });

      const eggTypeCandidates = requestedEggTypeId
        ? [requestedEggTypeId]
        : ['beta_egg'];
      const availableEggTypes = await db
        .select({ id: eggTypes.id, isActive: eggTypes.isActive })
        .from(eggTypes);
      const selectedEggType =
        eggTypeCandidates
          .map((candidate) =>
            availableEggTypes.find((eggType) => eggType.id === candidate)
          )
          .find((eggType) => eggType !== undefined) ?? availableEggTypes[0];

      if (!selectedEggType) {
        request.log.warn(
          { userId, requestedEggTypeId, eggTypeCandidates },
          'Admin test mystery egg grant blocked: no egg types available'
        );
        return reply.code(400).send({
          code: 'NO_EGG_TYPES',
          message: `No egg types found. Tried: ${eggTypeCandidates.join(', ')}`
        });
      }
      const eggTypeId = selectedEggType.id;

      await db.transaction(async (tx) => {
        await tx
          .insert(mysteryEggInventory)
          .values({ userId, eggTypeId, amount })
          .onConflictDoUpdate({
            target: [mysteryEggInventory.userId, mysteryEggInventory.eggTypeId],
            set: {
              amount: sql`${mysteryEggInventory.amount} + ${amount}`,
              updatedAt: sql`now()`
            }
          });

        const insertedLedgerRows = await tx
          .insert(economyLedger)
          .values({
            userId,
            actorUserId: identity.userId,
            eventType: 'admin_test_mystery_egg_grant',
            sourceType: 'admin_action',
            delta: { mysteryEggInventory: [{ eggTypeId, amountDelta: amount }] }
          })
          .returning({ id: economyLedger.id });
        const ledgerRow = insertedLedgerRows[0];
        if (!ledgerRow)
          throw new Error(
            'Failed to create ledger entry for test mystery egg grant'
          );

        await tx.insert(adminActionLogs).values({
          actorUserId: identity.userId,
          targetUserId: userId,
          actionType: 'grant_test_mystery_egg',
          requestId,
          payload: {
            eggTypeId,
            amount,
            ledgerId: ledgerRow.id,
            reversible: true
          }
        });
      });

      return { status: 'ok', idempotent: false };
    }
  );

  app.post('/api/admin/grant-test-mystery-eggs/all', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const body = (request.body ?? {}) as {
      requestId?: string;
      eggTypeId?: string;
      amount?: number;
    };
    const requestId = body.requestId?.trim() || randomUUID();
    const eggTypeId = body.eggTypeId?.trim();
    const amount = Number(body.amount ?? 1);
    if (!eggTypeId || !Number.isInteger(amount) || amount <= 0 || amount > 100) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }

    const duplicate = await db
      .select({ id: adminActionLogs.id })
      .from(adminActionLogs)
      .where(eq(adminActionLogs.requestId, requestId))
      .limit(1);
    if (duplicate.length > 0)
      return reply.code(200).send({ status: 'ok', idempotent: true });

    const selectedEggType = await db
      .select({ id: eggTypes.id })
      .from(eggTypes)
      .where(and(eq(eggTypes.id, eggTypeId), eq(eggTypes.isActive, true)))
      .limit(1);
    if (selectedEggType.length === 0) {
      return reply.code(400).send({
        code: 'INVALID_EGG_TYPE',
        message: 'Egg type must exist and be active'
      });
    }

    const targetUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isDeleted, false));
    if (targetUsers.length === 0) {
      return reply.code(400).send({
        code: 'NO_TARGET_USERS',
        message: 'No active users found'
      });
    }

    const result = await db.transaction(async (tx) => {
      for (const target of targetUsers) {
        await tx
          .insert(mysteryEggInventory)
          .values({ userId: target.id, eggTypeId, amount })
          .onConflictDoUpdate({
            target: [mysteryEggInventory.userId, mysteryEggInventory.eggTypeId],
            set: {
              amount: sql`${mysteryEggInventory.amount} + ${amount}`,
              updatedAt: sql`now()`
            }
          });
      }

      const insertedLedgerRows = await tx
        .insert(economyLedger)
        .values(
          targetUsers.map((target) => ({
            userId: target.id,
            actorUserId: identity.userId,
            eventType: 'admin_test_mystery_egg_grant',
            sourceType: 'admin_action',
            delta: {
              mysteryEggInventory: [{ eggTypeId, amountDelta: amount }]
            }
          }))
        )
        .returning({ id: economyLedger.id });

      await tx.insert(adminActionLogs).values({
        actorUserId: identity.userId,
        actionType: 'grant_test_mystery_egg_all',
        requestId,
        payload: {
          eggTypeId,
          amount,
          targetUserCount: targetUsers.length,
          ledgerIds: insertedLedgerRows.map((row) => row.id),
          reversible: true
        }
      });

      return { targetUserCount: targetUsers.length };
    });

    return { status: 'ok', idempotent: false, ...result };
  });

  app.post('/api/admin/events/start', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const body = (request.body ?? {}) as { requestId?: string };
    const requestId = body.requestId?.trim() || randomUUID();

    const duplicate = await db
      .select({ id: adminActionLogs.id })
      .from(adminActionLogs)
      .where(eq(adminActionLogs.requestId, requestId))
      .limit(1);
    if (duplicate.length > 0)
      return reply.code(200).send({ status: 'ok', idempotent: true });

    const result = await db.transaction(async (tx) => {
      const selectedPets = await tx
        .select({ id: pets.id, ownerUserId: pets.ownerUserId })
        .from(pets)
        .where(and(eq(pets.selectedForEvent, true), eq(pets.isScrapped, false), eq(pets.status, 'active')))
        .orderBy(sql`random()`)
        .limit(3);

      if (selectedPets.length < 3) {
        return {
          kind: 'not_enough_pets' as const,
          selectedCount: selectedPets.length
        };
      }

      const selectedSetRows = await tx
        .select({
          id: equipmentSets.id,
          userId: equipmentSets.userId,
          setIndex: equipmentSets.setIndex,
          label: equipmentSets.label,
          baseSlotCount: equipmentSets.baseSlotCount,
          bonusSlotCount: equipmentSets.bonusSlotCount,
          itemId: equipmentInventorySlots.id,
          equipmentTypeId: equipmentInventorySlots.equipmentTypeId,
          setSlotIndex: equipmentInventorySlots.equipmentSetSlotIndex
        })
        .from(equipmentSets)
        .leftJoin(equipmentInventorySlots, eq(equipmentInventorySlots.equipmentSetId, equipmentSets.id))
        .where(
          and(
            inArray(equipmentSets.userId, selectedPets.map((pet) => pet.ownerUserId)),
            eq(equipmentSets.selectedForEvent, true)
          )
        );
      const selectedEquipmentSetByUserId = new Map<string, unknown>();
      for (const row of selectedSetRows) {
        const existing = selectedEquipmentSetByUserId.get(row.userId) as
          | {
              id: string;
              setIndex: number;
              label: string;
              slotCount: number;
              items: Array<{ id: string; equipmentTypeId: string; slotIndex: number }>;
            }
          | undefined;
        const snapshot =
          existing ??
          {
            id: row.id,
            setIndex: row.setIndex,
            label: row.label,
            slotCount: row.baseSlotCount + row.bonusSlotCount,
            items: []
          };
        if (row.itemId && row.equipmentTypeId && row.setSlotIndex !== null) {
          snapshot.items.push({
            id: row.itemId,
            equipmentTypeId: row.equipmentTypeId,
            slotIndex: row.setSlotIndex
          });
        }
        selectedEquipmentSetByUserId.set(row.userId, snapshot);
      }

      const [createdEvent] = await tx
        .insert(gameEvents)
        .values({
          eventType: 'battle',
          status: 'resolved',
          startedByUserId: identity.userId,
          resolvedAt: new Date()
        })
        .returning({ id: gameEvents.id });
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
          pointsAwarded: score.pointsAwarded,
          runtimeState: {
            current_ap: 0,
            current_hp: null,
            attacks_made: 0,
            effective_stats: null,
            class_stacks: {},
            element_stacks: {},
            selected_equipment_set:
              selectedEquipmentSetByUserId.get(pet.ownerUserId) ?? null
          }
        });

        await tx
          .insert(leaderboardScores)
          .values({
            userId: pet.ownerUserId,
            leaderboardType: 'battle_points',
            score: score.pointsAwarded,
            updatedAt: new Date()
          })
          .onConflictDoUpdate({
            target: [
              leaderboardScores.userId,
              leaderboardScores.leaderboardType
            ],
            set: {
              score: sql`${leaderboardScores.score} + ${score.pointsAwarded}`,
              updatedAt: sql`now()`
            }
          });

        await tx.insert(economyLedger).values({
          userId: pet.ownerUserId,
          actorUserId: identity.userId,
          eventType: 'battle_points_awarded',
          sourceType: 'battle_event',
          sourceId: createdEvent.id,
          delta: {
            leaderboard: [
              {
                leaderboardType: 'battle_points',
                pointsDelta: score.pointsAwarded,
                placement: score.placement,
                petId: pet.id,
                selectedEquipmentSet:
                  selectedEquipmentSetByUserId.get(pet.ownerUserId) ?? null
              }
            ]
          }
        });
      }

      await tx
        .update(pets)
        .set({ selectedForEvent: false })
        .where(
          and(eq(pets.selectedForEvent, true), eq(pets.isScrapped, false), eq(pets.status, 'active'))
        );

      await tx
        .update(gameEvents)
        .set({
          resultJson: {
            winners: selectedPets.map((pet, index) => ({
              petId: pet.id,
              userId: pet.ownerUserId,
              placement: placements[index]!.placement,
              pointsAwarded: placements[index]!.pointsAwarded,
              selectedEquipmentSet:
                selectedEquipmentSetByUserId.get(pet.ownerUserId) ?? null
            }))
          }
        })
        .where(eq(gameEvents.id, createdEvent.id));

      await tx.insert(adminActionLogs).values({
        actorUserId: identity.userId,
        actionType: 'start_battle_event',
        requestId,
        payload: { gameEventId: createdEvent.id }
      });

      return { kind: 'ok' as const, gameEventId: createdEvent.id };
    });

    if (result.kind === 'not_enough_pets') {
      return reply
        .code(400)
        .send({
          message: `At least 3 selected pets are required. Found: ${result.selectedCount}`
        });
    }

    return { status: 'ok', idempotent: false, gameEventId: result.gameEventId };
  });

  app.get('/api/admin/events', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const events = await db
      .select()
      .from(gameEvents)
      .where(eq(gameEvents.eventType, 'battle'))
      .orderBy(desc(gameEvents.startedAt))
      .limit(25);
    return { events };
  });

  app.post('/api/admin/events/:eventId/revert', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });
    const eventId = (request.params as { eventId: string }).eventId;
    const body = (request.body ?? {}) as { requestId?: string };
    if (!body.requestId)
      return reply.code(400).send({ message: 'requestId is required' });
    const requestId = body.requestId;

    const duplicate = await db
      .select({ id: adminActionLogs.id })
      .from(adminActionLogs)
      .where(eq(adminActionLogs.requestId, body.requestId))
      .limit(1);
    if (duplicate.length > 0)
      return reply.code(200).send({ status: 'ok', idempotent: true });

    await db.transaction(async (tx) => {
      const [eventRow] = await tx
        .select()
        .from(gameEvents)
        .where(eq(gameEvents.id, eventId))
        .limit(1);
      if (!eventRow) throw new Error('Game event not found');
      if (eventRow.eventType !== 'battle')
        throw new Error('Only battle events are reversible');
      if (eventRow.status === 'reverted')
        throw new Error('Game event already reverted');

      const participantRows = await tx
        .select()
        .from(gameEventParticipants)
        .where(eq(gameEventParticipants.gameEventId, eventId));
      if (participantRows.length === 0)
        throw new Error('No participants found for game event');

      for (const participant of participantRows) {
        await tx
          .insert(leaderboardScores)
          .values({
            userId: participant.userId,
            leaderboardType: 'battle_points',
            score: 0
          })
          .onConflictDoNothing();

        await tx
          .update(leaderboardScores)
          .set({
            score: sql`GREATEST(${leaderboardScores.score} - ${participant.pointsAwarded}, 0)`,
            updatedAt: sql`now()`
          })
          .where(
            and(
              eq(leaderboardScores.userId, participant.userId),
              eq(leaderboardScores.leaderboardType, 'battle_points')
            )
          );

        await tx.insert(economyLedger).values({
          userId: participant.userId,
          actorUserId: identity.userId,
          eventType: 'admin_revert_battle_points_award',
          sourceType: 'admin_revert',
          sourceId: eventId,
          delta: {
            leaderboard: [
              {
                leaderboardType: 'battle_points',
                pointsDelta: -Math.abs(participant.pointsAwarded),
                placement: participant.placement,
                petId: participant.petId
              }
            ]
          }
        });
      }

      await tx
        .update(gameEvents)
        .set({
          status: 'reverted',
          revertedAt: new Date()
        })
        .where(eq(gameEvents.id, eventId));

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
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const state = await getCurrentStreamState();
    return {
      state: { ...state, manualOverride: getManualStreamStateOverride() }
    };
  });

  app.post('/api/admin/stream-state/override', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });

    const body = (request.body ?? {}) as {
      mode?: 'live' | 'offline' | 'auto';
      requestId?: string;
    };
    const requestId = body.requestId?.trim() || randomUUID();
    if (!body.mode || !['live', 'offline', 'auto'].includes(body.mode))
      return reply.code(400).send({ message: 'Invalid mode' });

    const duplicate = await db
      .select({ id: adminActionLogs.id })
      .from(adminActionLogs)
      .where(eq(adminActionLogs.requestId, requestId))
      .limit(1);
    if (duplicate.length > 0)
      return reply.code(200).send({ status: 'ok', idempotent: true });

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
    if (!identity || !hasAdminAccess(identity.roles))
      return reply.code(403).send({ message: 'Forbidden' });
    const ledgerId = (request.params as { ledgerId: string }).ledgerId;
    const body = (request.body ?? {}) as { requestId?: string };
    if (!body.requestId)
      return reply.code(400).send({ message: 'requestId is required' });
    const requestId = body.requestId;
    const duplicate = await db
      .select({ id: adminActionLogs.id })
      .from(adminActionLogs)
      .where(eq(adminActionLogs.requestId, requestId))
      .limit(1);
    if (duplicate.length > 0)
      return reply.code(200).send({ status: 'ok', idempotent: true });

    const revertResult = await db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(economyLedger)
        .where(eq(economyLedger.id, ledgerId))
        .limit(1);
      if (!entry) throw new Error('Ledger entry not found');
      if (entry.isReverted) throw new Error('Ledger entry already reverted');
      if (entry.eventType === 'duplicate_pet_training') {
        const delta = entry.delta as TrainingLedgerDelta;
        if (!entry.userId) throw new Error('Invalid training ledger entry');

        const laterTrainingRows = await tx
          .select({ id: economyLedger.id })
          .from(economyLedger)
          .where(
            and(
              eq(economyLedger.eventType, 'duplicate_pet_training'),
              eq(economyLedger.isReverted, false),
              sql`${economyLedger.createdAt} > ${entry.createdAt}`,
              sql`${economyLedger.delta}->>'target_pet_id' = ${delta.target_pet_id}`
            )
          )
          .limit(1);
        if (laterTrainingRows.length > 0) {
          return {
            kind: 'blocked' as const,
            message:
              'Cannot revert this training because later training events depend on the target pet state. Revert newer training first.'
          };
        }

        const consumedSlotRows = delta.consumed_pet_previous_slots ?? [];
        const slotsToRestore = consumedSlotRows.filter((slot) => slot.slotIndex !== null);
        if (slotsToRestore.length > 0) {
          const occupiedSlots = await tx
            .select({ id: pets.id, slotIndex: pets.slotIndex })
            .from(pets)
            .where(
              and(
                eq(pets.ownerUserId, entry.userId),
                eq(pets.status, 'active'),
                eq(pets.isScrapped, false),
                inArray(
                  pets.slotIndex,
                  slotsToRestore.map((slot) => slot.slotIndex as number)
                )
              )
            );
          const consumedIds = new Set(delta.consumed_pet_ids);
          const blockingSlot = occupiedSlots.find((pet) => !consumedIds.has(pet.id));
          if (blockingSlot) {
            return {
              kind: 'blocked' as const,
              message: `Cannot safely restore consumed pets because inventory slot ${blockingSlot.slotIndex} is occupied.`
            };
          }
        }

        const [targetPet] = await tx
          .select({
            id: pets.id,
            trainingPoints: pets.trainingPoints,
            classMainStat: petClasses.mainStat,
            classSecondaryStatOne: petClasses.secondaryStatOne,
            classSecondaryStatTwo: petClasses.secondaryStatTwo
          })
          .from(pets)
          .innerJoin(petClasses, eq(pets.classId, petClasses.id))
          .where(and(eq(pets.id, delta.target_pet_id), eq(pets.ownerUserId, entry.userId)))
          .limit(1);
        if (!targetPet) throw new Error('Training target pet not found');

        const restoredTrainingPoints = Math.max(
          0,
          targetPet.trainingPoints - delta.training_points_awarded
        );
        const restoredLevel = levelForTrainingPoints(
          restoredTrainingPoints,
          config.PET_TRAINING_MAX_LEVEL
        );
        const restoredBonus = calculateLevelStatBonus(restoredLevel, {
          mainStat: normalizePetStat(targetPet.classMainStat),
          secondaryStatOne: normalizePetStat(targetPet.classSecondaryStatOne),
          secondaryStatTwo: normalizePetStat(targetPet.classSecondaryStatTwo)
        });

        await tx
          .update(pets)
          .set({
            trainingPoints: restoredTrainingPoints,
            experience: restoredTrainingPoints,
            level: restoredLevel,
            ...petStatsToBonusColumns(restoredBonus)
          })
          .where(eq(pets.id, delta.target_pet_id));

        for (const consumedPetId of delta.consumed_pet_ids) {
          const previousSlot = consumedSlotRows.find((slot) => slot.id === consumedPetId)?.slotIndex ?? null;
          await tx
            .update(pets)
            .set({
              status: 'active',
              consumedByPetId: null,
              consumedAt: null,
              slotIndex: previousSlot
            })
            .where(
              and(
                eq(pets.id, consumedPetId),
                eq(pets.ownerUserId, entry.userId),
                eq(pets.status, 'consumed'),
                eq(pets.consumedByPetId, delta.target_pet_id)
              )
            );
        }

        await tx.insert(economyLedger).values({
          userId: entry.userId,
          actorUserId: identity.userId,
          eventType: 'admin_revert_duplicate_pet_training',
          sourceType: 'admin_revert',
          sourceId: entry.id,
          delta: {
            target_pet_id: delta.target_pet_id,
            restored_consumed_pet_ids: delta.consumed_pet_ids,
            training_points_removed: delta.training_points_awarded,
            target_level_after_revert: restoredLevel,
            stat_bonus_after_revert: restoredBonus
          },
          revertsLedgerId: entry.id
        });
        await tx
          .update(economyLedger)
          .set({ isReverted: true })
          .where(eq(economyLedger.id, entry.id));
        await tx.insert(adminActionLogs).values({
          actorUserId: identity.userId,
          targetUserId: entry.userId,
          actionType: 'revert_duplicate_pet_training',
          requestId,
          payload: { ledgerId }
        });
        return { kind: 'ok' as const };
      }

      if (entry.eventType !== 'admin_test_mystery_egg_grant')
        throw new Error(
          'Only reversible admin test grant and duplicate pet training events are supported'
        );
      const delta = entry.delta as {
        mysteryEggInventory?: Array<{ eggTypeId: string; amountDelta: number }>;
      };
      const firstDelta = delta.mysteryEggInventory?.[0];
      if (!firstDelta || !entry.userId) throw new Error('Invalid ledger delta');
      await tx
        .insert(mysteryEggInventory)
        .values({
          userId: entry.userId,
          eggTypeId: firstDelta.eggTypeId,
          amount: 0
        })
        .onConflictDoNothing();
      await tx
        .update(mysteryEggInventory)
        .set({
          amount: sql`GREATEST(${mysteryEggInventory.amount} - ${firstDelta.amountDelta}, 0)`,
          updatedAt: sql`now()`
        })
        .where(
          and(
            eq(mysteryEggInventory.userId, entry.userId),
            eq(mysteryEggInventory.eggTypeId, firstDelta.eggTypeId)
          )
        );

      await tx.insert(economyLedger).values({
        userId: entry.userId,
        actorUserId: identity.userId,
        eventType: 'admin_revert_test_mystery_egg_grant',
        sourceType: 'admin_revert',
        sourceId: entry.id,
        delta: {
          mysteryEggInventory: [
            {
              eggTypeId: firstDelta.eggTypeId,
              amountDelta: -Math.abs(firstDelta.amountDelta)
            }
          ]
        },
        revertsLedgerId: entry.id
      });
      await tx
        .update(economyLedger)
        .set({ isReverted: true })
        .where(eq(economyLedger.id, entry.id));
      await tx.insert(adminActionLogs).values({
        actorUserId: identity.userId,
        targetUserId: entry.userId,
        actionType: 'revert_ledger_entry',
        requestId,
        payload: { ledgerId }
      });
      return { kind: 'ok' as const };
    });
    if (revertResult.kind === 'blocked') {
      return reply.code(409).send({ message: revertResult.message });
    }
    return { status: 'ok', idempotent: false };
  });
}

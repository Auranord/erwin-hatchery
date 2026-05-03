import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { consumableInventory, economyLedger, eggLootTableEntries, unhatchedEggs, mysteryEggInventory, pets, resources, incubationJobs, incubatorSlots, eggTypes, petTypes, leaderboardScores, users, gameEvents } from '../db/schema.js';
import { getSessionIdentity } from './session-auth.js';
import { config } from '../config.js';

type PlayerInventory = {
  mysteryEggs: Array<{ eggTypeId: string; amount: number; updatedAt: string }>;
  unhatchedEggs: Array<{ id: string; eggTypeId: string; state: string }>;
  hatchedPets: Array<{
    id: string;
    petTypeId: string;
    petTypeDisplayName: string;
    rarity: string;
    role: string;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    selectedForEvent: boolean;
    createdAt: string;
  }>;
  consumables: Array<{ consumableTypeId: string; amount: number }>;
  crackedEggResources: Array<{ resourceType: string; amount: number; updatedAt: string }>;
  incubatorSlots: Array<{ id: string; slotSource: string; isAvailable: boolean; activeJob: { id: string; unhatchedEggId: string; state: string; startedAt: string; requiredProgressSeconds: number } | null }>;
};

function toIsoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

async function ensureDefaultIncubatorSlot(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [existingDefaultSlot] = await tx
      .select({ id: incubatorSlots.id })
      .from(incubatorSlots)
      .where(and(eq(incubatorSlots.ownerUserId, userId), eq(incubatorSlots.slotSource, 'default')))
      .limit(1);

    if (existingDefaultSlot) {
      return;
    }

    const [createdSlot] = await tx.insert(incubatorSlots).values({
      ownerUserId: userId,
      slotSource: 'default'
    }).returning({ id: incubatorSlots.id });

    if (!createdSlot) {
      throw new Error('Failed to create default incubator slot');
    }

    await tx.insert(economyLedger).values({
      userId,
      actorUserId: null,
      eventType: 'default_incubator_slot_granted',
      sourceType: 'system',
      sourceId: createdSlot.id,
      delta: { incubatorSlots: [{ id: createdSlot.id, change: 1, source: 'default' }] }
    });
  });
}


function pickWeightedOutcome<T extends { weight: number }>(entries: T[]): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) {
    throw new Error('Loot table total weight must be greater than zero');
  }

  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry;
    }
  }

  return entries[entries.length - 1] as T;
}

async function loadPlayerInventory(userId: string): Promise<PlayerInventory> {
  const [mysteryEggs, unhatchedEggRows, petRows, consumableRows, resourceRows, slotRows, jobRows] = await Promise.all([
    db.select({ eggTypeId: mysteryEggInventory.eggTypeId, amount: mysteryEggInventory.amount, updatedAt: mysteryEggInventory.updatedAt }).from(mysteryEggInventory).where(eq(mysteryEggInventory.userId, userId)),
    db
      .select({ id: unhatchedEggs.id, eggTypeId: unhatchedEggs.eggTypeId, state: unhatchedEggs.state })
      .from(unhatchedEggs)
      .where(
        and(
          eq(unhatchedEggs.ownerUserId, userId),
          inArray(unhatchedEggs.state, ['ready_for_incubation', 'incubating'])
        )
      ),
    db
      .select({
        id: pets.id,
        petTypeId: pets.petTypeId,
        petTypeDisplayName: petTypes.displayName,
        rarity: petTypes.rarity,
        role: petTypes.role,
        hp: pets.hp,
        attack: pets.attack,
        defense: pets.defense,
        speed: pets.speed,
        selectedForEvent: pets.selectedForEvent,
        createdAt: pets.createdAt
      })
      .from(pets)
      .innerJoin(petTypes, eq(pets.petTypeId, petTypes.id))
      .where(eq(pets.ownerUserId, userId)),
    db.select({ consumableTypeId: consumableInventory.consumableTypeId, amount: consumableInventory.amount }).from(consumableInventory).where(eq(consumableInventory.userId, userId)),
    db.select({ resourceType: resources.resourceType, amount: resources.amount, updatedAt: resources.updatedAt }).from(resources).where(eq(resources.userId, userId)),
    db.select({ id: incubatorSlots.id, slotSource: incubatorSlots.slotSource, isAvailable: incubatorSlots.isAvailable }).from(incubatorSlots).where(eq(incubatorSlots.ownerUserId, userId)),
    db.select({ id: incubationJobs.id, incubatorSlotId: incubationJobs.incubatorSlotId, unhatchedEggId: incubationJobs.unhatchedEggId, state: incubationJobs.state, startedAt: incubationJobs.startedAt, requiredProgressSeconds: incubationJobs.requiredProgressSeconds }).from(incubationJobs).where(and(eq(incubationJobs.ownerUserId, userId), eq(incubationJobs.state, 'running')))
  ]);
  const jobsBySlot = new Map(jobRows.map((job) => [job.incubatorSlotId, job]));

  return {
    mysteryEggs: mysteryEggs.map((row) => ({ ...row, updatedAt: toIsoTimestamp(row.updatedAt) })),
    unhatchedEggs: unhatchedEggRows,
    hatchedPets: petRows.map((row) => ({ ...row, createdAt: toIsoTimestamp(row.createdAt) })),
    consumables: consumableRows,
    crackedEggResources: resourceRows.map((row) => ({ ...row, updatedAt: toIsoTimestamp(row.updatedAt) })),
    incubatorSlots: slotRows.map((slot) => {
      const activeJob = jobsBySlot.get(slot.id);
      return {
        ...slot,
        activeJob: activeJob ? { id: activeJob.id, unhatchedEggId: activeJob.unhatchedEggId, state: activeJob.state, startedAt: toIsoTimestamp(activeJob.startedAt), requiredProgressSeconds: activeJob.requiredProgressSeconds } : null
      };
    })
  };
}

async function computeInventoryRevision(userId: string): Promise<string> {
  const [invMax, resourceMax, petMax, eggStats, jobStats] = await Promise.all([
    db.select({ updatedAt: sql<Date>`max(${mysteryEggInventory.updatedAt})` }).from(mysteryEggInventory).where(eq(mysteryEggInventory.userId, userId)),
    db.select({ updatedAt: sql<Date>`max(${resources.updatedAt})` }).from(resources).where(eq(resources.userId, userId)),
    db.select({ createdAt: sql<Date>`max(${pets.createdAt})` }).from(pets).where(eq(pets.ownerUserId, userId)),
    db
      .select({
        count: sql<number>`count(*)`,
        newestCreatedAt: sql<Date>`max(${unhatchedEggs.createdAt})`
      })
      .from(unhatchedEggs)
      .where(
        and(
          eq(unhatchedEggs.ownerUserId, userId),
          inArray(unhatchedEggs.state, ['ready_for_incubation', 'incubating'])
        )
      ),
    db
      .select({
        newestStartedAt: sql<Date>`max(${incubationJobs.startedAt})`,
        newestCompletedAt: sql<Date>`max(${incubationJobs.completedAt})`
      })
      .from(incubationJobs)
      .where(eq(incubationJobs.ownerUserId, userId))
  ]);

  const payload = [
    invMax[0]?.updatedAt ? toIsoTimestamp(invMax[0].updatedAt) : '0',
    resourceMax[0]?.updatedAt ? toIsoTimestamp(resourceMax[0].updatedAt) : '0',
    petMax[0]?.createdAt ? toIsoTimestamp(petMax[0].createdAt) : '0',
    eggStats[0]?.count ?? 0,
    eggStats[0]?.newestCreatedAt ? toIsoTimestamp(eggStats[0].newestCreatedAt) : '0',
    jobStats[0]?.newestStartedAt ? toIsoTimestamp(jobStats[0].newestStartedAt) : '0',
    jobStats[0]?.newestCompletedAt ? toIsoTimestamp(jobStats[0].newestCompletedAt) : '0'
  ].join('|');

  return createHash('sha1').update(payload).digest('hex');
}

export async function registerGameRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/events/overlay/alerts/stream', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.hijack();

    const sendEvent = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let lastSeen = new Date(Date.now() - 20_000);
    const intervalId = setInterval(async () => {
      try {
        const rows = await db.select({ id: economyLedger.id, userId: economyLedger.userId, delta: economyLedger.delta, createdAt: economyLedger.createdAt })
          .from(economyLedger)
          .where(and(eq(economyLedger.eventType, 'incubation_finished'), sql`${economyLedger.createdAt} > ${lastSeen}`))
          .orderBy(sql`${economyLedger.createdAt} asc`)
          .limit(25);

        for (const row of rows) {
          const hatchedPetId = (row.delta as { hatchedPets?: Array<{ id?: string | null }> } | null)?.hatchedPets?.[0]?.id;
          if (!hatchedPetId || !row.userId) continue;
          const [details] = await db.select({ displayName: users.displayName, login: users.twitchLogin, petName: petTypes.displayName })
            .from(pets)
            .innerJoin(users, eq(pets.ownerUserId, users.id))
            .innerJoin(petTypes, eq(pets.petTypeId, petTypes.id))
            .where(eq(pets.id, hatchedPetId))
            .limit(1);
          if (!details) continue;
          sendEvent('hatch_alert', { userName: details.displayName ?? details.login ?? 'Unbekannt', petName: details.petName, createdAt: row.createdAt });
          lastSeen = row.createdAt;
        }
        sendEvent('heartbeat', { t: Date.now() });
      } catch (error) {
        request.log.error({ err: error }, 'alerts overlay stream update failed');
      }
    }, 2000);

    request.raw.on('close', () => {
      clearInterval(intervalId);
      reply.raw.end();
    });
  });

  app.get('/api/events/overlay/battle', async () => {
    const [eventRow] = await db.select({ id: gameEvents.id, resolvedAt: gameEvents.resolvedAt, resultJson: gameEvents.resultJson })
      .from(gameEvents)
      .where(and(eq(gameEvents.eventType, 'battle'), eq(gameEvents.status, 'resolved')))
      .orderBy(sql`coalesce(${gameEvents.resolvedAt}, ${gameEvents.startedAt}) desc`)
      .limit(1);
    if (!eventRow) return { winners: [] };
    const winners = ((eventRow.resultJson as { winners?: Array<{ userId: string; petId: string; placement: number; pointsAwarded: number }> } | null)?.winners ?? []);
    const winnersWithNames = await Promise.all(winners.map(async (winner) => {
      const [details] = await db.select({ displayName: users.displayName, login: users.twitchLogin, petName: petTypes.displayName })
        .from(pets)
        .innerJoin(users, eq(pets.ownerUserId, users.id))
        .innerJoin(petTypes, eq(pets.petTypeId, petTypes.id))
        .where(eq(pets.id, winner.petId))
        .limit(1);
      return { ...winner, userName: details?.displayName ?? details?.login ?? 'Unbekannt', petName: details?.petName ?? 'Unbekannt' };
    }));
    return { resolvedAt: eventRow.resolvedAt, winners: winnersWithNames.sort((a, b) => a.placement - b.placement) };
  });

  app.get('/api/game/leaderboard', async () => {
    const rows = await db
      .select({
        userId: leaderboardScores.userId,
        displayName: users.displayName,
        login: users.twitchLogin,
        score: leaderboardScores.score
      })
      .from(leaderboardScores)
      .innerJoin(users, eq(leaderboardScores.userId, users.id))
      .where(and(eq(leaderboardScores.leaderboardType, 'battle_points'), eq(users.isDeleted, false)))
      .orderBy(sql`${leaderboardScores.score} desc`, sql`coalesce(${users.displayName}, ${users.twitchLogin}, ${users.twitchUserId}) asc`)
      .limit(10);

    return {
      leaderboardType: 'battle_points',
      entries: rows.map((row, index) => ({
        rank: index + 1,
        userId: row.userId,
        displayName: row.displayName,
        login: row.login,
        score: row.score
      }))
    };
  });

  app.get('/api/game/inventory', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    await ensureDefaultIncubatorSlot(identity.userId);
    const revision = await computeInventoryRevision(identity.userId);
    const inventory = await loadPlayerInventory(identity.userId);
    return { revision, inventory };
  });



  app.post('/api/game/pets/:petId/selection', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });

    const { petId } = request.params as { petId: string };
    const body = (request.body ?? {}) as { selectedForEvent?: boolean };
    if (typeof body.selectedForEvent !== 'boolean') {
      return reply.code(400).send({ message: 'selectedForEvent must be a boolean' });
    }

    const result = await db.transaction(async (tx) => {
      const [ownedPet] = await tx
        .select({ id: pets.id })
        .from(pets)
        .where(and(eq(pets.id, petId), eq(pets.ownerUserId, identity.userId)))
        .limit(1);

      if (!ownedPet) {
        return { kind: 'not_found' as const };
      }

      if (body.selectedForEvent) {
        await tx
          .update(pets)
          .set({ selectedForEvent: false })
          .where(and(eq(pets.ownerUserId, identity.userId), eq(pets.selectedForEvent, true)));
      }

      const [updatedPet] = await tx
        .update(pets)
        .set({ selectedForEvent: body.selectedForEvent })
        .where(eq(pets.id, ownedPet.id))
        .returning({ id: pets.id, selectedForEvent: pets.selectedForEvent });

      if (!updatedPet) {
        throw new Error('Failed to update pet selection');
      }

      return { kind: 'ok' as const, pet: updatedPet };
    });

    if (result.kind === 'not_found') return reply.code(404).send({ message: 'Pet not found' });
    return { status: 'ok', petId: result.pet.id, selectedForEvent: result.pet.selectedForEvent };
  });

  app.post('/api/game/mystery-eggs/identify', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    await ensureDefaultIncubatorSlot(identity.userId);

    const body = (request.body ?? {}) as { eggTypeId?: string };
    const eggTypeId = body.eggTypeId;
    if (!eggTypeId) {
      return reply.code(400).send({ message: 'eggTypeId is required' });
    }

    const result = await db.transaction(async (tx) => {
      const [inventoryRow] = await tx
        .select({ amount: mysteryEggInventory.amount })
        .from(mysteryEggInventory)
        .where(and(eq(mysteryEggInventory.userId, identity.userId), eq(mysteryEggInventory.eggTypeId, eggTypeId)))
        .limit(1);

      if (!inventoryRow || inventoryRow.amount < 1) {
        return { kind: 'none' as const };
      }

      const entries = await tx
        .select({
          outcomeType: eggLootTableEntries.outcomeType,
          petTypeId: eggLootTableEntries.petTypeId,
          resourceType: eggLootTableEntries.resourceType,
          resourceAmount: eggLootTableEntries.resourceAmount,
          weight: eggLootTableEntries.weight
        })
        .from(eggLootTableEntries)
        .where(and(eq(eggLootTableEntries.eggTypeId, eggTypeId), sql`${eggLootTableEntries.weight} > 0`));

      if (entries.length === 0) {
        throw new Error(`No loot table entries for egg type ${eggTypeId}`);
      }

      const picked = pickWeightedOutcome(entries);

      await tx
        .update(mysteryEggInventory)
        .set({ amount: sql`greatest(${mysteryEggInventory.amount} - 1, 0)`, updatedAt: new Date() })
        .where(and(eq(mysteryEggInventory.userId, identity.userId), eq(mysteryEggInventory.eggTypeId, eggTypeId)));

      if (picked.outcomeType === 'pet' && picked.petTypeId) {
        const [egg] = await tx.insert(unhatchedEggs).values({
          ownerUserId: identity.userId,
          eggTypeId: eggTypeId,
          hiddenPetTypeId: picked.petTypeId,
          state: 'ready_for_incubation'
        }).returning({ id: unhatchedEggs.id });

        await tx.insert(economyLedger).values({
          userId: identity.userId,
          actorUserId: identity.userId,
          eventType: 'mystery_egg_identified_to_unhatched_egg',
          sourceType: 'player_action',
          sourceId: egg?.id ?? null,
          delta: { mysteryEggInventory: [{ eggTypeId: eggTypeId, amountDelta: -1 }], unhatchedEggs: [{ eggTypeId: eggTypeId, amountDelta: 1 }] }
        });

        return { kind: 'unhatched_egg' as const };
      }

      const resourceAmount = picked.resourceAmount ?? 0;
      if (!picked.resourceType || resourceAmount <= 0) {
        throw new Error(`Loot table entry for ${eggTypeId} is invalid`);
      }

      const effectiveResourceAmount = Math.max(1, Math.floor(resourceAmount * config.DEBUG_EGG_RESOURCE_MULTIPLIER));

      await tx.insert(resources).values({
        userId: identity.userId,
        resourceType: picked.resourceType,
        amount: effectiveResourceAmount,
        updatedAt: new Date()
      }).onConflictDoUpdate({
        target: [resources.userId, resources.resourceType],
        set: { amount: sql`${resources.amount} + ${effectiveResourceAmount}`, updatedAt: new Date() }
      });

      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'mystery_egg_identified_to_egg_resources',
        sourceType: 'player_action',
        delta: {
          mysteryEggInventory: [{ eggTypeId: eggTypeId, amountDelta: -1 }],
          resources: [{ resourceType: picked.resourceType, amountDelta: effectiveResourceAmount }]
        }
      });

      return { kind: 'resources' as const };
    });

    if (result.kind === 'none') {
      return reply.code(409).send({ message: 'No mystery egg of this type available' });
    }

    return { ok: true, result: result.kind };
  });

  app.post('/api/game/incubation/start', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    await ensureDefaultIncubatorSlot(identity.userId);
    const body = (request.body ?? {}) as { unhatchedEggId?: string; incubatorSlotId?: string };
    if (!body.unhatchedEggId || !body.incubatorSlotId) {
      return reply.code(400).send({ message: 'unhatchedEggId and incubatorSlotId are required' });
    }

    const result = await db.transaction(async (tx) => {
      const [slot] = await tx.select().from(incubatorSlots).where(and(eq(incubatorSlots.id, body.incubatorSlotId!), eq(incubatorSlots.ownerUserId, identity.userId), eq(incubatorSlots.isAvailable, true))).limit(1);
      if (!slot) return { kind: 'slot_missing' as const };
      const [job] = await tx.select({ id: incubationJobs.id }).from(incubationJobs).where(and(eq(incubationJobs.incubatorSlotId, slot.id), eq(incubationJobs.state, 'running'))).limit(1);
      if (job) return { kind: 'slot_busy' as const };
      const [egg] = await tx.select({ id: unhatchedEggs.id, eggTypeId: unhatchedEggs.eggTypeId, state: unhatchedEggs.state }).from(unhatchedEggs).where(and(eq(unhatchedEggs.id, body.unhatchedEggId!), eq(unhatchedEggs.ownerUserId, identity.userId))).limit(1);
      if (!egg || egg.state !== 'ready_for_incubation') return { kind: 'egg_missing' as const };
      const [eggType] = await tx.select({ baseIncubationSeconds: eggTypes.baseIncubationSeconds }).from(eggTypes).where(eq(eggTypes.id, egg.eggTypeId)).limit(1);
      if (!eggType) return { kind: 'egg_type_missing' as const };

      const debugShortenerDivisor = 1 / config.DEBUG_INCUBATION_TIME_FACTOR;
      const debugAdjustedIncubationSeconds = Math.max(1, Math.ceil(eggType.baseIncubationSeconds / debugShortenerDivisor));

      const [created] = await tx.insert(incubationJobs).values({ ownerUserId: identity.userId, unhatchedEggId: egg.id, incubatorSlotId: slot.id, state: 'running', requiredProgressSeconds: debugAdjustedIncubationSeconds, progressSnapshot: { mode: 'timestamp_only' } }).returning({ id: incubationJobs.id });
      if (!created) {
        throw new Error('Failed to create incubation job');
      }
      await tx.update(unhatchedEggs).set({ state: 'incubating' }).where(eq(unhatchedEggs.id, egg.id));
      await tx.insert(economyLedger).values({ userId: identity.userId, actorUserId: identity.userId, eventType: 'incubation_started', sourceType: 'player_action', sourceId: created.id, delta: { incubationJobs: [{ id: created.id, unhatchedEggId: egg.id, incubatorSlotId: slot.id }] } });
      return { kind: 'ok' as const };
    });

    if (result.kind !== 'ok') {
      return reply.code(409).send({ message: result.kind });
    }
    return { ok: true };
  });

  app.post('/api/game/incubation/finish', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    await ensureDefaultIncubatorSlot(identity.userId);
    const body = (request.body ?? {}) as { unhatchedEggId?: string };
    if (!body.unhatchedEggId) {
      return reply.code(400).send({ message: 'unhatchedEggId is required' });
    }

    const result = await db.transaction(async (tx) => {
      const [egg] = await tx
        .select({ id: unhatchedEggs.id, hiddenPetTypeId: unhatchedEggs.hiddenPetTypeId, state: unhatchedEggs.state })
        .from(unhatchedEggs)
        .where(and(eq(unhatchedEggs.id, body.unhatchedEggId!), eq(unhatchedEggs.ownerUserId, identity.userId)))
        .limit(1);
      if (!egg || egg.state !== 'incubating') return { kind: 'egg_missing' as const };

      const [job] = await tx
        .select({
          id: incubationJobs.id,
          incubatorSlotId: incubationJobs.incubatorSlotId,
          startedAt: incubationJobs.startedAt,
          requiredProgressSeconds: incubationJobs.requiredProgressSeconds
        })
        .from(incubationJobs)
        .where(
          and(
            eq(incubationJobs.ownerUserId, identity.userId),
            eq(incubationJobs.unhatchedEggId, egg.id),
            eq(incubationJobs.state, 'running')
          )
        )
        .limit(1);
      if (!job) return { kind: 'job_missing' as const };

      const hatchAtMs = new Date(job.startedAt).getTime() + (job.requiredProgressSeconds * 1000);
      if (Date.now() < hatchAtMs) return { kind: 'too_early' as const };

      const [petType] = await tx
        .select({
          id: petTypes.id,
          baseHp: petTypes.baseHp,
          baseAttack: petTypes.baseAttack,
          baseDefense: petTypes.baseDefense,
          baseSpeed: petTypes.baseSpeed
        })
        .from(petTypes)
        .where(eq(petTypes.id, egg.hiddenPetTypeId))
        .limit(1);
      if (!petType) return { kind: 'pet_type_missing' as const };

      const [newPet] = await tx.insert(pets).values({
        ownerUserId: identity.userId,
        petTypeId: petType.id,
        hp: petType.baseHp,
        attack: petType.baseAttack,
        defense: petType.baseDefense,
        speed: petType.baseSpeed,
        statRolls: { hp: 0, attack: 0, defense: 0, speed: 0 },
        sourceUnhatchedEggId: egg.id
      }).returning({ id: pets.id });

      await tx.update(incubationJobs).set({ state: 'completed', completedAt: new Date() }).where(eq(incubationJobs.id, job.id));
      await tx.update(unhatchedEggs).set({ state: 'hatched' }).where(eq(unhatchedEggs.id, egg.id));
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'incubation_finished',
        sourceType: 'player_action',
        sourceId: job.id,
        delta: { hatchedPets: [{ id: newPet?.id ?? null, petTypeId: petType.id }], unhatchedEggs: [{ id: egg.id, change: -1 }] }
      });

      return { kind: 'ok' as const };
    });

    if (result.kind !== 'ok') {
      return reply.code(409).send({ message: result.kind });
    }
    return { ok: true };
  });

  app.get('/api/game/inventory/stream', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    await ensureDefaultIncubatorSlot(identity.userId);

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.hijack();

    const sendEvent = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let currentRevision = await computeInventoryRevision(identity.userId);
    sendEvent('inventory', { revision: currentRevision, inventory: await loadPlayerInventory(identity.userId) });

    const intervalId = setInterval(async () => {
      try {
        const nextRevision = await computeInventoryRevision(identity.userId);
        if (nextRevision === currentRevision) {
          sendEvent('heartbeat', { t: Date.now() });
          return;
        }
        currentRevision = nextRevision;
        sendEvent('inventory', { revision: currentRevision, inventory: await loadPlayerInventory(identity.userId) });
      } catch (error) {
        request.log.error({ err: error }, 'inventory stream update failed');
      }
    }, 4000);

    request.raw.on('close', () => {
      clearInterval(intervalId);
      reply.raw.end();
    });
  });
}

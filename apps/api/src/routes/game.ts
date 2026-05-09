import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, inArray, not, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { consumableItemStacks, economyLedger, eggLootTableEntries, unhatchedEggs, inventoryDimensions, mysteryEggInventory, pets, resources, incubationJobs, incubatorSlots, eggTypes, petTypes, leaderboardScores, users, gameEvents } from '../db/schema.js';
import { getSessionIdentity } from './session-auth.js';
import { config } from '../config.js';
import { computeIncubationMultiplier, getCurrentStreamState } from '../services/streamState.js';
import { DEFAULT_INVENTORY_GRIDS, getStackLimit, isSlotInsideGrid, type InventoryGridDimensions, type InventoryKind, type PlayerInventoryPayload, type SlottedInventoryCell } from '@erwin/shared';

function getOverlayToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  const bearerToken = typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : undefined;
  const headerToken = typeof request.headers['x-overlay-secret'] === 'string' ? request.headers['x-overlay-secret'] : undefined;
  const queryTokenValue = (request.query as { token?: unknown } | undefined)?.token;
  const queryToken = typeof queryTokenValue === 'string' ? queryTokenValue : undefined;
  return bearerToken ?? headerToken ?? queryToken;
}

function ensureOverlayAccess(request: FastifyRequest): boolean {
  return verifyOverlayAccess(getOverlayToken(request));
}

function verifyOverlayAccess(rawToken: string | undefined): boolean {
  const expectedSecret = config.OVERLAY_SECRET;
  if (!expectedSecret) return false;
  return rawToken === expectedSecret;
}

type PlayerInventory = PlayerInventoryPayload;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toIsoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function dimensionsFromRow(kind: InventoryKind, row?: { columns: number; baseRows: number; bonusRows: number; upgradeRef: string | null } | null): InventoryGridDimensions {
  const defaults = DEFAULT_INVENTORY_GRIDS[kind];
  const columns = row?.columns ?? defaults.columns;
  const baseRows = row?.baseRows ?? defaults.baseRows;
  const bonusRows = row?.bonusRows ?? defaults.bonusRows;
  const rows = baseRows + bonusRows;
  return { kind, columns, rows, baseRows, bonusRows, capacity: columns * rows, upgradeRef: row?.upgradeRef ?? defaults.upgradeRef };
}

function cellsForGrid<T>(dimensions: InventoryGridDimensions, items: Array<{ slotIndex: number | null; item: T }>): Array<SlottedInventoryCell<T>> {
  const bySlot = new Map<number, T>();
  for (const entry of items) {
    if (entry.slotIndex !== null && isSlotInsideGrid(entry.slotIndex, dimensions)) {
      bySlot.set(entry.slotIndex, entry.item);
    }
  }
  return Array.from({ length: dimensions.capacity }, (_, slotIndex) => ({ slotIndex, item: bySlot.get(slotIndex) ?? null }));
}

async function ensureInventoryDimensions(userId: string): Promise<void> {
  await db.transaction(async (tx) => ensureInventoryDimensionsInTx(tx, userId));
}

async function ensureInventoryDimensionsInTx(tx: DbTransaction, userId: string): Promise<void> {
  const kinds = Object.keys(DEFAULT_INVENTORY_GRIDS) as InventoryKind[];
  for (const kind of kinds) {
    const defaults = DEFAULT_INVENTORY_GRIDS[kind];
    await tx.insert(inventoryDimensions).values({
      userId,
      inventoryKind: kind,
      columns: defaults.columns,
      baseRows: defaults.baseRows,
      bonusRows: defaults.bonusRows,
      upgradeRef: defaults.upgradeRef
    }).onConflictDoNothing({ target: [inventoryDimensions.userId, inventoryDimensions.inventoryKind] });
  }
}

async function getDimensionsInTx(tx: DbTransaction, userId: string, kind: InventoryKind): Promise<InventoryGridDimensions> {
  await ensureInventoryDimensionsInTx(tx, userId);
  const [row] = await tx.select({ columns: inventoryDimensions.columns, baseRows: inventoryDimensions.baseRows, bonusRows: inventoryDimensions.bonusRows, upgradeRef: inventoryDimensions.upgradeRef })
    .from(inventoryDimensions)
    .where(and(eq(inventoryDimensions.userId, userId), eq(inventoryDimensions.inventoryKind, kind)))
    .limit(1);
  return dimensionsFromRow(kind, row ?? null);
}

async function findFreeEggSlotInTx(tx: DbTransaction, userId: string): Promise<number | null> {
  const dimensions = await getDimensionsInTx(tx, userId, 'unhatched_eggs');
  const occupiedRows = await tx.select({ slotIndex: unhatchedEggs.slotIndex }).from(unhatchedEggs).where(and(eq(unhatchedEggs.ownerUserId, userId), eq(unhatchedEggs.state, 'ready_for_incubation')));
  const occupied = new Set(occupiedRows.map((row) => row.slotIndex).filter((slotIndex): slotIndex is number => slotIndex !== null));
  for (let slotIndex = 0; slotIndex < dimensions.capacity; slotIndex += 1) {
    if (!occupied.has(slotIndex)) return slotIndex;
  }
  return null;
}

async function findFreePetSlotInTx(tx: DbTransaction, userId: string): Promise<number | null> {
  const dimensions = await getDimensionsInTx(tx, userId, 'pets');
  const occupiedRows = await tx.select({ slotIndex: pets.slotIndex }).from(pets).where(eq(pets.ownerUserId, userId));
  const occupied = new Set(occupiedRows.map((row) => row.slotIndex).filter((slotIndex): slotIndex is number => slotIndex !== null));
  for (let slotIndex = 0; slotIndex < dimensions.capacity; slotIndex += 1) {
    if (!occupied.has(slotIndex)) return slotIndex;
  }
  return null;
}

async function ensureDefaultIncubatorSlot(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await ensureInventoryDimensionsInTx(tx, userId);
    const incubatorDimensions = await getDimensionsInTx(tx, userId, 'incubators');
    const [existingDefaultSlot] = await tx
      .select({ id: incubatorSlots.id })
      .from(incubatorSlots)
      .where(and(eq(incubatorSlots.ownerUserId, userId), eq(incubatorSlots.slotSource, 'default')))
      .limit(1);

    if (existingDefaultSlot) {
      return;
    }

    const occupiedRows = await tx.select({ slotIndex: incubatorSlots.slotIndex }).from(incubatorSlots).where(eq(incubatorSlots.ownerUserId, userId));
    const occupied = new Set(occupiedRows.map((row) => row.slotIndex).filter((slotIndex): slotIndex is number => slotIndex !== null));
    let slotIndex = 0;
    while (occupied.has(slotIndex)) slotIndex += 1;
    if (slotIndex >= incubatorDimensions.capacity) {
      await tx.update(inventoryDimensions).set({ baseRows: Math.ceil((slotIndex + 1) / incubatorDimensions.columns), updatedAt: new Date() }).where(and(eq(inventoryDimensions.userId, userId), eq(inventoryDimensions.inventoryKind, 'incubators')));
    }

    const [createdSlot] = await tx.insert(incubatorSlots).values({
      ownerUserId: userId,
      slotSource: 'default',
      slotIndex
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
      delta: { incubatorSlots: [{ id: createdSlot.id, change: 1, source: 'default', slotIndex }] }
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
  await ensureInventoryDimensions(userId);
  const [dimensionRows, mysteryEggs, unhatchedEggRows, petRows, consumableRows, resourceRows, slotRows, jobRows] = await Promise.all([
    db.select({ inventoryKind: inventoryDimensions.inventoryKind, columns: inventoryDimensions.columns, baseRows: inventoryDimensions.baseRows, bonusRows: inventoryDimensions.bonusRows, upgradeRef: inventoryDimensions.upgradeRef }).from(inventoryDimensions).where(eq(inventoryDimensions.userId, userId)),
    db.select({ eggTypeId: mysteryEggInventory.eggTypeId, amount: mysteryEggInventory.amount, updatedAt: mysteryEggInventory.updatedAt }).from(mysteryEggInventory).where(eq(mysteryEggInventory.userId, userId)),
    db
      .select({ id: unhatchedEggs.id, eggTypeId: unhatchedEggs.eggTypeId, state: unhatchedEggs.state, slotIndex: unhatchedEggs.slotIndex })
      .from(unhatchedEggs)
      .where(and(eq(unhatchedEggs.ownerUserId, userId), eq(unhatchedEggs.state, 'ready_for_incubation'))),
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
        createdAt: pets.createdAt,
        slotIndex: pets.slotIndex
      })
      .from(pets)
      .innerJoin(petTypes, eq(pets.petTypeId, petTypes.id))
      .where(eq(pets.ownerUserId, userId)),
    db.select({ id: consumableItemStacks.id, consumableTypeId: consumableItemStacks.consumableTypeId, amount: consumableItemStacks.amount, slotIndex: consumableItemStacks.slotIndex }).from(consumableItemStacks).where(eq(consumableItemStacks.userId, userId)),
    db.select({ resourceType: resources.resourceType, amount: resources.amount, updatedAt: resources.updatedAt }).from(resources).where(eq(resources.userId, userId)),
    db.select({ id: incubatorSlots.id, slotSource: incubatorSlots.slotSource, slotLevel: incubatorSlots.slotLevel, slotIndex: incubatorSlots.slotIndex, isAvailable: incubatorSlots.isAvailable, speedMultiplierBasisPoints: incubatorSlots.speedMultiplierBasisPoints, rarityBonusBasisPoints: incubatorSlots.rarityBonusBasisPoints, fuelBehavior: incubatorSlots.fuelBehavior, specialEffectConfig: incubatorSlots.specialEffectConfig }).from(incubatorSlots).where(eq(incubatorSlots.ownerUserId, userId)),
    db.select({ id: incubationJobs.id, incubatorSlotId: incubationJobs.incubatorSlotId, unhatchedEggId: incubationJobs.unhatchedEggId, state: incubationJobs.state, startedAt: incubationJobs.startedAt, requiredProgressSeconds: incubationJobs.requiredProgressSeconds, progressSnapshot: incubationJobs.progressSnapshot }).from(incubationJobs).where(and(eq(incubationJobs.ownerUserId, userId), eq(incubationJobs.state, 'running')))
  ]);
  const dimensionsByKind = new Map(dimensionRows.map((row) => [row.inventoryKind as InventoryKind, row]));
  const incubatorDimensions = dimensionsFromRow('incubators', dimensionsByKind.get('incubators'));
  const eggDimensions = dimensionsFromRow('unhatched_eggs', dimensionsByKind.get('unhatched_eggs'));
  const petDimensions = dimensionsFromRow('pets', dimensionsByKind.get('pets'));
  const itemDimensions = dimensionsFromRow('items', dimensionsByKind.get('items'));
  const jobsBySlot = new Map(jobRows.map((job) => [job.incubatorSlotId, job]));

  return {
    mysteryEggs: mysteryEggs.map((row) => ({ ...row, updatedAt: toIsoTimestamp(row.updatedAt) })),
    crackedEggResources: resourceRows.map((row) => ({ ...row, updatedAt: toIsoTimestamp(row.updatedAt) })),
    incubators: {
      dimensions: incubatorDimensions,
      slots: cellsForGrid(incubatorDimensions, slotRows.map((slot) => {
        const activeJob = jobsBySlot.get(slot.id);
        return {
          slotIndex: slot.slotIndex,
          item: {
            id: slot.id,
            slotSource: slot.slotSource,
            slotLevel: slot.slotLevel,
            isAvailable: slot.isAvailable,
            metadata: {
              speedMultiplierBasisPoints: slot.speedMultiplierBasisPoints,
              rarityBonusBasisPoints: slot.rarityBonusBasisPoints,
              fuelBehavior: slot.fuelBehavior,
              specialEffectConfig: slot.specialEffectConfig
            },
            activeJob: activeJob ? { id: activeJob.id, unhatchedEggId: activeJob.unhatchedEggId, state: activeJob.state, startedAt: toIsoTimestamp(activeJob.startedAt), requiredProgressSeconds: activeJob.requiredProgressSeconds, progressSnapshot: activeJob.progressSnapshot } : null
          }
        };
      }))
    },
    unhatchedEggs: { dimensions: eggDimensions, slots: cellsForGrid(eggDimensions, unhatchedEggRows.map((row) => ({ slotIndex: row.slotIndex, item: { id: row.id, eggTypeId: row.eggTypeId, state: row.state } }))) },
    pets: { dimensions: petDimensions, slots: cellsForGrid(petDimensions, petRows.map((row) => ({ slotIndex: row.slotIndex, item: { ...row, createdAt: toIsoTimestamp(row.createdAt) } }))) },
    consumables: { dimensions: itemDimensions, slots: cellsForGrid(itemDimensions, consumableRows.map((row) => ({ slotIndex: row.slotIndex, item: { id: row.id, consumableTypeId: row.consumableTypeId, amount: row.amount, stackLimit: getStackLimit(row.consumableTypeId) } }))) }
  };
}

async function computeInventoryRevision(userId: string): Promise<string> {
  const [invMax, resourceMax, petStats, eggStats, jobStats, slotStats, itemStats, dimensionStats] = await Promise.all([
    db.select({ updatedAt: sql<Date>`max(${mysteryEggInventory.updatedAt})` }).from(mysteryEggInventory).where(eq(mysteryEggInventory.userId, userId)),
    db.select({ updatedAt: sql<Date>`max(${resources.updatedAt})` }).from(resources).where(eq(resources.userId, userId)),
    db.select({ count: sql<number>`count(*)`, newestCreatedAt: sql<Date>`max(${pets.createdAt})`, slotSum: sql<number>`coalesce(sum(${pets.slotIndex}), 0)` }).from(pets).where(eq(pets.ownerUserId, userId)),
    db
      .select({ count: sql<number>`count(*)`, newestCreatedAt: sql<Date>`max(${unhatchedEggs.createdAt})`, slotSum: sql<number>`coalesce(sum(${unhatchedEggs.slotIndex}), 0)` })
      .from(unhatchedEggs)
      .where(and(eq(unhatchedEggs.ownerUserId, userId), inArray(unhatchedEggs.state, ['ready_for_incubation', 'incubating']))),
    db
      .select({ newestStartedAt: sql<Date>`max(${incubationJobs.startedAt})`, newestCompletedAt: sql<Date>`max(${incubationJobs.completedAt})` })
      .from(incubationJobs)
      .where(eq(incubationJobs.ownerUserId, userId)),
    db.select({ count: sql<number>`count(*)`, updatedAt: sql<Date>`max(${incubatorSlots.updatedAt})`, slotSum: sql<number>`coalesce(sum(${incubatorSlots.slotIndex}), 0)` }).from(incubatorSlots).where(eq(incubatorSlots.ownerUserId, userId)),
    db.select({ count: sql<number>`count(*)`, updatedAt: sql<Date>`max(${consumableItemStacks.updatedAt})`, slotSum: sql<number>`coalesce(sum(${consumableItemStacks.slotIndex}), 0)`, amountSum: sql<number>`coalesce(sum(${consumableItemStacks.amount}), 0)` }).from(consumableItemStacks).where(eq(consumableItemStacks.userId, userId)),
    db.select({ updatedAt: sql<Date>`max(${inventoryDimensions.updatedAt})` }).from(inventoryDimensions).where(eq(inventoryDimensions.userId, userId))
  ]);

  const payload = [
    invMax[0]?.updatedAt ? toIsoTimestamp(invMax[0].updatedAt) : '0',
    resourceMax[0]?.updatedAt ? toIsoTimestamp(resourceMax[0].updatedAt) : '0',
    petStats[0]?.count ?? 0,
    petStats[0]?.slotSum ?? 0,
    petStats[0]?.newestCreatedAt ? toIsoTimestamp(petStats[0].newestCreatedAt) : '0',
    eggStats[0]?.count ?? 0,
    eggStats[0]?.slotSum ?? 0,
    eggStats[0]?.newestCreatedAt ? toIsoTimestamp(eggStats[0].newestCreatedAt) : '0',
    jobStats[0]?.newestStartedAt ? toIsoTimestamp(jobStats[0].newestStartedAt) : '0',
    jobStats[0]?.newestCompletedAt ? toIsoTimestamp(jobStats[0].newestCompletedAt) : '0',
    slotStats[0]?.count ?? 0,
    slotStats[0]?.slotSum ?? 0,
    slotStats[0]?.updatedAt ? toIsoTimestamp(slotStats[0].updatedAt) : '0',
    itemStats[0]?.count ?? 0,
    itemStats[0]?.slotSum ?? 0,
    itemStats[0]?.amountSum ?? 0,
    itemStats[0]?.updatedAt ? toIsoTimestamp(itemStats[0].updatedAt) : '0',
    dimensionStats[0]?.updatedAt ? toIsoTimestamp(dimensionStats[0].updatedAt) : '0'
  ].join('|');

  return createHash('sha1').update(payload).digest('hex');
}

export async function registerGameRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/events/overlay/alerts/stream', async (request, reply) => {
    if (!ensureOverlayAccess(request)) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
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

  app.get('/api/events/overlay/battle', async (request, reply) => {
    if (!ensureOverlayAccess(request)) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
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

  app.get('/api/events/overlay/battle/stream', async (request, reply) => {
    if (!ensureOverlayAccess(request)) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.hijack();

    const sendEvent = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let lastResolvedAtIso = '';
    const intervalId = setInterval(async () => {
      try {
        const latestBattle = await app.inject({
          method: 'GET',
          url: '/api/events/overlay/battle',
          headers: config.OVERLAY_SECRET ? { 'x-overlay-secret': config.OVERLAY_SECRET } : undefined
        });
        if (latestBattle.statusCode !== 200) return;
        const payload = latestBattle.json() as { resolvedAt?: string | null; winners?: unknown[] };
        const resolvedAtIso = payload.resolvedAt ?? '';
        if (resolvedAtIso && resolvedAtIso !== lastResolvedAtIso) {
          sendEvent('battle_result', payload);
          lastResolvedAtIso = resolvedAtIso;
        }
        sendEvent('heartbeat', { t: Date.now() });
      } catch (error) {
        request.log.error({ err: error }, 'battle overlay stream update failed');
      }
    }, 2000);

    request.raw.on('close', () => {
      clearInterval(intervalId);
      reply.raw.end();
    });
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
      const freeEggSlot = picked.outcomeType === 'pet' ? await findFreeEggSlotInTx(tx, identity.userId) : null;
      if (picked.outcomeType === 'pet' && freeEggSlot === null) {
        return { kind: 'unhatched_inventory_full' as const };
      }

      await tx
        .update(mysteryEggInventory)
        .set({ amount: sql`greatest(${mysteryEggInventory.amount} - 1, 0)`, updatedAt: new Date() })
        .where(and(eq(mysteryEggInventory.userId, identity.userId), eq(mysteryEggInventory.eggTypeId, eggTypeId)));

      if (picked.outcomeType === 'pet' && picked.petTypeId) {
        if (freeEggSlot === null) return { kind: 'unhatched_inventory_full' as const };
        const [egg] = await tx.insert(unhatchedEggs).values({
          ownerUserId: identity.userId,
          eggTypeId: eggTypeId,
          hiddenPetTypeId: picked.petTypeId,
          state: 'ready_for_incubation',
          slotIndex: freeEggSlot
        }).returning({ id: unhatchedEggs.id });

        await tx.insert(economyLedger).values({
          userId: identity.userId,
          actorUserId: identity.userId,
          eventType: 'mystery_egg_identified_to_unhatched_egg',
          sourceType: 'player_action',
          sourceId: egg?.id ?? null,
          delta: { mysteryEggInventory: [{ eggTypeId: eggTypeId, amountDelta: -1 }], unhatchedEggs: [{ eggTypeId: eggTypeId, amountDelta: 1, slotIndex: freeEggSlot }] }
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
    if (result.kind === 'unhatched_inventory_full') {
      return reply.code(409).send({ code: 'UNHATCHED_EGG_INVENTORY_FULL', message: 'Dein Eier-Inventar ist voll. Bitte schaffe zuerst Platz.' });
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
      const [slot] = await tx.select({ id: incubatorSlots.id, speedMultiplierBasisPoints: incubatorSlots.speedMultiplierBasisPoints, rarityBonusBasisPoints: incubatorSlots.rarityBonusBasisPoints, fuelBehavior: incubatorSlots.fuelBehavior, specialEffectConfig: incubatorSlots.specialEffectConfig }).from(incubatorSlots).where(and(eq(incubatorSlots.id, body.incubatorSlotId!), eq(incubatorSlots.ownerUserId, identity.userId), eq(incubatorSlots.isAvailable, true))).limit(1);
      if (!slot) return { kind: 'slot_missing' as const };
      const [job] = await tx.select({ id: incubationJobs.id }).from(incubationJobs).where(and(eq(incubationJobs.incubatorSlotId, slot.id), eq(incubationJobs.state, 'running'))).limit(1);
      if (job) return { kind: 'slot_busy' as const };
      const [egg] = await tx.select({ id: unhatchedEggs.id, eggTypeId: unhatchedEggs.eggTypeId, state: unhatchedEggs.state, slotIndex: unhatchedEggs.slotIndex }).from(unhatchedEggs).where(and(eq(unhatchedEggs.id, body.unhatchedEggId!), eq(unhatchedEggs.ownerUserId, identity.userId))).limit(1);
      if (!egg || egg.state !== 'ready_for_incubation' || egg.slotIndex === null) return { kind: 'egg_missing' as const };
      const [eggType] = await tx.select({ baseIncubationSeconds: eggTypes.baseIncubationSeconds }).from(eggTypes).where(eq(eggTypes.id, egg.eggTypeId)).limit(1);
      if (!eggType) return { kind: 'egg_type_missing' as const };

      const streamState = await getCurrentStreamState();
      const streamMultiplier = computeIncubationMultiplier({ isLive: streamState.isLive, viewerCount: streamState.viewerCount });
      const incubatorMultiplier = Math.max(1, slot.speedMultiplierBasisPoints) / 10000;
      const adjustedSeconds = Math.max(1, Math.ceil(eggType.baseIncubationSeconds / (streamMultiplier * incubatorMultiplier)));

      const [created] = await tx.insert(incubationJobs).values({ ownerUserId: identity.userId, unhatchedEggId: egg.id, incubatorSlotId: slot.id, state: 'running', requiredProgressSeconds: adjustedSeconds, progressSnapshot: { mode: 'timestamp_with_stream_and_incubator_multiplier', streamState, multiplierApplied: streamMultiplier, incubatorMultiplierApplied: incubatorMultiplier, baseIncubationSeconds: eggType.baseIncubationSeconds, incubatorMetadata: { speedMultiplierBasisPoints: slot.speedMultiplierBasisPoints, rarityBonusBasisPoints: slot.rarityBonusBasisPoints, fuelBehavior: slot.fuelBehavior, specialEffectConfig: slot.specialEffectConfig } } }).returning({ id: incubationJobs.id });
      if (!created) {
        throw new Error('Failed to create incubation job');
      }
      await tx.update(unhatchedEggs).set({ state: 'incubating', slotIndex: null }).where(eq(unhatchedEggs.id, egg.id));
      await tx.update(incubatorSlots).set({ isAvailable: false, updatedAt: new Date() }).where(eq(incubatorSlots.id, slot.id));
      await tx.insert(economyLedger).values({ userId: identity.userId, actorUserId: identity.userId, eventType: 'incubation_started', sourceType: 'player_action', sourceId: created.id, delta: { incubationJobs: [{ id: created.id, unhatchedEggId: egg.id, incubatorSlotId: slot.id }], unhatchedEggs: [{ id: egg.id, freedSlotIndex: egg.slotIndex }], incubatorSlots: [{ id: slot.id, occupied: true }] } });
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

      const freePetSlot = await findFreePetSlotInTx(tx, identity.userId);
      if (freePetSlot === null) return { kind: 'pet_inventory_full' as const };

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
        sourceUnhatchedEggId: egg.id,
        slotIndex: freePetSlot
      }).returning({ id: pets.id });

      await tx.update(incubationJobs).set({ state: 'completed', completedAt: new Date() }).where(eq(incubationJobs.id, job.id));
      await tx.update(unhatchedEggs).set({ state: 'hatched' }).where(eq(unhatchedEggs.id, egg.id));
      await tx.update(incubatorSlots).set({ isAvailable: true, updatedAt: new Date() }).where(eq(incubatorSlots.id, job.incubatorSlotId));
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'incubation_finished',
        sourceType: 'player_action',
        sourceId: job.id,
        delta: { hatchedPets: [{ id: newPet?.id ?? null, petTypeId: petType.id, slotIndex: freePetSlot }], unhatchedEggs: [{ id: egg.id, change: -1 }], incubatorSlots: [{ id: job.incubatorSlotId, occupied: false }] }
      });

      return { kind: 'ok' as const };
    });

    if (result.kind !== 'ok') {
      if (result.kind === 'pet_inventory_full') {
        return reply.code(409).send({ code: 'PET_INVENTORY_FULL', message: 'Dein Pet-Inventar ist voll. Bitte schaffe zuerst Platz.' });
      }
      return reply.code(409).send({ message: result.kind });
    }
    return { ok: true };
  });


  app.post('/api/game/inventory/egg-slots/move', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as { unhatchedEggId?: string; toSlotIndex?: number };
    if (!body.unhatchedEggId || !Number.isInteger(body.toSlotIndex)) return reply.code(400).send({ message: 'unhatchedEggId and toSlotIndex are required' });
    const result = await db.transaction(async (tx) => {
      const dimensions = await getDimensionsInTx(tx, identity.userId, 'unhatched_eggs');
      if (!isSlotInsideGrid(body.toSlotIndex!, dimensions)) return { kind: 'slot_out_of_bounds' as const };
      const [source] = await tx.select({ id: unhatchedEggs.id, slotIndex: unhatchedEggs.slotIndex }).from(unhatchedEggs).where(and(eq(unhatchedEggs.id, body.unhatchedEggId!), eq(unhatchedEggs.ownerUserId, identity.userId), eq(unhatchedEggs.state, 'ready_for_incubation'))).limit(1);
      if (!source || source.slotIndex === null) return { kind: 'not_found' as const };
      const [destination] = await tx.select({ id: unhatchedEggs.id, slotIndex: unhatchedEggs.slotIndex }).from(unhatchedEggs).where(and(eq(unhatchedEggs.ownerUserId, identity.userId), eq(unhatchedEggs.state, 'ready_for_incubation'), eq(unhatchedEggs.slotIndex, body.toSlotIndex!), not(eq(unhatchedEggs.id, source.id)))).limit(1);
      await tx.update(unhatchedEggs).set({ slotIndex: null }).where(eq(unhatchedEggs.id, source.id));
      if (destination) await tx.update(unhatchedEggs).set({ slotIndex: source.slotIndex }).where(eq(unhatchedEggs.id, destination.id));
      await tx.update(unhatchedEggs).set({ slotIndex: body.toSlotIndex }).where(eq(unhatchedEggs.id, source.id));
      const [ledger] = await tx.insert(economyLedger).values({ userId: identity.userId, actorUserId: identity.userId, eventType: 'inventory_egg_slot_moved', sourceType: 'player_action', sourceId: source.id, delta: { unhatchedEggSlots: [{ id: source.id, fromSlotIndex: source.slotIndex, toSlotIndex: body.toSlotIndex }, destination ? { id: destination.id, fromSlotIndex: destination.slotIndex, toSlotIndex: source.slotIndex } : null].filter((entry): entry is { id: string; fromSlotIndex: number | null; toSlotIndex: number | null } => entry !== null) } }).returning({ id: economyLedger.id });
      if (!ledger) throw new Error('Failed to ledger egg slot move');
      return { kind: 'ok' as const };
    });
    if (result.kind !== 'ok') return reply.code(409).send({ message: result.kind });
    return { ok: true };
  });

  app.post('/api/game/inventory/pet-slots/move', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as { petId?: string; toSlotIndex?: number };
    if (!body.petId || !Number.isInteger(body.toSlotIndex)) return reply.code(400).send({ message: 'petId and toSlotIndex are required' });
    const result = await db.transaction(async (tx) => {
      const dimensions = await getDimensionsInTx(tx, identity.userId, 'pets');
      if (!isSlotInsideGrid(body.toSlotIndex!, dimensions)) return { kind: 'slot_out_of_bounds' as const };
      const [source] = await tx.select({ id: pets.id, slotIndex: pets.slotIndex }).from(pets).where(and(eq(pets.id, body.petId!), eq(pets.ownerUserId, identity.userId))).limit(1);
      if (!source || source.slotIndex === null) return { kind: 'not_found' as const };
      const [destination] = await tx.select({ id: pets.id, slotIndex: pets.slotIndex }).from(pets).where(and(eq(pets.ownerUserId, identity.userId), eq(pets.slotIndex, body.toSlotIndex!), not(eq(pets.id, source.id)))).limit(1);
      await tx.update(pets).set({ slotIndex: null }).where(eq(pets.id, source.id));
      if (destination) await tx.update(pets).set({ slotIndex: source.slotIndex }).where(eq(pets.id, destination.id));
      await tx.update(pets).set({ slotIndex: body.toSlotIndex }).where(eq(pets.id, source.id));
      await tx.insert(economyLedger).values({ userId: identity.userId, actorUserId: identity.userId, eventType: 'inventory_pet_slot_moved', sourceType: 'player_action', sourceId: source.id, delta: { petSlots: [{ id: source.id, fromSlotIndex: source.slotIndex, toSlotIndex: body.toSlotIndex }, destination ? { id: destination.id, fromSlotIndex: destination.slotIndex, toSlotIndex: source.slotIndex } : null].filter((entry): entry is { id: string; fromSlotIndex: number | null; toSlotIndex: number | null } => entry !== null) } });
      return { kind: 'ok' as const };
    });
    if (result.kind !== 'ok') return reply.code(409).send({ message: result.kind });
    return { ok: true };
  });

  app.post('/api/game/incubators/move', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as { incubatorSlotId?: string; toSlotIndex?: number };
    if (!body.incubatorSlotId || !Number.isInteger(body.toSlotIndex)) return reply.code(400).send({ message: 'incubatorSlotId and toSlotIndex are required' });
    const result = await db.transaction(async (tx) => {
      const dimensions = await getDimensionsInTx(tx, identity.userId, 'incubators');
      if (!isSlotInsideGrid(body.toSlotIndex!, dimensions)) return { kind: 'slot_out_of_bounds' as const };
      const [source] = await tx.select({ id: incubatorSlots.id, slotIndex: incubatorSlots.slotIndex }).from(incubatorSlots).where(and(eq(incubatorSlots.id, body.incubatorSlotId!), eq(incubatorSlots.ownerUserId, identity.userId))).limit(1);
      if (!source || source.slotIndex === null) return { kind: 'not_found' as const };
      const [destination] = await tx.select({ id: incubatorSlots.id, slotIndex: incubatorSlots.slotIndex }).from(incubatorSlots).where(and(eq(incubatorSlots.ownerUserId, identity.userId), eq(incubatorSlots.slotIndex, body.toSlotIndex!), not(eq(incubatorSlots.id, source.id)))).limit(1);
      await tx.update(incubatorSlots).set({ slotIndex: null, updatedAt: new Date() }).where(eq(incubatorSlots.id, source.id));
      if (destination) await tx.update(incubatorSlots).set({ slotIndex: source.slotIndex, updatedAt: new Date() }).where(eq(incubatorSlots.id, destination.id));
      await tx.update(incubatorSlots).set({ slotIndex: body.toSlotIndex, updatedAt: new Date() }).where(eq(incubatorSlots.id, source.id));
      await tx.insert(economyLedger).values({ userId: identity.userId, actorUserId: identity.userId, eventType: 'inventory_incubator_slot_moved', sourceType: 'player_action', sourceId: source.id, delta: { incubatorSlots: [{ id: source.id, fromSlotIndex: source.slotIndex, toSlotIndex: body.toSlotIndex }, destination ? { id: destination.id, fromSlotIndex: destination.slotIndex, toSlotIndex: source.slotIndex } : null].filter((entry): entry is { id: string; fromSlotIndex: number | null; toSlotIndex: number | null } => entry !== null) } });
      return { kind: 'ok' as const };
    });
    if (result.kind !== 'ok') return reply.code(409).send({ message: result.kind });
    return { ok: true };
  });

  app.post('/api/game/inventory/item-slots/move', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as { itemStackId?: string; toSlotIndex?: number };
    if (!body.itemStackId || !Number.isInteger(body.toSlotIndex)) return reply.code(400).send({ message: 'itemStackId and toSlotIndex are required' });
    const result = await db.transaction(async (tx) => {
      const dimensions = await getDimensionsInTx(tx, identity.userId, 'items');
      if (!isSlotInsideGrid(body.toSlotIndex!, dimensions)) return { kind: 'slot_out_of_bounds' as const };
      const [source] = await tx.select({ id: consumableItemStacks.id, consumableTypeId: consumableItemStacks.consumableTypeId, amount: consumableItemStacks.amount, slotIndex: consumableItemStacks.slotIndex }).from(consumableItemStacks).where(and(eq(consumableItemStacks.id, body.itemStackId!), eq(consumableItemStacks.userId, identity.userId))).limit(1);
      if (!source || source.slotIndex === null) return { kind: 'not_found' as const };
      const [destination] = await tx.select({ id: consumableItemStacks.id, consumableTypeId: consumableItemStacks.consumableTypeId, amount: consumableItemStacks.amount, slotIndex: consumableItemStacks.slotIndex }).from(consumableItemStacks).where(and(eq(consumableItemStacks.userId, identity.userId), eq(consumableItemStacks.slotIndex, body.toSlotIndex!), not(eq(consumableItemStacks.id, source.id)))).limit(1);
      if (destination && destination.consumableTypeId === source.consumableTypeId) {
        const stackLimit = getStackLimit(source.consumableTypeId);
        const moveAmount = Math.min(source.amount, Math.max(0, stackLimit - destination.amount));
        if (moveAmount <= 0) return { kind: 'stack_full' as const };
        await tx.update(consumableItemStacks).set({ amount: destination.amount + moveAmount, updatedAt: new Date() }).where(eq(consumableItemStacks.id, destination.id));
        if (source.amount === moveAmount) await tx.delete(consumableItemStacks).where(eq(consumableItemStacks.id, source.id));
        else await tx.update(consumableItemStacks).set({ amount: source.amount - moveAmount, updatedAt: new Date() }).where(eq(consumableItemStacks.id, source.id));
      } else {
        await tx.update(consumableItemStacks).set({ slotIndex: null, updatedAt: new Date() }).where(eq(consumableItemStacks.id, source.id));
        if (destination) await tx.update(consumableItemStacks).set({ slotIndex: source.slotIndex, updatedAt: new Date() }).where(eq(consumableItemStacks.id, destination.id));
        await tx.update(consumableItemStacks).set({ slotIndex: body.toSlotIndex, updatedAt: new Date() }).where(eq(consumableItemStacks.id, source.id));
      }
      await tx.insert(economyLedger).values({ userId: identity.userId, actorUserId: identity.userId, eventType: 'inventory_item_slot_moved', sourceType: 'player_action', sourceId: source.id, delta: { itemStacks: [{ id: source.id, fromSlotIndex: source.slotIndex, toSlotIndex: body.toSlotIndex, destinationStackId: destination?.id ?? null }] } });
      return { kind: 'ok' as const };
    });
    if (result.kind !== 'ok') return reply.code(409).send({ message: result.kind });
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

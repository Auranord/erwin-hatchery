import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, inArray, not, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  consumableItemStacks,
  economyLedger,
  eggLootTableEntries,
  unhatchedEggs,
  inventoryDimensions,
  mysteryEggInventory,
  pets,
  resources,
  incubationJobs,
  incubatorSlots,
  eggTypes,
  petTypes,
  leaderboardScores,
  users,
  gameEvents
} from '../db/schema.js';
import { getSessionIdentity } from './session-auth.js';
import { config } from '../config.js';
import {
  computeIncubationMultiplier,
  getCurrentStreamState
} from '../services/streamState.js';
import {
  DEFAULT_INVENTORY_GRIDS,
  getStackLimit,
  isSlotInsideGrid,
  type InventoryGridDimensions,
  type InventoryKind,
  type PlayerInventoryPayload,
  type SlottedInventoryCell
} from '@erwin/shared';

function getOverlayToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  const bearerToken =
    typeof authHeader === 'string' &&
    authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : undefined;
  const headerToken =
    typeof request.headers['x-overlay-secret'] === 'string'
      ? request.headers['x-overlay-secret']
      : undefined;
  const queryTokenValue = (request.query as { token?: unknown } | undefined)
    ?.token;
  const queryToken =
    typeof queryTokenValue === 'string' ? queryTokenValue : undefined;
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
type SlotMoveDelta = { id: string; fromSlotIndex: number; toSlotIndex: number };
type OverlayAlertEvent = {
  id: string;
  type: 'pet_hatched';
  title: string;
  message: string;
  accent: 'hatch' | 'battle' | 'system';
  createdAt: string;
  durationMs: number;
};

const OVERLAY_ALERT_LEDGER_EVENT_TYPES = ['incubation_finished'];
const CRACKED_EGGS_RESOURCE_TYPE = 'cracked_eggs';
const DEFAULT_INCUBATOR_QUEUE_SLOTS = 2;
const PET_SCRAP_REWARD_BY_RARITY: Record<string, number> = {
  common: 1,
  uncommon: 3,
  rare: 8,
  epic: 20,
  legendary: 50
};

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toIsoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function dimensionsFromRow(
  kind: InventoryKind,
  row?: {
    columns: number;
    baseRows: number;
    bonusRows: number;
    upgradeRef: string | null;
  } | null
): InventoryGridDimensions {
  const defaults = DEFAULT_INVENTORY_GRIDS[kind];
  const columns = row?.columns ?? defaults.columns;
  const baseRows = row?.baseRows ?? defaults.baseRows;
  const bonusRows = row?.bonusRows ?? defaults.bonusRows;
  const rows = baseRows + bonusRows;
  return {
    kind,
    columns,
    rows,
    baseRows,
    bonusRows,
    capacity: columns * rows,
    upgradeRef: row?.upgradeRef ?? defaults.upgradeRef
  };
}

function cellsForGrid<T>(
  dimensions: InventoryGridDimensions,
  items: Array<{ slotIndex: number | null; item: T }>
): Array<SlottedInventoryCell<T>> {
  const bySlot = new Map<number, T>();
  for (const entry of items) {
    if (
      entry.slotIndex !== null &&
      isSlotInsideGrid(entry.slotIndex, dimensions)
    ) {
      bySlot.set(entry.slotIndex, entry.item);
    }
  }
  return Array.from({ length: dimensions.capacity }, (_, slotIndex) => ({
    slotIndex,
    item: bySlot.get(slotIndex) ?? null
  }));
}

async function ensureInventoryDimensions(userId: string): Promise<void> {
  await db.transaction(async (tx) => ensureInventoryDimensionsInTx(tx, userId));
}

async function ensureInventoryDimensionsInTx(
  tx: DbTransaction,
  userId: string
): Promise<void> {
  const kinds = Object.keys(DEFAULT_INVENTORY_GRIDS) as InventoryKind[];
  for (const kind of kinds) {
    const defaults = DEFAULT_INVENTORY_GRIDS[kind];
    await tx
      .insert(inventoryDimensions)
      .values({
        userId,
        inventoryKind: kind,
        columns: defaults.columns,
        baseRows: defaults.baseRows,
        bonusRows: defaults.bonusRows,
        upgradeRef: defaults.upgradeRef
      })
      .onConflictDoNothing({
        target: [inventoryDimensions.userId, inventoryDimensions.inventoryKind]
      });
  }
}

async function getDimensionsInTx(
  tx: DbTransaction,
  userId: string,
  kind: InventoryKind
): Promise<InventoryGridDimensions> {
  await ensureInventoryDimensionsInTx(tx, userId);
  const [row] = await tx
    .select({
      columns: inventoryDimensions.columns,
      baseRows: inventoryDimensions.baseRows,
      bonusRows: inventoryDimensions.bonusRows,
      upgradeRef: inventoryDimensions.upgradeRef
    })
    .from(inventoryDimensions)
    .where(
      and(
        eq(inventoryDimensions.userId, userId),
        eq(inventoryDimensions.inventoryKind, kind)
      )
    )
    .limit(1);
  return dimensionsFromRow(kind, row ?? null);
}

async function findFreeEggSlotInTx(
  tx: DbTransaction,
  userId: string
): Promise<number | null> {
  const dimensions = await getDimensionsInTx(tx, userId, 'unhatched_eggs');
  const occupiedRows = await tx
    .select({ slotIndex: unhatchedEggs.slotIndex })
    .from(unhatchedEggs)
    .where(
      and(
        eq(unhatchedEggs.ownerUserId, userId),
        eq(unhatchedEggs.state, 'ready_for_incubation')
      )
    );
  const occupied = new Set(
    occupiedRows
      .map((row) => row.slotIndex)
      .filter((slotIndex): slotIndex is number => slotIndex !== null)
  );
  for (let slotIndex = 0; slotIndex < dimensions.capacity; slotIndex += 1) {
    if (!occupied.has(slotIndex)) return slotIndex;
  }
  return null;
}

async function findFreePetSlotInTx(
  tx: DbTransaction,
  userId: string
): Promise<number | null> {
  const dimensions = await getDimensionsInTx(tx, userId, 'pets');
  const occupiedRows = await tx
    .select({ slotIndex: pets.slotIndex })
    .from(pets)
    .where(and(eq(pets.ownerUserId, userId), eq(pets.isScrapped, false)));
  const occupied = new Set(
    occupiedRows
      .map((row) => row.slotIndex)
      .filter((slotIndex): slotIndex is number => slotIndex !== null)
  );
  for (let slotIndex = 0; slotIndex < dimensions.capacity; slotIndex += 1) {
    if (!occupied.has(slotIndex)) return slotIndex;
  }
  return null;
}

async function ensureIncubatorSlots(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await ensureInventoryDimensionsInTx(tx, userId);
    const existingSlots = await tx
      .select({
        id: incubatorSlots.id,
        slotSource: incubatorSlots.slotSource,
        slotIndex: incubatorSlots.slotIndex,
        isAvailable: incubatorSlots.isAvailable
      })
      .from(incubatorSlots)
      .where(eq(incubatorSlots.ownerUserId, userId));

    async function ensureQueueSlot(slotIndex: number): Promise<void> {
      const existingSlot = existingSlots.find(
        (slot) => slot.slotIndex === slotIndex
      );
      if (existingSlot) {
        const [activeJob] = await tx
          .select({ id: incubationJobs.id })
          .from(incubationJobs)
          .where(
            and(
              eq(incubationJobs.incubatorSlotId, existingSlot.id),
              inArray(incubationJobs.state, ['queued', 'running'])
            )
          )
          .limit(1);
        const nextAvailability = activeJob ? false : true;
        if (
          existingSlot.slotSource !== 'default' ||
          existingSlot.isAvailable !== nextAvailability
        ) {
          await tx
            .update(incubatorSlots)
            .set({
              slotSource: 'default',
              isAvailable: nextAvailability,
              updatedAt: new Date()
            })
            .where(eq(incubatorSlots.id, existingSlot.id));
        }
        return;
      }

      const [createdSlot] = await tx
        .insert(incubatorSlots)
        .values({
          ownerUserId: userId,
          slotSource: 'default',
          slotIndex,
          isAvailable: true
        })
        .returning({ id: incubatorSlots.id });

      if (!createdSlot) {
        throw new Error(`Failed to create incubator queue slot ${slotIndex}`);
      }

      await tx.insert(economyLedger).values({
        userId,
        actorUserId: null,
        eventType: 'default_incubator_queue_slot_granted',
        sourceType: 'system',
        sourceId: createdSlot.id,
        delta: {
          incubatorSlots: [
            {
              id: createdSlot.id,
              change: 1,
              source: 'default',
              slotIndex,
              isAvailable: true
            }
          ]
        }
      });
    }

    for (
      let slotIndex = 0;
      slotIndex < DEFAULT_INCUBATOR_QUEUE_SLOTS;
      slotIndex += 1
    ) {
      await ensureQueueSlot(slotIndex);
    }
  });
}

async function syncIncubationQueueInTx(
  tx: DbTransaction,
  userId: string,
  now = new Date()
): Promise<Awaited<ReturnType<typeof getCurrentStreamState>>> {
  const streamState = await getCurrentStreamState();
  const [runningJob] = await tx
    .select({
      id: incubationJobs.id,
      startedAt: incubationJobs.startedAt,
      requiredProgressSeconds: incubationJobs.requiredProgressSeconds,
      progressSecondsAccumulated: incubationJobs.progressSecondsAccumulated,
      lastProgressedAt: incubationJobs.lastProgressedAt,
      speedMultiplierBasisPoints: incubatorSlots.speedMultiplierBasisPoints,
      rarityBonusBasisPoints: incubatorSlots.rarityBonusBasisPoints,
      fuelBehavior: incubatorSlots.fuelBehavior,
      specialEffectConfig: incubatorSlots.specialEffectConfig
    })
    .from(incubationJobs)
    .innerJoin(
      incubatorSlots,
      eq(incubationJobs.incubatorSlotId, incubatorSlots.id)
    )
    .where(
      and(
        eq(incubationJobs.ownerUserId, userId),
        eq(incubationJobs.state, 'running')
      )
    )
    .limit(1);

  if (runningJob) {
    if (!streamState.isLive) {
      if (runningJob.lastProgressedAt !== null) {
        await tx
          .update(incubationJobs)
          .set({
            lastProgressedAt: null,
            progressSnapshot: {
              mode: 'live_stream_progress',
              streamState,
              lastSyncedAt: now.toISOString(),
              progressPaused: true
            }
          })
          .where(eq(incubationJobs.id, runningJob.id));
      }
      return streamState;
    }

    const lastProgressedAt = runningJob.lastProgressedAt ?? now;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - new Date(lastProgressedAt).getTime()) / 1000)
    );
    const streamMultiplier = computeIncubationMultiplier({
      isLive: streamState.isLive,
      viewerCount: streamState.viewerCount
    });
    const incubatorMultiplier =
      Math.max(1, runningJob.speedMultiplierBasisPoints) / 10000;
    const progressDelta = Math.max(
      0,
      Math.floor(elapsedSeconds * streamMultiplier * incubatorMultiplier)
    );
    const nextProgress = Math.min(
      runningJob.requiredProgressSeconds,
      runningJob.progressSecondsAccumulated + progressDelta
    );
    await tx
      .update(incubationJobs)
      .set({
        progressSecondsAccumulated: nextProgress,
        lastProgressedAt: now,
        progressSnapshot: {
          mode: 'live_stream_progress',
          streamState,
          lastSyncedAt: now.toISOString(),
          multiplierApplied: streamMultiplier,
          incubatorMultiplierApplied: incubatorMultiplier,
          incubatorMetadata: {
            speedMultiplierBasisPoints: runningJob.speedMultiplierBasisPoints,
            rarityBonusBasisPoints: runningJob.rarityBonusBasisPoints,
            fuelBehavior: runningJob.fuelBehavior,
            specialEffectConfig: runningJob.specialEffectConfig
          }
        }
      })
      .where(eq(incubationJobs.id, runningJob.id));
    return streamState;
  }

  if (!streamState.isLive) return streamState;

  const [queuedJob] = await tx
    .select({
      id: incubationJobs.id,
      incubatorSlotId: incubationJobs.incubatorSlotId
    })
    .from(incubationJobs)
    .innerJoin(
      incubatorSlots,
      eq(incubationJobs.incubatorSlotId, incubatorSlots.id)
    )
    .where(
      and(
        eq(incubationJobs.ownerUserId, userId),
        eq(incubationJobs.state, 'queued')
      )
    )
    .orderBy(
      sql`${incubatorSlots.slotIndex} asc`,
      sql`${incubationJobs.startedAt} asc`
    )
    .limit(1);

  if (queuedJob) {
    await tx
      .update(incubationJobs)
      .set({
        state: 'running',
        lastProgressedAt: now,
        progressSnapshot: {
          mode: 'live_stream_progress',
          streamState,
          lastSyncedAt: now.toISOString(),
          autoStarted: true
        }
      })
      .where(eq(incubationJobs.id, queuedJob.id));
    await tx.insert(economyLedger).values({
      userId,
      actorUserId: null,
      eventType: 'incubation_auto_started',
      sourceType: 'system',
      sourceId: queuedJob.id,
      delta: { incubationJobs: [{ id: queuedJob.id, state: 'running' }] }
    });
  }

  return streamState;
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
  await ensureIncubatorSlots(userId);
  await db.transaction(async (tx) => {
    await syncIncubationQueueInTx(tx, userId);
  });
  await ensureInventoryDimensions(userId);
  const [
    dimensionRows,
    mysteryEggs,
    unhatchedEggRows,
    petRows,
    consumableRows,
    resourceRows,
    slotRows,
    jobRows
  ] = await Promise.all([
    db
      .select({
        inventoryKind: inventoryDimensions.inventoryKind,
        columns: inventoryDimensions.columns,
        baseRows: inventoryDimensions.baseRows,
        bonusRows: inventoryDimensions.bonusRows,
        upgradeRef: inventoryDimensions.upgradeRef
      })
      .from(inventoryDimensions)
      .where(eq(inventoryDimensions.userId, userId)),
    db
      .select({
        eggTypeId: mysteryEggInventory.eggTypeId,
        amount: mysteryEggInventory.amount,
        updatedAt: mysteryEggInventory.updatedAt
      })
      .from(mysteryEggInventory)
      .where(eq(mysteryEggInventory.userId, userId)),
    db
      .select({
        id: unhatchedEggs.id,
        eggTypeId: unhatchedEggs.eggTypeId,
        state: unhatchedEggs.state,
        slotIndex: unhatchedEggs.slotIndex
      })
      .from(unhatchedEggs)
      .where(
        and(
          eq(unhatchedEggs.ownerUserId, userId),
          eq(unhatchedEggs.state, 'ready_for_incubation')
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
        createdAt: pets.createdAt,
        slotIndex: pets.slotIndex
      })
      .from(pets)
      .innerJoin(petTypes, eq(pets.petTypeId, petTypes.id))
      .where(and(eq(pets.ownerUserId, userId), eq(pets.isScrapped, false))),
    db
      .select({
        id: consumableItemStacks.id,
        consumableTypeId: consumableItemStacks.consumableTypeId,
        amount: consumableItemStacks.amount,
        slotIndex: consumableItemStacks.slotIndex
      })
      .from(consumableItemStacks)
      .where(eq(consumableItemStacks.userId, userId)),
    db
      .select({
        resourceType: resources.resourceType,
        amount: resources.amount,
        updatedAt: resources.updatedAt
      })
      .from(resources)
      .where(eq(resources.userId, userId)),
    db
      .select({
        id: incubatorSlots.id,
        slotSource: incubatorSlots.slotSource,
        slotLevel: incubatorSlots.slotLevel,
        slotIndex: incubatorSlots.slotIndex,
        isAvailable: incubatorSlots.isAvailable,
        speedMultiplierBasisPoints: incubatorSlots.speedMultiplierBasisPoints,
        rarityBonusBasisPoints: incubatorSlots.rarityBonusBasisPoints,
        fuelBehavior: incubatorSlots.fuelBehavior,
        specialEffectConfig: incubatorSlots.specialEffectConfig
      })
      .from(incubatorSlots)
      .where(eq(incubatorSlots.ownerUserId, userId)),
    db
      .select({
        id: incubationJobs.id,
        incubatorSlotId: incubationJobs.incubatorSlotId,
        unhatchedEggId: incubationJobs.unhatchedEggId,
        state: incubationJobs.state,
        startedAt: incubationJobs.startedAt,
        requiredProgressSeconds: incubationJobs.requiredProgressSeconds,
        progressSecondsAccumulated: incubationJobs.progressSecondsAccumulated,
        lastProgressedAt: incubationJobs.lastProgressedAt,
        progressSnapshot: incubationJobs.progressSnapshot
      })
      .from(incubationJobs)
      .where(
        and(
          eq(incubationJobs.ownerUserId, userId),
          inArray(incubationJobs.state, ['queued', 'running'])
        )
      )
  ]);
  const dimensionsByKind = new Map(
    dimensionRows.map((row) => [row.inventoryKind as InventoryKind, row])
  );
  const eggDimensions = dimensionsFromRow(
    'unhatched_eggs',
    dimensionsByKind.get('unhatched_eggs')
  );
  const petDimensions = dimensionsFromRow('pets', dimensionsByKind.get('pets'));
  const itemDimensions = dimensionsFromRow(
    'items',
    dimensionsByKind.get('items')
  );
  const jobsBySlot = new Map(jobRows.map((job) => [job.incubatorSlotId, job]));

  return {
    mysteryEggs: mysteryEggs.map((row) => ({
      ...row,
      updatedAt: toIsoTimestamp(row.updatedAt)
    })),
    crackedEggResources: resourceRows.map((row) => ({
      ...row,
      updatedAt: toIsoTimestamp(row.updatedAt)
    })),
    incubators: {
      incubators: [...slotRows]
        .sort(
          (left, right) =>
            (left.slotIndex ?? Number.MAX_SAFE_INTEGER) -
            (right.slotIndex ?? Number.MAX_SAFE_INTEGER)
        )
        .map((slot) => {
          const activeJob = jobsBySlot.get(slot.id);
          return {
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
            activeJob: activeJob
              ? {
                  id: activeJob.id,
                  unhatchedEggId: activeJob.unhatchedEggId,
                  state: activeJob.state,
                  startedAt: toIsoTimestamp(activeJob.startedAt),
                  requiredProgressSeconds: activeJob.requiredProgressSeconds,
                  progressSecondsAccumulated:
                    activeJob.progressSecondsAccumulated,
                  lastProgressedAt: activeJob.lastProgressedAt
                    ? toIsoTimestamp(activeJob.lastProgressedAt)
                    : null,
                  progressSnapshot: activeJob.progressSnapshot
                }
              : null
          };
        })
    },
    unhatchedEggs: {
      dimensions: eggDimensions,
      slots: cellsForGrid(
        eggDimensions,
        unhatchedEggRows.map((row) => ({
          slotIndex: row.slotIndex,
          item: { id: row.id, eggTypeId: row.eggTypeId, state: row.state }
        }))
      )
    },
    pets: {
      dimensions: petDimensions,
      slots: cellsForGrid(
        petDimensions,
        petRows.map((row) => ({
          slotIndex: row.slotIndex,
          item: {
            id: row.id,
            petTypeId: row.petTypeId,
            petTypeDisplayName: row.petTypeDisplayName,
            rarity: row.rarity,
            role: row.role,
            hp: row.hp,
            attack: row.attack,
            defense: row.defense,
            speed: row.speed,
            selectedForEvent: row.selectedForEvent,
            createdAt: toIsoTimestamp(row.createdAt)
          }
        }))
      )
    },
    consumables: {
      dimensions: itemDimensions,
      slots: cellsForGrid(
        itemDimensions,
        consumableRows.map((row) => ({
          slotIndex: row.slotIndex,
          item: {
            id: row.id,
            consumableTypeId: row.consumableTypeId,
            amount: row.amount,
            stackLimit: getStackLimit(row.consumableTypeId)
          }
        }))
      )
    }
  };
}

async function computeInventoryRevision(userId: string): Promise<string> {
  const [
    invMax,
    resourceMax,
    petStats,
    eggStats,
    jobStats,
    slotStats,
    itemStats,
    dimensionStats,
    userStats
  ] = await Promise.all([
    db
      .select({ updatedAt: sql<Date>`max(${mysteryEggInventory.updatedAt})` })
      .from(mysteryEggInventory)
      .where(eq(mysteryEggInventory.userId, userId)),
    db
      .select({ updatedAt: sql<Date>`max(${resources.updatedAt})` })
      .from(resources)
      .where(eq(resources.userId, userId)),
    db
      .select({
        count: sql<number>`count(*)`,
        newestCreatedAt: sql<Date>`max(${pets.createdAt})`,
        slotSum: sql<number>`coalesce(sum(${pets.slotIndex}), 0)`
      })
      .from(pets)
      .where(and(eq(pets.ownerUserId, userId), eq(pets.isScrapped, false))),
    db
      .select({
        count: sql<number>`count(*)`,
        newestCreatedAt: sql<Date>`max(${unhatchedEggs.createdAt})`,
        slotSum: sql<number>`coalesce(sum(${unhatchedEggs.slotIndex}), 0)`
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
        newestCompletedAt: sql<Date>`max(${incubationJobs.completedAt})`,
        progressSum: sql<number>`coalesce(sum(${incubationJobs.progressSecondsAccumulated}), 0)`
      })
      .from(incubationJobs)
      .where(eq(incubationJobs.ownerUserId, userId)),
    db
      .select({
        count: sql<number>`count(*)`,
        updatedAt: sql<Date>`max(${incubatorSlots.updatedAt})`,
        slotSum: sql<number>`coalesce(sum(${incubatorSlots.slotIndex}), 0)`
      })
      .from(incubatorSlots)
      .where(eq(incubatorSlots.ownerUserId, userId)),
    db
      .select({
        count: sql<number>`count(*)`,
        updatedAt: sql<Date>`max(${consumableItemStacks.updatedAt})`,
        slotSum: sql<number>`coalesce(sum(${consumableItemStacks.slotIndex}), 0)`,
        amountSum: sql<number>`coalesce(sum(${consumableItemStacks.amount}), 0)`
      })
      .from(consumableItemStacks)
      .where(eq(consumableItemStacks.userId, userId)),
    db
      .select({ updatedAt: sql<Date>`max(${inventoryDimensions.updatedAt})` })
      .from(inventoryDimensions)
      .where(eq(inventoryDimensions.userId, userId)),
    db
      .select({
        isSubscriber: users.isSubscriber,
        subscriberEndsAt: users.subscriberEndsAt,
        updatedAt: users.updatedAt
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  ]);

  const payload = [
    invMax[0]?.updatedAt ? toIsoTimestamp(invMax[0].updatedAt) : '0',
    resourceMax[0]?.updatedAt ? toIsoTimestamp(resourceMax[0].updatedAt) : '0',
    petStats[0]?.count ?? 0,
    petStats[0]?.slotSum ?? 0,
    petStats[0]?.newestCreatedAt
      ? toIsoTimestamp(petStats[0].newestCreatedAt)
      : '0',
    eggStats[0]?.count ?? 0,
    eggStats[0]?.slotSum ?? 0,
    eggStats[0]?.newestCreatedAt
      ? toIsoTimestamp(eggStats[0].newestCreatedAt)
      : '0',
    jobStats[0]?.newestStartedAt
      ? toIsoTimestamp(jobStats[0].newestStartedAt)
      : '0',
    jobStats[0]?.newestCompletedAt
      ? toIsoTimestamp(jobStats[0].newestCompletedAt)
      : '0',
    jobStats[0]?.progressSum ?? 0,
    slotStats[0]?.count ?? 0,
    slotStats[0]?.slotSum ?? 0,
    slotStats[0]?.updatedAt ? toIsoTimestamp(slotStats[0].updatedAt) : '0',
    itemStats[0]?.count ?? 0,
    itemStats[0]?.slotSum ?? 0,
    itemStats[0]?.amountSum ?? 0,
    itemStats[0]?.updatedAt ? toIsoTimestamp(itemStats[0].updatedAt) : '0',
    dimensionStats[0]?.updatedAt
      ? toIsoTimestamp(dimensionStats[0].updatedAt)
      : '0',
    userStats[0]?.isSubscriber ? 'subscribed' : 'not_subscribed',
    userStats[0]?.subscriberEndsAt
      ? toIsoTimestamp(userStats[0].subscriberEndsAt)
      : '0',
    userStats[0]?.updatedAt ? toIsoTimestamp(userStats[0].updatedAt) : '0'
  ].join('|');

  return createHash('sha1').update(payload).digest('hex');
}

async function buildPetHatchedOverlayAlert(row: {
  id: string;
  userId: string | null;
  delta: unknown;
  createdAt: Date;
}): Promise<OverlayAlertEvent | null> {
  const hatchedPetId = (
    row.delta as { hatchedPets?: Array<{ id?: string | null }> } | null
  )?.hatchedPets?.[0]?.id;
  if (!hatchedPetId || !row.userId) return null;

  const [details] = await db
    .select({
      displayName: users.displayName,
      login: users.twitchLogin,
      petName: petTypes.displayName
    })
    .from(pets)
    .innerJoin(users, eq(pets.ownerUserId, users.id))
    .innerJoin(petTypes, eq(pets.petTypeId, petTypes.id))
    .where(eq(pets.id, hatchedPetId))
    .limit(1);
  if (!details) return null;

  const userName = details.displayName ?? details.login ?? 'Unbekannt';
  return {
    id: row.id,
    type: 'pet_hatched',
    title: 'Neues Pet geschlüpft!',
    message: `${userName} hat ${details.petName} ausgebrütet!`,
    accent: 'hatch',
    createdAt: toIsoTimestamp(row.createdAt),
    durationMs: 6200
  };
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
        const rows = await db
          .select({
            id: economyLedger.id,
            userId: economyLedger.userId,
            eventType: economyLedger.eventType,
            delta: economyLedger.delta,
            createdAt: economyLedger.createdAt
          })
          .from(economyLedger)
          .where(
            and(
              inArray(
                economyLedger.eventType,
                OVERLAY_ALERT_LEDGER_EVENT_TYPES
              ),
              sql`${economyLedger.createdAt} > ${lastSeen}`
            )
          )
          .orderBy(sql`${economyLedger.createdAt} asc`)
          .limit(25);

        for (const row of rows) {
          lastSeen = row.createdAt;
          if (row.eventType !== 'incubation_finished') continue;
          const alert = await buildPetHatchedOverlayAlert(row);
          if (!alert) continue;
          sendEvent('overlay_alert', alert);
        }
        sendEvent('heartbeat', { t: Date.now() });
      } catch (error) {
        request.log.error(
          { err: error },
          'alerts overlay stream update failed'
        );
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
    const [eventRow] = await db
      .select({
        id: gameEvents.id,
        resolvedAt: gameEvents.resolvedAt,
        resultJson: gameEvents.resultJson
      })
      .from(gameEvents)
      .where(
        and(
          eq(gameEvents.eventType, 'battle'),
          eq(gameEvents.status, 'resolved')
        )
      )
      .orderBy(
        sql`coalesce(${gameEvents.resolvedAt}, ${gameEvents.startedAt}) desc`
      )
      .limit(1);
    if (!eventRow) return { winners: [] };
    const winners =
      (
        eventRow.resultJson as {
          winners?: Array<{
            userId: string;
            petId: string;
            placement: number;
            pointsAwarded: number;
          }>;
        } | null
      )?.winners ?? [];
    const winnersWithNames = await Promise.all(
      winners.map(async (winner) => {
        const [details] = await db
          .select({
            displayName: users.displayName,
            login: users.twitchLogin,
            petName: petTypes.displayName
          })
          .from(pets)
          .innerJoin(users, eq(pets.ownerUserId, users.id))
          .innerJoin(petTypes, eq(pets.petTypeId, petTypes.id))
          .where(eq(pets.id, winner.petId))
          .limit(1);
        return {
          ...winner,
          userName: details?.displayName ?? details?.login ?? 'Unbekannt',
          petName: details?.petName ?? 'Unbekannt'
        };
      })
    );
    return {
      resolvedAt: eventRow.resolvedAt,
      winners: winnersWithNames.sort((a, b) => a.placement - b.placement)
    };
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
          headers: config.OVERLAY_SECRET
            ? { 'x-overlay-secret': config.OVERLAY_SECRET }
            : undefined
        });
        if (latestBattle.statusCode !== 200) return;
        const payload = latestBattle.json() as {
          resolvedAt?: string | null;
          winners?: unknown[];
        };
        const resolvedAtIso = payload.resolvedAt ?? '';
        if (resolvedAtIso && resolvedAtIso !== lastResolvedAtIso) {
          sendEvent('battle_result', payload);
          lastResolvedAtIso = resolvedAtIso;
        }
        sendEvent('heartbeat', { t: Date.now() });
      } catch (error) {
        request.log.error(
          { err: error },
          'battle overlay stream update failed'
        );
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
      .where(
        and(
          eq(leaderboardScores.leaderboardType, 'battle_points'),
          eq(users.isDeleted, false)
        )
      )
      .orderBy(
        sql`${leaderboardScores.score} desc`,
        sql`coalesce(${users.displayName}, ${users.twitchLogin}, ${users.twitchUserId}) asc`
      )
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
    await ensureIncubatorSlots(identity.userId);
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
      return reply
        .code(400)
        .send({ message: 'selectedForEvent must be a boolean' });
    }

    const result = await db.transaction(async (tx) => {
      const [ownedPet] = await tx
        .select({ id: pets.id })
        .from(pets)
        .where(
          and(
            eq(pets.id, petId),
            eq(pets.ownerUserId, identity.userId),
            eq(pets.isScrapped, false)
          )
        )
        .limit(1);

      if (!ownedPet) {
        return { kind: 'not_found' as const };
      }

      if (body.selectedForEvent) {
        await tx
          .update(pets)
          .set({ selectedForEvent: false })
          .where(
            and(
              eq(pets.ownerUserId, identity.userId),
              eq(pets.selectedForEvent, true),
              eq(pets.isScrapped, false)
            )
          );
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

    if (result.kind === 'not_found')
      return reply.code(404).send({ message: 'Pet not found' });
    return {
      status: 'ok',
      petId: result.pet.id,
      selectedForEvent: result.pet.selectedForEvent
    };
  });

  app.post('/api/game/mystery-eggs/identify', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    await ensureIncubatorSlots(identity.userId);

    const body = (request.body ?? {}) as { eggTypeId?: string };
    const eggTypeId = body.eggTypeId;
    if (!eggTypeId) {
      return reply.code(400).send({ message: 'eggTypeId is required' });
    }

    const result = await db.transaction(async (tx) => {
      const [inventoryRow] = await tx
        .select({ amount: mysteryEggInventory.amount })
        .from(mysteryEggInventory)
        .where(
          and(
            eq(mysteryEggInventory.userId, identity.userId),
            eq(mysteryEggInventory.eggTypeId, eggTypeId)
          )
        )
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
        .where(
          and(
            eq(eggLootTableEntries.eggTypeId, eggTypeId),
            sql`${eggLootTableEntries.weight} > 0`
          )
        );

      if (entries.length === 0) {
        throw new Error(`No loot table entries for egg type ${eggTypeId}`);
      }

      const picked = pickWeightedOutcome(entries);
      const freeEggSlot =
        picked.outcomeType === 'pet'
          ? await findFreeEggSlotInTx(tx, identity.userId)
          : null;
      if (picked.outcomeType === 'pet' && freeEggSlot === null) {
        return { kind: 'unhatched_inventory_full' as const };
      }

      await tx
        .update(mysteryEggInventory)
        .set({
          amount: sql`greatest(${mysteryEggInventory.amount} - 1, 0)`,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(mysteryEggInventory.userId, identity.userId),
            eq(mysteryEggInventory.eggTypeId, eggTypeId)
          )
        );

      if (picked.outcomeType === 'pet' && picked.petTypeId) {
        if (freeEggSlot === null)
          return { kind: 'unhatched_inventory_full' as const };
        const [egg] = await tx
          .insert(unhatchedEggs)
          .values({
            ownerUserId: identity.userId,
            eggTypeId: eggTypeId,
            hiddenPetTypeId: picked.petTypeId,
            state: 'ready_for_incubation',
            slotIndex: freeEggSlot
          })
          .returning({ id: unhatchedEggs.id });

        await tx.insert(economyLedger).values({
          userId: identity.userId,
          actorUserId: identity.userId,
          eventType: 'mystery_egg_identified_to_unhatched_egg',
          sourceType: 'player_action',
          sourceId: egg?.id ?? null,
          delta: {
            mysteryEggInventory: [{ eggTypeId: eggTypeId, amountDelta: -1 }],
            unhatchedEggs: [
              { eggTypeId: eggTypeId, amountDelta: 1, slotIndex: freeEggSlot }
            ]
          }
        });

        return { kind: 'unhatched_egg' as const };
      }

      const resourceAmount = picked.resourceAmount ?? 0;
      if (!picked.resourceType || resourceAmount <= 0) {
        throw new Error(`Loot table entry for ${eggTypeId} is invalid`);
      }

      const effectiveResourceAmount = Math.max(
        1,
        Math.floor(resourceAmount * config.DEBUG_EGG_RESOURCE_MULTIPLIER)
      );

      await tx
        .insert(resources)
        .values({
          userId: identity.userId,
          resourceType: picked.resourceType,
          amount: effectiveResourceAmount,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [resources.userId, resources.resourceType],
          set: {
            amount: sql`${resources.amount} + ${effectiveResourceAmount}`,
            updatedAt: new Date()
          }
        });

      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'mystery_egg_identified_to_egg_resources',
        sourceType: 'player_action',
        delta: {
          mysteryEggInventory: [{ eggTypeId: eggTypeId, amountDelta: -1 }],
          resources: [
            {
              resourceType: picked.resourceType,
              amountDelta: effectiveResourceAmount
            }
          ]
        }
      });

      return { kind: 'resources' as const };
    });

    if (result.kind === 'none') {
      return reply
        .code(409)
        .send({ message: 'No mystery egg of this type available' });
    }
    if (result.kind === 'unhatched_inventory_full') {
      return reply.code(409).send({
        code: 'UNHATCHED_EGG_INVENTORY_FULL',
        message: 'Dein Eier-Inventar ist voll. Bitte schaffe zuerst Platz.'
      });
    }

    return { ok: true, result: result.kind };
  });

  app.post('/api/game/incubation/start', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    await ensureIncubatorSlots(identity.userId);
    const body = (request.body ?? {}) as {
      unhatchedEggId?: string;
      incubatorSlotId?: string;
    };
    if (!body.unhatchedEggId || !body.incubatorSlotId) {
      return reply
        .code(400)
        .send({ message: 'unhatchedEggId and incubatorSlotId are required' });
    }

    const result = await db.transaction(async (tx) => {
      const streamState = await syncIncubationQueueInTx(tx, identity.userId);
      const [slot] = await tx
        .select({
          id: incubatorSlots.id,
          slotSource: incubatorSlots.slotSource,
          slotIndex: incubatorSlots.slotIndex,
          isAvailable: incubatorSlots.isAvailable,
          speedMultiplierBasisPoints: incubatorSlots.speedMultiplierBasisPoints,
          rarityBonusBasisPoints: incubatorSlots.rarityBonusBasisPoints,
          fuelBehavior: incubatorSlots.fuelBehavior,
          specialEffectConfig: incubatorSlots.specialEffectConfig
        })
        .from(incubatorSlots)
        .where(
          and(
            eq(incubatorSlots.id, body.incubatorSlotId!),
            eq(incubatorSlots.ownerUserId, identity.userId)
          )
        )
        .limit(1);
      if (!slot) return { kind: 'slot_missing' as const };
      if (!slot.isAvailable) return { kind: 'slot_busy' as const };
      const [job] = await tx
        .select({ id: incubationJobs.id })
        .from(incubationJobs)
        .where(
          and(
            eq(incubationJobs.incubatorSlotId, slot.id),
            inArray(incubationJobs.state, ['queued', 'running'])
          )
        )
        .limit(1);
      if (job) return { kind: 'slot_busy' as const };
      const [egg] = await tx
        .select({
          id: unhatchedEggs.id,
          eggTypeId: unhatchedEggs.eggTypeId,
          state: unhatchedEggs.state,
          slotIndex: unhatchedEggs.slotIndex
        })
        .from(unhatchedEggs)
        .where(
          and(
            eq(unhatchedEggs.id, body.unhatchedEggId!),
            eq(unhatchedEggs.ownerUserId, identity.userId)
          )
        )
        .limit(1);
      if (
        !egg ||
        egg.state !== 'ready_for_incubation' ||
        egg.slotIndex === null
      )
        return { kind: 'egg_missing' as const };
      const [eggType] = await tx
        .select({ baseIncubationSeconds: eggTypes.baseIncubationSeconds })
        .from(eggTypes)
        .where(eq(eggTypes.id, egg.eggTypeId))
        .limit(1);
      if (!eggType) return { kind: 'egg_type_missing' as const };

      const [runningJob] = await tx
        .select({ id: incubationJobs.id })
        .from(incubationJobs)
        .where(
          and(
            eq(incubationJobs.ownerUserId, identity.userId),
            eq(incubationJobs.state, 'running')
          )
        )
        .limit(1);
      const startsImmediately = streamState.isLive && !runningJob;
      const jobState = startsImmediately ? 'running' : 'queued';
      const now = new Date();
      const streamMultiplier = computeIncubationMultiplier({
        isLive: streamState.isLive,
        viewerCount: streamState.viewerCount
      });
      const incubatorMultiplier =
        Math.max(1, slot.speedMultiplierBasisPoints) / 10000;

      const [created] = await tx
        .insert(incubationJobs)
        .values({
          ownerUserId: identity.userId,
          unhatchedEggId: egg.id,
          incubatorSlotId: slot.id,
          state: jobState,
          startedAt: now,
          requiredProgressSeconds: eggType.baseIncubationSeconds,
          progressSecondsAccumulated: 0,
          lastProgressedAt: startsImmediately ? now : null,
          progressSnapshot: {
            mode: 'live_stream_progress',
            streamState,
            queuedAt: now.toISOString(),
            startedImmediately: startsImmediately,
            multiplierApplied: streamMultiplier,
            incubatorMultiplierApplied: incubatorMultiplier,
            baseIncubationSeconds: eggType.baseIncubationSeconds,
            incubatorMetadata: {
              speedMultiplierBasisPoints: slot.speedMultiplierBasisPoints,
              rarityBonusBasisPoints: slot.rarityBonusBasisPoints,
              fuelBehavior: slot.fuelBehavior,
              specialEffectConfig: slot.specialEffectConfig
            }
          }
        })
        .returning({ id: incubationJobs.id });
      if (!created) {
        throw new Error('Failed to create incubation job');
      }
      await tx
        .update(unhatchedEggs)
        .set({ state: 'incubating', slotIndex: null })
        .where(eq(unhatchedEggs.id, egg.id));
      await tx
        .update(incubatorSlots)
        .set({ isAvailable: false, updatedAt: now })
        .where(eq(incubatorSlots.id, slot.id));
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: startsImmediately
          ? 'incubation_started'
          : 'incubation_queued',
        sourceType: 'player_action',
        sourceId: created.id,
        delta: {
          incubationJobs: [
            {
              id: created.id,
              unhatchedEggId: egg.id,
              incubatorSlotId: slot.id,
              state: jobState,
              slotIndex: slot.slotIndex
            }
          ],
          unhatchedEggs: [{ id: egg.id, freedSlotIndex: egg.slotIndex }],
          incubatorSlots: [{ id: slot.id, occupied: true }]
        }
      });
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
    await ensureIncubatorSlots(identity.userId);
    const body = (request.body ?? {}) as { unhatchedEggId?: string };
    if (!body.unhatchedEggId) {
      return reply.code(400).send({ message: 'unhatchedEggId is required' });
    }

    const result = await db.transaction(async (tx) => {
      await syncIncubationQueueInTx(tx, identity.userId);
      const [egg] = await tx
        .select({
          id: unhatchedEggs.id,
          hiddenPetTypeId: unhatchedEggs.hiddenPetTypeId,
          state: unhatchedEggs.state
        })
        .from(unhatchedEggs)
        .where(
          and(
            eq(unhatchedEggs.id, body.unhatchedEggId!),
            eq(unhatchedEggs.ownerUserId, identity.userId)
          )
        )
        .limit(1);
      if (!egg || egg.state !== 'incubating')
        return { kind: 'egg_missing' as const };

      const [job] = await tx
        .select({
          id: incubationJobs.id,
          incubatorSlotId: incubationJobs.incubatorSlotId,
          startedAt: incubationJobs.startedAt,
          requiredProgressSeconds: incubationJobs.requiredProgressSeconds,
          progressSecondsAccumulated: incubationJobs.progressSecondsAccumulated
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

      if (job.progressSecondsAccumulated < job.requiredProgressSeconds) {
        return { kind: 'too_early' as const };
      }

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

      const [newPet] = await tx
        .insert(pets)
        .values({
          ownerUserId: identity.userId,
          petTypeId: petType.id,
          hp: petType.baseHp,
          attack: petType.baseAttack,
          defense: petType.baseDefense,
          speed: petType.baseSpeed,
          statRolls: { hp: 0, attack: 0, defense: 0, speed: 0 },
          sourceUnhatchedEggId: egg.id,
          slotIndex: freePetSlot
        })
        .returning({ id: pets.id });

      await tx
        .update(incubationJobs)
        .set({ state: 'completed', completedAt: new Date() })
        .where(eq(incubationJobs.id, job.id));
      await tx
        .update(unhatchedEggs)
        .set({ state: 'hatched' })
        .where(eq(unhatchedEggs.id, egg.id));
      const nextSlotAvailability = true;
      await tx
        .update(incubatorSlots)
        .set({ isAvailable: nextSlotAvailability, updatedAt: new Date() })
        .where(eq(incubatorSlots.id, job.incubatorSlotId));
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'incubation_finished',
        sourceType: 'player_action',
        sourceId: job.id,
        delta: {
          hatchedPets: [
            {
              id: newPet?.id ?? null,
              petTypeId: petType.id,
              slotIndex: freePetSlot
            }
          ],
          unhatchedEggs: [{ id: egg.id, change: -1 }],
          incubatorSlots: [
            {
              id: job.incubatorSlotId,
              occupied: false,
              isAvailable: nextSlotAvailability
            }
          ]
        }
      });
      await syncIncubationQueueInTx(tx, identity.userId);

      return { kind: 'ok' as const };
    });

    if (result.kind !== 'ok') {
      if (result.kind === 'pet_inventory_full') {
        return reply.code(409).send({
          code: 'PET_INVENTORY_FULL',
          message: 'Dein Pet-Inventar ist voll. Bitte schaffe zuerst Platz.'
        });
      }
      return reply.code(409).send({ message: result.kind });
    }
    return { ok: true };
  });

  app.post('/api/game/inventory/egg-slots/move', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as {
      unhatchedEggId?: string;
      toSlotIndex?: number;
    };
    if (!body.unhatchedEggId || !Number.isInteger(body.toSlotIndex))
      return reply
        .code(400)
        .send({ message: 'unhatchedEggId and toSlotIndex are required' });
    const toSlotIndex = body.toSlotIndex as number;
    const result = await db.transaction(async (tx) => {
      const dimensions = await getDimensionsInTx(
        tx,
        identity.userId,
        'unhatched_eggs'
      );
      if (!isSlotInsideGrid(toSlotIndex, dimensions))
        return { kind: 'slot_out_of_bounds' as const };
      const [source] = await tx
        .select({ id: unhatchedEggs.id, slotIndex: unhatchedEggs.slotIndex })
        .from(unhatchedEggs)
        .where(
          and(
            eq(unhatchedEggs.id, body.unhatchedEggId!),
            eq(unhatchedEggs.ownerUserId, identity.userId),
            eq(unhatchedEggs.state, 'ready_for_incubation')
          )
        )
        .limit(1);
      if (!source || source.slotIndex === null)
        return { kind: 'not_found' as const };
      const fromSlotIndex = source.slotIndex;
      const [destination] = await tx
        .select({ id: unhatchedEggs.id, slotIndex: unhatchedEggs.slotIndex })
        .from(unhatchedEggs)
        .where(
          and(
            eq(unhatchedEggs.ownerUserId, identity.userId),
            eq(unhatchedEggs.state, 'ready_for_incubation'),
            eq(unhatchedEggs.slotIndex, toSlotIndex),
            not(eq(unhatchedEggs.id, source.id))
          )
        )
        .limit(1);
      const slotMoves: SlotMoveDelta[] = [
        { id: source.id, fromSlotIndex, toSlotIndex }
      ];
      if (destination && destination.slotIndex !== null)
        slotMoves.push({
          id: destination.id,
          fromSlotIndex: destination.slotIndex,
          toSlotIndex: fromSlotIndex
        });
      await tx
        .update(unhatchedEggs)
        .set({ slotIndex: null })
        .where(eq(unhatchedEggs.id, source.id));
      if (destination)
        await tx
          .update(unhatchedEggs)
          .set({ slotIndex: fromSlotIndex })
          .where(eq(unhatchedEggs.id, destination.id));
      await tx
        .update(unhatchedEggs)
        .set({ slotIndex: toSlotIndex })
        .where(eq(unhatchedEggs.id, source.id));
      const [ledger] = await tx
        .insert(economyLedger)
        .values({
          userId: identity.userId,
          actorUserId: identity.userId,
          eventType: 'inventory_egg_slot_moved',
          sourceType: 'player_action',
          sourceId: source.id,
          delta: { unhatchedEggSlots: slotMoves }
        })
        .returning({ id: economyLedger.id });
      if (!ledger) throw new Error('Failed to ledger egg slot move');
      return { kind: 'ok' as const };
    });
    if (result.kind !== 'ok')
      return reply.code(409).send({ message: result.kind });
    return { ok: true };
  });

  app.post('/api/game/pets/scrap', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as { petId?: string; confirm?: boolean };
    if (!body.petId || body.confirm !== true)
      return reply
        .code(400)
        .send({ message: 'petId and confirm=true are required' });

    const result = await db.transaction(async (tx) => {
      const [pet] = await tx
        .select({
          id: pets.id,
          petTypeId: pets.petTypeId,
          selectedForEvent: pets.selectedForEvent,
          rarity: petTypes.rarity
        })
        .from(pets)
        .innerJoin(petTypes, eq(pets.petTypeId, petTypes.id))
        .where(
          and(
            eq(pets.id, body.petId!),
            eq(pets.ownerUserId, identity.userId),
            eq(pets.isScrapped, false)
          )
        )
        .limit(1);
      if (!pet) return { kind: 'not_found' as const };

      const rewardAmount =
        PET_SCRAP_REWARD_BY_RARITY[pet.rarity] ??
        PET_SCRAP_REWARD_BY_RARITY.common;
      const now = new Date();
      await tx
        .update(pets)
        .set({
          slotIndex: null,
          selectedForEvent: false,
          isScrapped: true,
          scrappedAt: now
        })
        .where(eq(pets.id, pet.id));
      await tx
        .insert(resources)
        .values({
          userId: identity.userId,
          resourceType: CRACKED_EGGS_RESOURCE_TYPE,
          amount: rewardAmount,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: [resources.userId, resources.resourceType],
          set: {
            amount: sql`${resources.amount} + ${rewardAmount}`,
            updatedAt: now
          }
        });
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'pet_scrapped_for_cracked_eggs',
        sourceType: 'player_action',
        sourceId: pet.id,
        delta: {
          pets: [
            {
              id: pet.id,
              petTypeId: pet.petTypeId,
              rarity: pet.rarity,
              change: -1,
              selectedForEvent: pet.selectedForEvent
            }
          ],
          resources: [
            {
              resourceType: CRACKED_EGGS_RESOURCE_TYPE,
              amountDelta: rewardAmount
            }
          ]
        }
      });

      return { kind: 'ok' as const, rewardAmount };
    });

    if (result.kind !== 'ok')
      return reply.code(404).send({ message: 'Pet nicht gefunden.' });
    return {
      ok: true,
      rewardAmount: result.rewardAmount,
      resourceType: CRACKED_EGGS_RESOURCE_TYPE
    };
  });

  app.post('/api/game/inventory/pet-slots/move', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as {
      petId?: string;
      toSlotIndex?: number;
    };
    if (!body.petId || !Number.isInteger(body.toSlotIndex))
      return reply
        .code(400)
        .send({ message: 'petId and toSlotIndex are required' });
    const toSlotIndex = body.toSlotIndex as number;
    const result = await db.transaction(async (tx) => {
      const dimensions = await getDimensionsInTx(tx, identity.userId, 'pets');
      if (!isSlotInsideGrid(toSlotIndex, dimensions))
        return { kind: 'slot_out_of_bounds' as const };
      const [source] = await tx
        .select({ id: pets.id, slotIndex: pets.slotIndex })
        .from(pets)
        .where(
          and(
            eq(pets.id, body.petId!),
            eq(pets.ownerUserId, identity.userId),
            eq(pets.isScrapped, false)
          )
        )
        .limit(1);
      if (!source || source.slotIndex === null)
        return { kind: 'not_found' as const };
      const fromSlotIndex = source.slotIndex;
      const [destination] = await tx
        .select({ id: pets.id, slotIndex: pets.slotIndex })
        .from(pets)
        .where(
          and(
            eq(pets.ownerUserId, identity.userId),
            eq(pets.isScrapped, false),
            eq(pets.slotIndex, toSlotIndex),
            not(eq(pets.id, source.id))
          )
        )
        .limit(1);
      const slotMoves: SlotMoveDelta[] = [
        { id: source.id, fromSlotIndex, toSlotIndex }
      ];
      if (destination && destination.slotIndex !== null)
        slotMoves.push({
          id: destination.id,
          fromSlotIndex: destination.slotIndex,
          toSlotIndex: fromSlotIndex
        });
      await tx
        .update(pets)
        .set({ slotIndex: null })
        .where(eq(pets.id, source.id));
      if (destination)
        await tx
          .update(pets)
          .set({ slotIndex: fromSlotIndex })
          .where(eq(pets.id, destination.id));
      await tx
        .update(pets)
        .set({ slotIndex: toSlotIndex })
        .where(eq(pets.id, source.id));
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'inventory_pet_slot_moved',
        sourceType: 'player_action',
        sourceId: source.id,
        delta: { petSlots: slotMoves }
      });
      return { kind: 'ok' as const };
    });
    if (result.kind !== 'ok')
      return reply.code(409).send({ message: result.kind });
    return { ok: true };
  });

  app.post('/api/game/incubators/move', async (_request, reply) => {
    return reply.code(410).send({
      message: 'Incubators are fixed drop targets and cannot be rearranged.'
    });
  });

  app.post('/api/game/inventory/item-slots/move', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as {
      itemStackId?: string;
      toSlotIndex?: number;
    };
    if (!body.itemStackId || !Number.isInteger(body.toSlotIndex))
      return reply
        .code(400)
        .send({ message: 'itemStackId and toSlotIndex are required' });
    const toSlotIndex = body.toSlotIndex as number;
    const result = await db.transaction(async (tx) => {
      const dimensions = await getDimensionsInTx(tx, identity.userId, 'items');
      if (!isSlotInsideGrid(toSlotIndex, dimensions))
        return { kind: 'slot_out_of_bounds' as const };
      const [source] = await tx
        .select({
          id: consumableItemStacks.id,
          consumableTypeId: consumableItemStacks.consumableTypeId,
          amount: consumableItemStacks.amount,
          slotIndex: consumableItemStacks.slotIndex
        })
        .from(consumableItemStacks)
        .where(
          and(
            eq(consumableItemStacks.id, body.itemStackId!),
            eq(consumableItemStacks.userId, identity.userId)
          )
        )
        .limit(1);
      if (!source || source.slotIndex === null)
        return { kind: 'not_found' as const };
      const [destination] = await tx
        .select({
          id: consumableItemStacks.id,
          consumableTypeId: consumableItemStacks.consumableTypeId,
          amount: consumableItemStacks.amount,
          slotIndex: consumableItemStacks.slotIndex
        })
        .from(consumableItemStacks)
        .where(
          and(
            eq(consumableItemStacks.userId, identity.userId),
            eq(consumableItemStacks.slotIndex, toSlotIndex),
            not(eq(consumableItemStacks.id, source.id))
          )
        )
        .limit(1);
      if (
        destination &&
        destination.consumableTypeId === source.consumableTypeId
      ) {
        const stackLimit = getStackLimit(source.consumableTypeId);
        const moveAmount = Math.min(
          source.amount,
          Math.max(0, stackLimit - destination.amount)
        );
        if (moveAmount <= 0) return { kind: 'stack_full' as const };
        await tx
          .update(consumableItemStacks)
          .set({
            amount: destination.amount + moveAmount,
            updatedAt: new Date()
          })
          .where(eq(consumableItemStacks.id, destination.id));
        if (source.amount === moveAmount)
          await tx
            .delete(consumableItemStacks)
            .where(eq(consumableItemStacks.id, source.id));
        else
          await tx
            .update(consumableItemStacks)
            .set({ amount: source.amount - moveAmount, updatedAt: new Date() })
            .where(eq(consumableItemStacks.id, source.id));
      } else {
        await tx
          .update(consumableItemStacks)
          .set({ slotIndex: null, updatedAt: new Date() })
          .where(eq(consumableItemStacks.id, source.id));
        if (destination)
          await tx
            .update(consumableItemStacks)
            .set({ slotIndex: source.slotIndex, updatedAt: new Date() })
            .where(eq(consumableItemStacks.id, destination.id));
        await tx
          .update(consumableItemStacks)
          .set({ slotIndex: toSlotIndex, updatedAt: new Date() })
          .where(eq(consumableItemStacks.id, source.id));
      }
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'inventory_item_slot_moved',
        sourceType: 'player_action',
        sourceId: source.id,
        delta: {
          itemStacks: [
            {
              id: source.id,
              fromSlotIndex: source.slotIndex,
              toSlotIndex,
              destinationStackId: destination?.id ?? null
            }
          ]
        }
      });
      return { kind: 'ok' as const };
    });
    if (result.kind !== 'ok')
      return reply.code(409).send({ message: result.kind });
    return { ok: true };
  });

  app.get('/api/game/inventory/stream', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    await ensureIncubatorSlots(identity.userId);

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.hijack();

    const sendEvent = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const initialInventory = await loadPlayerInventory(identity.userId);
    let currentRevision = await computeInventoryRevision(identity.userId);
    sendEvent('inventory', {
      revision: currentRevision,
      inventory: initialInventory
    });

    const intervalId = setInterval(async () => {
      try {
        const inventory = await loadPlayerInventory(identity.userId);
        currentRevision = await computeInventoryRevision(identity.userId);
        sendEvent('inventory', {
          revision: currentRevision,
          inventory
        });
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

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, inArray, isNull, not, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  consumableInventorySlots,
  consumableTypes,
  equipmentInventorySlots,
  equipmentTypes,
  equipmentSets,
  hatInventorySlots,
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
  elements,
  petAbilities,
  petClasses,
  petRarities,
  petSpecies,
  petTraitAssignments,
  petTraits,
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
  getAdditionalEquipmentSetCostCrackedEggs,
  getEquipmentSetSlotUpgradeCostCrackedEggs,
  getInventoryRowUpgradeCostCrackedEggs,
  isSlotInsideGrid,
  type InventoryGridDimensions,
  type InventoryKind,
  type PlayerInventoryPayload,
  type ShopOfferItem,
  type ShopOffersPayload,
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
const buyShopItemSchema = z.object({
  kind: z.enum(['equipment', 'consumable']),
  typeId: z.string().min(1).max(128)
});

const buyShopItemsSchema = z.object({
  items: z.array(buyShopItemSchema).min(1).max(50)
});

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
const SHOP_PURCHASE_LEDGER_EVENT_TYPE = 'shop_item_purchased';
const DEFAULT_INCUBATOR_QUEUE_SLOTS = 2;
const DEFAULT_EQUIPMENT_SET_BASE_SLOTS = 3;
const DEFAULT_EQUIPMENT_SET_UPGRADE_REF = 'equipment_set_slots';
const ADDITIONAL_EQUIPMENT_SET_UPGRADE_REF = 'additional_equipment_sets';
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
  const upgradeRef = row?.upgradeRef ?? defaults.upgradeRef;
  return {
    kind,
    columns,
    rows,
    baseRows,
    bonusRows,
    capacity: columns * rows,
    upgradeRef,
    nextRowUpgradeCostCrackedEggs: upgradeRef
      ? getInventoryRowUpgradeCostCrackedEggs(bonusRows)
      : null
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

async function ensureEquipmentSetsInTx(
  tx: DbTransaction,
  userId: string
): Promise<void> {
  await tx
    .insert(equipmentSets)
    .values({
      userId,
      setIndex: 0,
      label: 'Standard-Set',
      baseSlotCount: DEFAULT_EQUIPMENT_SET_BASE_SLOTS,
      bonusSlotCount: 0,
      selectedForEvent: false,
      upgradeRef: DEFAULT_EQUIPMENT_SET_UPGRADE_REF
    })
    .onConflictDoNothing({
      target: [equipmentSets.userId, equipmentSets.setIndex]
    });
}

async function getEquipmentSetBonusSlotCountInTx(
  tx: DbTransaction,
  userId: string
): Promise<number> {
  await ensureEquipmentSetsInTx(tx, userId);
  const [row] = await tx
    .select({
      bonusSlotCount: sql<number>`coalesce(max(${equipmentSets.bonusSlotCount}), 0)`
    })
    .from(equipmentSets)
    .where(eq(equipmentSets.userId, userId));
  return row?.bonusSlotCount ?? 0;
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

async function lockUserInventoryInTx(
  tx: DbTransaction,
  userId: string
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(
      hashtext('erwin_hatchery_user_inventory'),
      hashtext(${userId})
    )`
  );
}

async function findFreeEggSlotInTx(
  tx: DbTransaction,
  userId: string
): Promise<number | null> {
  const dimensions = await getDimensionsInTx(tx, userId, 'unhatched_eggs');
  const occupiedRows = await tx
    .select({ slotIndex: unhatchedEggs.slotIndex })
    .from(unhatchedEggs)
    .where(eq(unhatchedEggs.ownerUserId, userId));
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

async function findFreeConsumableSlotInTx(
  tx: DbTransaction,
  userId: string
): Promise<number | null> {
  const dimensions = await getDimensionsInTx(tx, userId, 'consumables');
  const occupiedRows = await tx
    .select({ slotIndex: consumableInventorySlots.slotIndex })
    .from(consumableInventorySlots)
    .where(eq(consumableInventorySlots.userId, userId));
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

async function findFreeEquipmentSlotInTx(
  tx: DbTransaction,
  userId: string
): Promise<number | null> {
  const dimensions = await getDimensionsInTx(tx, userId, 'equipment');
  const occupiedRows = await tx
    .select({ slotIndex: equipmentInventorySlots.slotIndex })
    .from(equipmentInventorySlots)
    .where(eq(equipmentInventorySlots.userId, userId));
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


async function findFreeConsumableSlotsInTx(
  tx: DbTransaction,
  userId: string,
  count: number
): Promise<number[]> {
  const dimensions = await getDimensionsInTx(tx, userId, 'consumables');
  const occupiedRows = await tx
    .select({ slotIndex: consumableInventorySlots.slotIndex })
    .from(consumableInventorySlots)
    .where(eq(consumableInventorySlots.userId, userId));
  const occupied = new Set(
    occupiedRows
      .map((row) => row.slotIndex)
      .filter((slotIndex): slotIndex is number => slotIndex !== null)
  );
  const freeSlots: number[] = [];
  for (let slotIndex = 0; slotIndex < dimensions.capacity; slotIndex += 1) {
    if (!occupied.has(slotIndex)) freeSlots.push(slotIndex);
    if (freeSlots.length >= count) return freeSlots;
  }
  return freeSlots;
}

async function findFreeEquipmentSlotsInTx(
  tx: DbTransaction,
  userId: string,
  count: number
): Promise<number[]> {
  const dimensions = await getDimensionsInTx(tx, userId, 'equipment');
  const occupiedRows = await tx
    .select({ slotIndex: equipmentInventorySlots.slotIndex })
    .from(equipmentInventorySlots)
    .where(eq(equipmentInventorySlots.userId, userId));
  const occupied = new Set(
    occupiedRows
      .map((row) => row.slotIndex)
      .filter((slotIndex): slotIndex is number => slotIndex !== null)
  );
  const freeSlots: number[] = [];
  for (let slotIndex = 0; slotIndex < dimensions.capacity; slotIndex += 1) {
    if (!occupied.has(slotIndex)) freeSlots.push(slotIndex);
    if (freeSlots.length >= count) return freeSlots;
  }
  return freeSlots;
}

type CreatedShopInventorySlot = { id: string; slotIndex: number };

class ShopInventoryFullError extends Error {
  constructor(readonly inventoryKind: 'equipment' | 'consumable') {
    super(`${inventoryKind}_inventory_full_after_preflight`);
  }
}

async function createConsumableShopSlotInTx(
  tx: DbTransaction,
  userId: string,
  consumableTypeId: string,
  now: Date
): Promise<CreatedShopInventorySlot | null> {
  const dimensions = await getDimensionsInTx(tx, userId, 'consumables');
  for (let slotIndex = 0; slotIndex < dimensions.capacity; slotIndex += 1) {
    const [existingSlot] = await tx
      .select({ id: consumableInventorySlots.id })
      .from(consumableInventorySlots)
      .where(
        and(
          eq(consumableInventorySlots.userId, userId),
          eq(consumableInventorySlots.slotIndex, slotIndex)
        )
      )
      .limit(1);
    if (existingSlot) continue;

    const [createdSlot] = await tx
      .insert(consumableInventorySlots)
      .values({
        userId,
        consumableTypeId,
        slotIndex,
        updatedAt: now
      })
      .returning({ id: consumableInventorySlots.id });
    if (createdSlot) return { id: createdSlot.id, slotIndex };
  }
  return null;
}

async function createEquipmentShopSlotInTx(
  tx: DbTransaction,
  userId: string,
  equipmentTypeId: string,
  now: Date
): Promise<CreatedShopInventorySlot | null> {
  const dimensions = await getDimensionsInTx(tx, userId, 'equipment');
  for (let slotIndex = 0; slotIndex < dimensions.capacity; slotIndex += 1) {
    const [existingSlot] = await tx
      .select({ id: equipmentInventorySlots.id })
      .from(equipmentInventorySlots)
      .where(
        and(
          eq(equipmentInventorySlots.userId, userId),
          eq(equipmentInventorySlots.slotIndex, slotIndex)
        )
      )
      .limit(1);
    if (existingSlot) continue;

    const [createdSlot] = await tx
      .insert(equipmentInventorySlots)
      .values({
        userId,
        equipmentTypeId,
        slotIndex,
        updatedAt: now
      })
      .returning({ id: equipmentInventorySlots.id });
    if (createdSlot) return { id: createdSlot.id, slotIndex };
  }
  return null;
}

type ShopWeek = {
  key: string;
  startsAt: Date;
  endsAt: Date;
};

type ShopCandidate = {
  kind: 'equipment' | 'consumable';
  typeId: string;
  displayName: string;
  description: string;
  resourcePrice: number;
  stock: number;
};

function getShopWeek(now = new Date()): ShopWeek {
  const day = now.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const startsAt = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysSinceMonday,
      0,
      0,
      0,
      0
    )
  );
  const endsAt = new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const key = startsAt.toISOString().slice(0, 10);
  return { key, startsAt, endsAt };
}

function deterministicShopRank(
  weekKey: string,
  candidate: ShopCandidate
): string {
  return createHash('sha256')
    .update(`${weekKey}:${candidate.kind}:${candidate.typeId}`)
    .digest('hex');
}

function pickWeeklyShopCandidates(
  candidates: ShopCandidate[],
  weekKey: string,
  count: number
): ShopCandidate[] {
  if (count <= 0) return [];
  return [...candidates]
    .sort((left, right) => {
      const leftRank = deterministicShopRank(weekKey, left);
      const rightRank = deterministicShopRank(weekKey, right);
      if (leftRank !== rightRank) return leftRank.localeCompare(rightRank);
      return left.typeId.localeCompare(right.typeId);
    })
    .slice(0, count);
}

async function loadWeeklyShopCandidatesInTx(
  tx: DbTransaction,
  weekKey: string
): Promise<ShopCandidate[]> {
  const equipmentRows = await tx
    .select({
      typeId: equipmentTypes.id,
      displayName: equipmentTypes.displayName,
      description: equipmentTypes.description,
      resourcePrice: equipmentTypes.resourcePrice,
      stock: equipmentTypes.stock
    })
    .from(equipmentTypes)
    .where(
      and(
        eq(equipmentTypes.isActive, true),
        eq(equipmentTypes.isShopPurchasable, true),
        eq(equipmentTypes.equipmentSlot, 'gem'),
        sql`${equipmentTypes.resourcePrice} > 0`,
        sql`${equipmentTypes.stock} > 0`
      )
    );
  const consumableRows = await tx
    .select({
      typeId: consumableTypes.id,
      displayName: consumableTypes.displayName,
      description: consumableTypes.description,
      resourcePrice: consumableTypes.resourcePrice,
      stock: consumableTypes.stock
    })
    .from(consumableTypes)
    .where(
      and(
        eq(consumableTypes.isActive, true),
        eq(consumableTypes.isShopPurchasable, true),
        sql`${consumableTypes.resourcePrice} > 0`,
        sql`${consumableTypes.stock} > 0`
      )
    );

  return [
    ...pickWeeklyShopCandidates(
      equipmentRows.map((row) => ({ ...row, kind: 'equipment' as const })),
      weekKey,
      config.SHOP_WEEKLY_EQUIPMENT_OFFER_COUNT
    ),
    ...pickWeeklyShopCandidates(
      consumableRows.map((row) => ({ ...row, kind: 'consumable' as const })),
      weekKey,
      config.SHOP_WEEKLY_CONSUMABLE_OFFER_COUNT
    )
  ];
}

async function countShopPurchasesThisWeekInTx(
  tx: DbTransaction,
  userId: string,
  weekKey: string,
  kind: 'equipment' | 'consumable',
  typeId: string
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(economyLedger)
    .where(
      and(
        eq(economyLedger.userId, userId),
        eq(economyLedger.eventType, SHOP_PURCHASE_LEDGER_EVENT_TYPE),
        eq(economyLedger.isReverted, false),
        sql`${economyLedger.delta}->>'shopWeekKey' = ${weekKey}`,
        sql`${economyLedger.delta}->>'itemKind' = ${kind}`,
        sql`${economyLedger.delta}->>'itemTypeId' = ${typeId}`
      )
    );
  return row?.count ?? 0;
}

async function buildShopOffersInTx(
  tx: DbTransaction,
  userId: string,
  now = new Date()
): Promise<ShopOffersPayload> {
  const week = getShopWeek(now);
  const candidates = await loadWeeklyShopCandidatesInTx(tx, week.key);
  const offers: ShopOfferItem[] = [];
  for (const candidate of candidates) {
    const purchasedThisWeek = await countShopPurchasesThisWeekInTx(
      tx,
      userId,
      week.key,
      candidate.kind,
      candidate.typeId
    );
    offers.push({
      ...candidate,
      purchasedThisWeek,
      remainingThisWeek: Math.max(0, candidate.stock - purchasedThisWeek)
    });
  }

  return {
    weekKey: week.key,
    weekStartsAt: week.startsAt.toISOString(),
    weekEndsAt: week.endsAt.toISOString(),
    currencyResourceType: CRACKED_EGGS_RESOURCE_TYPE,
    equipmentOfferCount: config.SHOP_WEEKLY_EQUIPMENT_OFFER_COUNT,
    consumableOfferCount: config.SHOP_WEEKLY_CONSUMABLE_OFFER_COUNT,
    offers
  };
}

async function loadShopOffers(userId: string): Promise<ShopOffersPayload> {
  return db.transaction((tx) => buildShopOffersInTx(tx, userId));
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
      specialBonusBasisPoints: incubatorSlots.specialBonusBasisPoints,
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
            specialBonusBasisPoints: runningJob.specialBonusBasisPoints,
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
  await db.transaction(async (tx) => ensureEquipmentSetsInTx(tx, userId));
  const [
    dimensionRows,
    mysteryEggs,
    unhatchedEggRows,
    petRows,
    consumableRows,
    equipmentSetRows,
    equipmentRows,
    hatRows,
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
        speciesId: pets.speciesId,
        speciesDisplayName: petSpecies.displayName,
        rarityId: pets.rarityId,
        rarityLabelDe: petRarities.labelDe,
        classId: pets.classId,
        classLabelDe: petClasses.labelDe,
        elementId: pets.elementId,
        elementLabelDe: elements.labelDe,
        abilityId: pets.abilityId,
        abilityLabelDe: petAbilities.labelDe,
        nickname: pets.nickname,
        baseHp: pets.baseHp,
        baseAtk: pets.baseAtk,
        baseDef: pets.baseDef,
        baseSpd: pets.baseSpd,
        baseGain: pets.baseGain,
        basePow: pets.basePow,
        experience: pets.experience,
        level: pets.level,
        isFavorite: pets.isFavorite,
        equippedHatId: pets.equippedHatId,
        selectedForEvent: pets.selectedForEvent,
        createdAt: pets.createdAt,
        slotIndex: pets.slotIndex
      })
      .from(pets)
      .innerJoin(petSpecies, eq(pets.speciesId, petSpecies.id))
      .innerJoin(petRarities, eq(pets.rarityId, petRarities.id))
      .innerJoin(petClasses, eq(pets.classId, petClasses.id))
      .innerJoin(elements, eq(pets.elementId, elements.id))
      .innerJoin(petAbilities, eq(pets.abilityId, petAbilities.id))
      .where(and(eq(pets.ownerUserId, userId), eq(pets.isScrapped, false))),
    db
      .select({
        id: consumableInventorySlots.id,
        consumableTypeId: consumableInventorySlots.consumableTypeId,
        slotIndex: consumableInventorySlots.slotIndex
      })
      .from(consumableInventorySlots)
      .where(eq(consumableInventorySlots.userId, userId)),
    db
      .select({
        id: equipmentSets.id,
        setIndex: equipmentSets.setIndex,
        label: equipmentSets.label,
        baseSlotCount: equipmentSets.baseSlotCount,
        bonusSlotCount: equipmentSets.bonusSlotCount,
        selectedForEvent: equipmentSets.selectedForEvent,
        upgradeRef: equipmentSets.upgradeRef
      })
      .from(equipmentSets)
      .where(eq(equipmentSets.userId, userId))
      .orderBy(equipmentSets.setIndex),
    db
      .select({
        id: equipmentInventorySlots.id,
        equipmentTypeId: equipmentInventorySlots.equipmentTypeId,
        slotIndex: equipmentInventorySlots.slotIndex,
        equipmentSetId: equipmentInventorySlots.equipmentSetId,
        equipmentSetSlotIndex: equipmentInventorySlots.equipmentSetSlotIndex
      })
      .from(equipmentInventorySlots)
      .where(eq(equipmentInventorySlots.userId, userId)),
    db
      .select({
        id: hatInventorySlots.id,
        hatId: hatInventorySlots.hatId,
        slotIndex: hatInventorySlots.slotIndex
      })
      .from(hatInventorySlots)
      .where(eq(hatInventorySlots.userId, userId)),
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
        specialBonusBasisPoints: incubatorSlots.specialBonusBasisPoints,
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
  const traitRows = petRows.length
    ? await db
        .select({
          petId: petTraitAssignments.petId,
          id: petTraits.id,
          labelDe: petTraits.labelDe,
          description: petTraits.description,
          hpModifier: petTraits.hpModifier,
          atkModifier: petTraits.atkModifier,
          defModifier: petTraits.defModifier,
          spdModifier: petTraits.spdModifier,
          gainModifier: petTraits.gainModifier,
          powModifier: petTraits.powModifier
        })
        .from(petTraitAssignments)
        .innerJoin(petTraits, eq(petTraitAssignments.traitId, petTraits.id))
        .where(
          inArray(
            petTraitAssignments.petId,
            petRows.map((row) => row.id)
          )
        )
    : [];
  const traitsByPetId = new Map<string, typeof traitRows>();
  for (const trait of traitRows) {
    const existingTraits = traitsByPetId.get(trait.petId) ?? [];
    existingTraits.push(trait);
    traitsByPetId.set(trait.petId, existingTraits);
  }

  const dimensionsByKind = new Map(
    dimensionRows.map((row) => [row.inventoryKind as InventoryKind, row])
  );
  const eggDimensions = dimensionsFromRow(
    'unhatched_eggs',
    dimensionsByKind.get('unhatched_eggs')
  );
  const petDimensions = dimensionsFromRow('pets', dimensionsByKind.get('pets'));
  const consumableDimensions = dimensionsFromRow(
    'consumables',
    dimensionsByKind.get('consumables')
  );
  const equipmentDimensions = dimensionsFromRow(
    'equipment',
    dimensionsByKind.get('equipment')
  );
  const hatDimensions = dimensionsFromRow('hats', dimensionsByKind.get('hats'));
  const jobsBySlot = new Map(jobRows.map((job) => [job.incubatorSlotId, job]));
  const equipmentSetBonusSlotCount = equipmentSetRows.reduce(
    (maxBonus, set) => Math.max(maxBonus, set.bonusSlotCount),
    0
  );
  const additionalEquipmentSetCount = Math.max(0, equipmentSetRows.length - 1);

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
            slotIndex: slot.slotIndex,
            isAvailable: slot.isAvailable,
            metadata: {
              speedMultiplierBasisPoints: slot.speedMultiplierBasisPoints,
              specialBonusBasisPoints: slot.specialBonusBasisPoints,
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
            speciesId: row.speciesId,
            speciesDisplayName: row.speciesDisplayName,
            rarityId: row.rarityId,
            rarityLabelDe: row.rarityLabelDe,
            classId: row.classId,
            classLabelDe: row.classLabelDe,
            elementId: row.elementId,
            elementLabelDe: row.elementLabelDe,
            abilityId: row.abilityId,
            abilityLabelDe: row.abilityLabelDe,
            nickname: row.nickname,
            baseHp: row.baseHp,
            baseAtk: row.baseAtk,
            baseDef: row.baseDef,
            baseSpd: row.baseSpd,
            baseGain: row.baseGain,
            basePow: row.basePow,
            experience: row.experience,
            level: row.level,
            isFavorite: row.isFavorite,
            equippedHatId: row.equippedHatId,
            traits: (traitsByPetId.get(row.id) ?? []).map(
              ({ petId: _petId, ...trait }) => trait
            ),
            selectedForEvent: row.selectedForEvent,
            createdAt: toIsoTimestamp(row.createdAt)
          }
        }))
      )
    },
    consumables: {
      dimensions: consumableDimensions,
      slots: cellsForGrid(
        consumableDimensions,
        consumableRows.map((row) => ({
          slotIndex: row.slotIndex,
          item: {
            id: row.id,
            consumableTypeId: row.consumableTypeId,
            quantity: 1
          }
        }))
      )
    },
    equipment: {
      dimensions: equipmentDimensions,
      slots: cellsForGrid(
        equipmentDimensions,
        equipmentRows
          .filter((row) => row.equipmentSetId === null)
          .map((row) => ({
            slotIndex: row.slotIndex,
            item: { id: row.id, equipmentTypeId: row.equipmentTypeId }
          }))
      )
    },
    equipmentSets: equipmentSetRows.map((set) => {
      const slotCount = set.baseSlotCount + set.bonusSlotCount;
      const bySlot = new Map<number, { id: string; equipmentTypeId: string }>();
      for (const row of equipmentRows) {
        if (row.equipmentSetId === set.id && row.equipmentSetSlotIndex !== null) {
          bySlot.set(row.equipmentSetSlotIndex, {
            id: row.id,
            equipmentTypeId: row.equipmentTypeId
          });
        }
      }
      return {
        id: set.id,
        setIndex: set.setIndex,
        label: set.label,
        baseSlotCount: set.baseSlotCount,
        bonusSlotCount: set.bonusSlotCount,
        slotCount,
        selectedForEvent: set.selectedForEvent,
        upgradeRef: set.upgradeRef,
        slots: Array.from({ length: slotCount }, (_, slotIndex) => ({
          slotIndex,
          item: bySlot.get(slotIndex) ?? null
        }))
      };
    }),
    equipmentSetUpgrades: {
      setCount: equipmentSetRows.length,
      setSlotBonusCount: equipmentSetBonusSlotCount,
      nextSlotUpgradeCostCrackedEggs: getEquipmentSetSlotUpgradeCostCrackedEggs(
        equipmentSetBonusSlotCount
      ),
      nextSetCostCrackedEggs: getAdditionalEquipmentSetCostCrackedEggs(
        additionalEquipmentSetCount
      )
    },
    hats: {
      dimensions: hatDimensions,
      slots: cellsForGrid(
        hatDimensions,
        hatRows.map((row) => ({
          slotIndex: row.slotIndex,
          item: { id: row.id, hatId: row.hatId }
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
    consumableStats,
    equipmentStats,
    equipmentSetStats,
    hatStats,
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
        updatedAt: sql<Date>`max(${consumableInventorySlots.updatedAt})`,
        slotSum: sql<number>`coalesce(sum(${consumableInventorySlots.slotIndex}), 0)`
      })
      .from(consumableInventorySlots)
      .where(eq(consumableInventorySlots.userId, userId)),
    db
      .select({
        count: sql<number>`count(*)`,
        updatedAt: sql<Date>`max(${equipmentInventorySlots.updatedAt})`,
        slotSum: sql<number>`coalesce(sum(${equipmentInventorySlots.slotIndex}), 0)`
      })
      .from(equipmentInventorySlots)
      .where(eq(equipmentInventorySlots.userId, userId)),
    db
      .select({
        count: sql<number>`count(*)`,
        updatedAt: sql<Date>`max(${equipmentSets.updatedAt})`,
        selectedSum: sql<number>`coalesce(sum(case when ${equipmentSets.selectedForEvent} then 1 else 0 end), 0)`,
        slotSum: sql<number>`coalesce(sum(${equipmentSets.baseSlotCount} + ${equipmentSets.bonusSlotCount}), 0)`
      })
      .from(equipmentSets)
      .where(eq(equipmentSets.userId, userId)),
    db
      .select({
        count: sql<number>`count(*)`,
        updatedAt: sql<Date>`max(${hatInventorySlots.updatedAt})`,
        slotSum: sql<number>`coalesce(sum(${hatInventorySlots.slotIndex}), 0)`
      })
      .from(hatInventorySlots)
      .where(eq(hatInventorySlots.userId, userId)),
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
    consumableStats[0]?.count ?? 0,
    consumableStats[0]?.slotSum ?? 0,
    consumableStats[0]?.updatedAt
      ? toIsoTimestamp(consumableStats[0].updatedAt)
      : '0',
    equipmentStats[0]?.count ?? 0,
    equipmentStats[0]?.slotSum ?? 0,
    equipmentStats[0]?.updatedAt
      ? toIsoTimestamp(equipmentStats[0].updatedAt)
      : '0',
    equipmentSetStats[0]?.count ?? 0,
    equipmentSetStats[0]?.slotSum ?? 0,
    equipmentSetStats[0]?.selectedSum ?? 0,
    equipmentSetStats[0]?.updatedAt
      ? toIsoTimestamp(equipmentSetStats[0].updatedAt)
      : '0',
    hatStats[0]?.count ?? 0,
    hatStats[0]?.slotSum ?? 0,
    hatStats[0]?.updatedAt ? toIsoTimestamp(hatStats[0].updatedAt) : '0',
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
      petName: petSpecies.displayName
    })
    .from(pets)
    .innerJoin(users, eq(pets.ownerUserId, users.id))
    .innerJoin(petSpecies, eq(pets.speciesId, petSpecies.id))
      .innerJoin(petRarities, eq(pets.rarityId, petRarities.id))
      .innerJoin(petClasses, eq(pets.classId, petClasses.id))
      .innerJoin(elements, eq(pets.elementId, elements.id))
      .innerJoin(petAbilities, eq(pets.abilityId, petAbilities.id))
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
            petName: petSpecies.displayName
          })
          .from(pets)
          .innerJoin(users, eq(pets.ownerUserId, users.id))
          .innerJoin(petSpecies, eq(pets.speciesId, petSpecies.id))
      .innerJoin(petRarities, eq(pets.rarityId, petRarities.id))
      .innerJoin(petClasses, eq(pets.classId, petClasses.id))
      .innerJoin(elements, eq(pets.elementId, elements.id))
      .innerJoin(petAbilities, eq(pets.abilityId, petAbilities.id))
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

  app.get('/api/game/shop', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    return { shop: await loadShopOffers(identity.userId) };
  });

  app.post('/api/game/shop/buy', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });

    const parsedBody = buyShopItemSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send({ message: 'Ungültiger Shop-Kauf.' });
    }
    const { kind, typeId } = parsedBody.data;

    const result = await db.transaction(async (tx) => {
      await lockUserInventoryInTx(tx, identity.userId);
      await ensureInventoryDimensionsInTx(tx, identity.userId);
      const shop = await buildShopOffersInTx(tx, identity.userId);
      const offer = shop.offers.find(
        (item) => item.kind === kind && item.typeId === typeId
      );
      if (!offer) return { kind: 'not_offered' as const };
      if (offer.remainingThisWeek <= 0) {
        return { kind: 'sold_out' as const, offer };
      }

      const freeSlot =
        kind === 'equipment'
          ? await findFreeEquipmentSlotInTx(tx, identity.userId)
          : await findFreeConsumableSlotInTx(tx, identity.userId);
      if (freeSlot === null) {
        return { kind: 'inventory_full' as const, inventoryKind: kind };
      }

      const now = new Date();
      const debitedResources = await tx
        .update(resources)
        .set({
          amount: sql`${resources.amount} - ${offer.resourcePrice}`,
          updatedAt: now
        })
        .where(
          and(
            eq(resources.userId, identity.userId),
            eq(resources.resourceType, CRACKED_EGGS_RESOURCE_TYPE),
            sql`${resources.amount} >= ${offer.resourcePrice}`
          )
        )
        .returning({ amount: resources.amount });

      if (debitedResources.length === 0) {
        return {
          kind: 'insufficient_resources' as const,
          cost: offer.resourcePrice
        };
      }

      if (kind === 'equipment') {
        const [createdSlot] = await tx
          .insert(equipmentInventorySlots)
          .values({
            userId: identity.userId,
            equipmentTypeId: typeId,
            slotIndex: freeSlot,
            updatedAt: now
          })
          .returning({ id: equipmentInventorySlots.id });
        await tx.insert(economyLedger).values({
          userId: identity.userId,
          actorUserId: identity.userId,
          eventType: SHOP_PURCHASE_LEDGER_EVENT_TYPE,
          sourceType: 'player_action',
          sourceId: createdSlot?.id ?? null,
          delta: {
            shopWeekKey: shop.weekKey,
            itemKind: kind,
            itemTypeId: typeId,
            equipmentInventorySlots: [
              {
                id: createdSlot?.id ?? null,
                equipmentTypeId: typeId,
                slotIndex: freeSlot,
                change: 1
              }
            ],
            resources: [
              {
                resourceType: CRACKED_EGGS_RESOURCE_TYPE,
                amountDelta: -offer.resourcePrice
              }
            ]
          }
        });
      } else {
        const [createdSlot] = await tx
          .insert(consumableInventorySlots)
          .values({
            userId: identity.userId,
            consumableTypeId: typeId,
            slotIndex: freeSlot,
            updatedAt: now
          })
          .returning({ id: consumableInventorySlots.id });
        await tx.insert(economyLedger).values({
          userId: identity.userId,
          actorUserId: identity.userId,
          eventType: SHOP_PURCHASE_LEDGER_EVENT_TYPE,
          sourceType: 'player_action',
          sourceId: createdSlot?.id ?? null,
          delta: {
            shopWeekKey: shop.weekKey,
            itemKind: kind,
            itemTypeId: typeId,
            consumableInventorySlots: [
              {
                id: createdSlot?.id ?? null,
                consumableTypeId: typeId,
                slotIndex: freeSlot,
                change: 1
              }
            ],
            resources: [
              {
                resourceType: CRACKED_EGGS_RESOURCE_TYPE,
                amountDelta: -offer.resourcePrice
              }
            ]
          }
        });
      }

      return { kind: 'ok' as const };
    });

    if (result.kind === 'not_offered') {
      return reply
        .code(404)
        .send({ message: 'Dieses Angebot ist diese Woche nicht im Shop.' });
    }
    if (result.kind === 'sold_out') {
      return reply.code(409).send({
        message: 'Dein Wochenbestand für dieses Angebot ist aufgebraucht.'
      });
    }
    if (result.kind === 'inventory_full') {
      return reply.code(409).send({
        message:
          result.inventoryKind === 'equipment'
            ? 'Dein Ausrüstungsinventar ist voll.'
            : 'Dein Verbrauchbaren-Inventar ist voll.'
      });
    }
    if (result.kind === 'insufficient_resources') {
      return reply.code(409).send({
        message: `Nicht genug Aufgebrochene Eier. Benötigt: ${result.cost}.`
      });
    }

    const [inventory, shop] = await Promise.all([
      loadPlayerInventory(identity.userId),
      loadShopOffers(identity.userId)
    ]);
    return { inventory, shop };
  });

  app.post('/api/game/shop/buy-batch', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });

    const parsedBody = buyShopItemsSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send({ message: 'Ungültiger Shop-Kauf.' });
    }
    const { items } = parsedBody.data;

    let result: {
      kind:
        | 'ok'
        | 'not_offered'
        | 'sold_out'
        | 'insufficient_resources';
      cost?: number;
    };
    try {
      result = await db.transaction(async (tx) => {
        await lockUserInventoryInTx(tx, identity.userId);
        await ensureInventoryDimensionsInTx(tx, identity.userId);
        const shop = await buildShopOffersInTx(tx, identity.userId);
        const requestedCounts = new Map<
          string,
          { item: (typeof items)[number]; count: number }
        >();
        for (const item of items) {
          const itemKey = `${item.kind}:${item.typeId}`;
          const existing = requestedCounts.get(itemKey);
          requestedCounts.set(itemKey, {
            item,
            count: (existing?.count ?? 0) + 1
          });
        }

        let totalCost = 0;
        const offerByItemKey = new Map<string, ShopOfferItem>();
        for (const [itemKey, request] of requestedCounts) {
          const offer = shop.offers.find(
            (candidate) =>
              candidate.kind === request.item.kind &&
              candidate.typeId === request.item.typeId
          );
          if (!offer) return { kind: 'not_offered' as const };
          if (offer.remainingThisWeek < request.count) {
            return { kind: 'sold_out' as const };
          }
          offerByItemKey.set(itemKey, offer);
          totalCost += offer.resourcePrice * request.count;
        }

        const now = new Date();
        const debitedResources = await tx
          .update(resources)
          .set({
            amount: sql`${resources.amount} - ${totalCost}`,
            updatedAt: now
          })
          .where(
            and(
              eq(resources.userId, identity.userId),
              eq(resources.resourceType, CRACKED_EGGS_RESOURCE_TYPE),
              sql`${resources.amount} >= ${totalCost}`
            )
          )
          .returning({ amount: resources.amount });

        if (debitedResources.length === 0) {
          return { kind: 'insufficient_resources' as const, cost: totalCost };
        }

        for (const item of items) {
          const offer = offerByItemKey.get(`${item.kind}:${item.typeId}`);
          if (!offer) {
            throw new Error('Validated shop offer missing during purchase');
          }

          if (item.kind === 'equipment') {
            const createdSlot = await createEquipmentShopSlotInTx(
              tx,
              identity.userId,
              item.typeId,
              now
            );
            if (!createdSlot) throw new ShopInventoryFullError('equipment');
            await tx.insert(economyLedger).values({
              userId: identity.userId,
              actorUserId: identity.userId,
              eventType: SHOP_PURCHASE_LEDGER_EVENT_TYPE,
              sourceType: 'player_action',
              sourceId: createdSlot.id,
              delta: {
                shopWeekKey: shop.weekKey,
                itemKind: item.kind,
                itemTypeId: item.typeId,
                equipmentInventorySlots: [
                  {
                    id: createdSlot.id,
                    equipmentTypeId: item.typeId,
                    slotIndex: createdSlot.slotIndex,
                    change: 1
                  }
                ],
                resources: [
                  {
                    resourceType: CRACKED_EGGS_RESOURCE_TYPE,
                    amountDelta: -offer.resourcePrice
                  }
                ]
              }
            });
          } else {
            const createdSlot = await createConsumableShopSlotInTx(
              tx,
              identity.userId,
              item.typeId,
              now
            );
            if (!createdSlot) throw new ShopInventoryFullError('consumable');
            await tx.insert(economyLedger).values({
              userId: identity.userId,
              actorUserId: identity.userId,
              eventType: SHOP_PURCHASE_LEDGER_EVENT_TYPE,
              sourceType: 'player_action',
              sourceId: createdSlot.id,
              delta: {
                shopWeekKey: shop.weekKey,
                itemKind: item.kind,
                itemTypeId: item.typeId,
                consumableInventorySlots: [
                  {
                    id: createdSlot.id,
                    consumableTypeId: item.typeId,
                    slotIndex: createdSlot.slotIndex,
                    change: 1
                  }
                ],
                resources: [
                  {
                    resourceType: CRACKED_EGGS_RESOURCE_TYPE,
                    amountDelta: -offer.resourcePrice
                  }
                ]
              }
            });
          }
        }

        return { kind: 'ok' as const };
      });
    } catch (error) {
      if (error instanceof ShopInventoryFullError) {
        return reply.code(409).send({
          message:
            error.inventoryKind === 'equipment'
              ? 'Dein Ausrüstungsinventar hat nicht genug freie Slots.'
              : 'Dein Verbrauchbaren-Inventar hat nicht genug freie Slots.'
        });
      }
      throw error;
    }

    if (result.kind === 'not_offered') {
      return reply
        .code(404)
        .send({ message: 'Mindestens ein Angebot ist diese Woche nicht im Shop.' });
    }
    if (result.kind === 'sold_out') {
      return reply.code(409).send({
        message: 'Der Wochenbestand für mindestens ein Angebot ist aufgebraucht.'
      });
    }
    if (result.kind === 'insufficient_resources') {
      return reply.code(409).send({
        message: `Nicht genug Aufgebrochene Eier. Benötigt: ${result.cost}.`
      });
    }

    const [inventory, shop] = await Promise.all([
      loadPlayerInventory(identity.userId),
      loadShopOffers(identity.userId)
    ]);
    return { inventory, shop };
  });

  app.get('/api/game/inventory', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    await ensureIncubatorSlots(identity.userId);
    const revision = await computeInventoryRevision(identity.userId);
    const inventory = await loadPlayerInventory(identity.userId);
    return { revision, inventory };
  });

  app.post('/api/game/inventory/upgrade-row', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });

    const body = (request.body ?? {}) as { inventoryKind?: unknown };
    if (typeof body.inventoryKind !== 'string') {
      return reply.code(400).send({ message: 'Inventar-Typ fehlt.' });
    }

    const requestedKind = body.inventoryKind as InventoryKind;
    if (
      !Object.prototype.hasOwnProperty.call(
        DEFAULT_INVENTORY_GRIDS,
        requestedKind
      )
    ) {
      return reply.code(400).send({ message: 'Unbekannter Inventar-Typ.' });
    }

    const result = await db.transaction(async (tx) => {
      await lockUserInventoryInTx(tx, identity.userId);
      await ensureInventoryDimensionsInTx(tx, identity.userId);

      const [dimension] = await tx
        .select({
          columns: inventoryDimensions.columns,
          baseRows: inventoryDimensions.baseRows,
          bonusRows: inventoryDimensions.bonusRows,
          upgradeRef: inventoryDimensions.upgradeRef
        })
        .from(inventoryDimensions)
        .where(
          and(
            eq(inventoryDimensions.userId, identity.userId),
            eq(inventoryDimensions.inventoryKind, requestedKind)
          )
        )
        .limit(1);

      const currentDimensions = dimensionsFromRow(
        requestedKind,
        dimension ?? null
      );
      if (!currentDimensions.upgradeRef) {
        return { kind: 'not_upgradeable' as const };
      }

      const cost = getInventoryRowUpgradeCostCrackedEggs(
        currentDimensions.bonusRows
      );
      const now = new Date();
      const debitedResources = await tx
        .update(resources)
        .set({
          amount: sql`${resources.amount} - ${cost}`,
          updatedAt: now
        })
        .where(
          and(
            eq(resources.userId, identity.userId),
            eq(resources.resourceType, CRACKED_EGGS_RESOURCE_TYPE),
            sql`${resources.amount} >= ${cost}`
          )
        )
        .returning({ amount: resources.amount });

      if (debitedResources.length === 0) {
        return { kind: 'insufficient_resources' as const, cost };
      }

      const [updatedDimensions] = await tx
        .update(inventoryDimensions)
        .set({
          bonusRows: currentDimensions.bonusRows + 1,
          updatedAt: now
        })
        .where(
          and(
            eq(inventoryDimensions.userId, identity.userId),
            eq(inventoryDimensions.inventoryKind, requestedKind)
          )
        )
        .returning({
          columns: inventoryDimensions.columns,
          baseRows: inventoryDimensions.baseRows,
          bonusRows: inventoryDimensions.bonusRows,
          upgradeRef: inventoryDimensions.upgradeRef
        });

      const nextDimensions = dimensionsFromRow(
        requestedKind,
        updatedDimensions ?? null
      );

      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'inventory_row_upgraded',
        sourceType: 'player_action',
        delta: {
          inventoryDimensions: [
            {
              inventoryKind: requestedKind,
              upgradeRef: currentDimensions.upgradeRef,
              columns: currentDimensions.columns,
              previousRows: currentDimensions.rows,
              newRows: nextDimensions.rows,
              previousBonusRows: currentDimensions.bonusRows,
              newBonusRows: nextDimensions.bonusRows,
              capacityDelta: currentDimensions.columns
            }
          ],
          resources: [
            {
              resourceType: CRACKED_EGGS_RESOURCE_TYPE,
              amountDelta: -cost
            }
          ]
        }
      });

      return { kind: 'ok' as const, dimensions: nextDimensions, cost };
    });

    if (result.kind === 'not_upgradeable') {
      return reply
        .code(400)
        .send({ message: 'Dieses Inventar kann nicht erweitert werden.' });
    }
    if (result.kind === 'insufficient_resources') {
      return reply.code(409).send({
        message: `Nicht genug Aufgebrochene Eier. Benötigt: ${result.cost}.`
      });
    }

    const inventory = await loadPlayerInventory(identity.userId);
    return { inventory };
  });

  app.post('/api/game/equipment-sets/upgrade-slots', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });

    const result = await db.transaction(async (tx) => {
      await lockUserInventoryInTx(tx, identity.userId);
      const currentBonusSlotCount = await getEquipmentSetBonusSlotCountInTx(
        tx,
        identity.userId
      );
      const cost = getEquipmentSetSlotUpgradeCostCrackedEggs(
        currentBonusSlotCount
      );
      const now = new Date();

      const debitedResources = await tx
        .update(resources)
        .set({ amount: sql`${resources.amount} - ${cost}`, updatedAt: now })
        .where(
          and(
            eq(resources.userId, identity.userId),
            eq(resources.resourceType, CRACKED_EGGS_RESOURCE_TYPE),
            sql`${resources.amount} >= ${cost}`
          )
        )
        .returning({ amount: resources.amount });

      if (debitedResources.length === 0) {
        return { kind: 'insufficient_resources' as const, cost };
      }

      const nextBonusSlotCount = currentBonusSlotCount + 1;
      const updatedSets = await tx
        .update(equipmentSets)
        .set({ bonusSlotCount: nextBonusSlotCount, updatedAt: now })
        .where(eq(equipmentSets.userId, identity.userId))
        .returning({
          id: equipmentSets.id,
          baseSlotCount: equipmentSets.baseSlotCount,
          bonusSlotCount: equipmentSets.bonusSlotCount
        });

      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'equipment_set_slots_upgraded',
        sourceType: 'player_action',
        delta: {
          equipmentSets: updatedSets.map((set) => ({
            id: set.id,
            upgradeRef: DEFAULT_EQUIPMENT_SET_UPGRADE_REF,
            previousSlotCount: set.baseSlotCount + currentBonusSlotCount,
            newSlotCount: set.baseSlotCount + set.bonusSlotCount,
            previousBonusSlotCount: currentBonusSlotCount,
            newBonusSlotCount: set.bonusSlotCount
          })),
          resources: [
            { resourceType: CRACKED_EGGS_RESOURCE_TYPE, amountDelta: -cost }
          ]
        }
      });

      return { kind: 'ok' as const };
    });

    if (result.kind === 'insufficient_resources') {
      return reply.code(409).send({
        message: `Nicht genug Aufgebrochene Eier. Benötigt: ${result.cost}.`
      });
    }

    const inventory = await loadPlayerInventory(identity.userId);
    return { inventory };
  });

  app.post('/api/game/equipment-sets/buy', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });

    const result = await db.transaction(async (tx) => {
      await lockUserInventoryInTx(tx, identity.userId);
      const currentBonusSlotCount = await getEquipmentSetBonusSlotCountInTx(
        tx,
        identity.userId
      );
      const existingSets = await tx
        .select({ setIndex: equipmentSets.setIndex })
        .from(equipmentSets)
        .where(eq(equipmentSets.userId, identity.userId));
      const additionalSetCount = Math.max(0, existingSets.length - 1);
      const cost = getAdditionalEquipmentSetCostCrackedEggs(additionalSetCount);
      const now = new Date();

      const debitedResources = await tx
        .update(resources)
        .set({ amount: sql`${resources.amount} - ${cost}`, updatedAt: now })
        .where(
          and(
            eq(resources.userId, identity.userId),
            eq(resources.resourceType, CRACKED_EGGS_RESOURCE_TYPE),
            sql`${resources.amount} >= ${cost}`
          )
        )
        .returning({ amount: resources.amount });

      if (debitedResources.length === 0) {
        return { kind: 'insufficient_resources' as const, cost };
      }

      const nextSetIndex = existingSets.reduce(
        (maxIndex, set) => Math.max(maxIndex, set.setIndex),
        -1
      ) + 1;
      const [createdSet] = await tx
        .insert(equipmentSets)
        .values({
          userId: identity.userId,
          setIndex: nextSetIndex,
          label: `Set ${nextSetIndex + 1}`,
          baseSlotCount: DEFAULT_EQUIPMENT_SET_BASE_SLOTS,
          bonusSlotCount: currentBonusSlotCount,
          selectedForEvent: false,
          upgradeRef: DEFAULT_EQUIPMENT_SET_UPGRADE_REF,
          updatedAt: now
        })
        .returning({
          id: equipmentSets.id,
          setIndex: equipmentSets.setIndex,
          label: equipmentSets.label,
          baseSlotCount: equipmentSets.baseSlotCount,
          bonusSlotCount: equipmentSets.bonusSlotCount
        });

      if (!createdSet) throw new Error('Failed to create equipment set');

      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'equipment_set_bought',
        sourceType: 'player_action',
        sourceId: createdSet.id,
        delta: {
          equipmentSets: [
            {
              id: createdSet.id,
              setIndex: createdSet.setIndex,
              label: createdSet.label,
              upgradeRef: ADDITIONAL_EQUIPMENT_SET_UPGRADE_REF,
              slotCount: createdSet.baseSlotCount + createdSet.bonusSlotCount
            }
          ],
          resources: [
            { resourceType: CRACKED_EGGS_RESOURCE_TYPE, amountDelta: -cost }
          ]
        }
      });

      return { kind: 'ok' as const };
    });

    if (result.kind === 'insufficient_resources') {
      return reply.code(409).send({
        message: `Nicht genug Aufgebrochene Eier. Benötigt: ${result.cost}.`
      });
    }

    const inventory = await loadPlayerInventory(identity.userId);
    return { inventory };
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

  app.post('/api/game/pets/:petId/favorite', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });

    const { petId } = request.params as { petId: string };
    const body = (request.body ?? {}) as { isFavorite?: boolean };
    if (typeof body.isFavorite !== 'boolean') {
      return reply.code(400).send({ message: 'isFavorite must be a boolean' });
    }

    const [updatedPet] = await db
      .update(pets)
      .set({ isFavorite: body.isFavorite })
      .where(
        and(
          eq(pets.id, petId),
          eq(pets.ownerUserId, identity.userId),
          eq(pets.isScrapped, false)
        )
      )
      .returning({ id: pets.id, isFavorite: pets.isFavorite });

    if (!updatedPet) {
      return reply.code(404).send({ message: 'Pet not found' });
    }

    return {
      status: 'ok',
      petId: updatedPet.id,
      isFavorite: updatedPet.isFavorite
    };
  });

  app.post('/api/game/pets/:petId/nickname', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });

    const { petId } = request.params as { petId: string };
    const body = (request.body ?? {}) as { nickname?: unknown };
    if (typeof body.nickname !== 'string') {
      return reply.code(400).send({ message: 'nickname must be a string' });
    }

    const trimmedNickname = body.nickname.trim();
    if (trimmedNickname.length > 32) {
      return reply.code(400).send({ message: 'Der Name darf maximal 32 Zeichen lang sein.' });
    }

    const nextNickname = trimmedNickname.length > 0 ? trimmedNickname : null;
    const result = await db.transaction(async (tx) => {
      const [ownedPet] = await tx
        .select({
          id: pets.id,
          speciesId: pets.speciesId,
          nickname: pets.nickname
        })
        .from(pets)
        .where(
          and(
            eq(pets.id, petId),
            eq(pets.ownerUserId, identity.userId),
            eq(pets.isScrapped, false)
          )
        )
        .limit(1);

      if (!ownedPet) return { kind: 'not_found' as const };

      const [updatedPet] = await tx
        .update(pets)
        .set({ nickname: nextNickname })
        .where(eq(pets.id, ownedPet.id))
        .returning({ id: pets.id, nickname: pets.nickname });

      if (!updatedPet) {
        throw new Error('Failed to update pet nickname');
      }

      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'pet_nickname_changed',
        sourceType: 'player_action',
        sourceId: ownedPet.id,
        delta: {
          pets: [
            {
              id: ownedPet.id,
              speciesId: ownedPet.speciesId,
              previousNickname: ownedPet.nickname,
              nickname: updatedPet.nickname
            }
          ],
          resources: []
        }
      });

      return { kind: 'ok' as const, pet: updatedPet };
    });

    if (result.kind === 'not_found') {
      return reply.code(404).send({ message: 'Pet not found' });
    }

    return {
      status: 'ok',
      petId: result.pet.id,
      nickname: result.pet.nickname
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
      await lockUserInventoryInTx(tx, identity.userId);

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
          petSpeciesId: eggLootTableEntries.petSpeciesId,
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

      if (picked.outcomeType === 'pet' && picked.petSpeciesId) {
        if (freeEggSlot === null)
          return { kind: 'unhatched_inventory_full' as const };
        const [egg] = await tx
          .insert(unhatchedEggs)
          .values({
            ownerUserId: identity.userId,
            eggTypeId: eggTypeId,
            hiddenPetSpeciesId: picked.petSpeciesId,
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
          specialBonusBasisPoints: incubatorSlots.specialBonusBasisPoints,
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
              specialBonusBasisPoints: slot.specialBonusBasisPoints,
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
          hiddenPetSpeciesId: unhatchedEggs.hiddenPetSpeciesId,
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

      const [petSpeciesRow] = await tx
        .select({
          id: petSpecies.id,
          defaultHp: petSpecies.defaultHp,
          defaultAtk: petSpecies.defaultAtk,
          defaultDef: petSpecies.defaultDef,
          defaultSpd: petSpecies.defaultSpd,
          defaultGain: petSpecies.defaultGain,
          defaultPow: petSpecies.defaultPow,
          rarityId: petSpecies.rarityId,
          classId: petSpecies.classId,
          elementId: petSpecies.elementId,
          defaultAbilityId: petSpecies.defaultAbilityId
        })
        .from(petSpecies)
        .where(eq(petSpecies.id, egg.hiddenPetSpeciesId))
        .limit(1);
      if (!petSpeciesRow) return { kind: 'pet_species_missing' as const };
      const completedAt = new Date();

      const [newPet] = await tx
        .insert(pets)
        .values({
          ownerUserId: identity.userId,
          speciesId: petSpeciesRow.id,
          rarityId: petSpeciesRow.rarityId,
          classId: petSpeciesRow.classId,
          elementId: petSpeciesRow.elementId,
          abilityId: petSpeciesRow.defaultAbilityId,
          baseHp: petSpeciesRow.defaultHp,
          baseAtk: petSpeciesRow.defaultAtk,
          baseDef: petSpeciesRow.defaultDef,
          baseSpd: petSpeciesRow.defaultSpd,
          baseGain: petSpeciesRow.defaultGain,
          basePow: petSpeciesRow.defaultPow,
          hatchVariance: { hp: 0, atk: 0, def: 0, spd: 0, gain: 0, pow: 0 },
          sourceUnhatchedEggId: egg.id,
          slotIndex: freePetSlot,
          createdAt: completedAt
        })
        .returning({ id: pets.id });

      await tx
        .update(incubationJobs)
        .set({ state: 'completed', completedAt })
        .where(eq(incubationJobs.id, job.id));
      await tx
        .update(unhatchedEggs)
        .set({ state: 'hatched' })
        .where(eq(unhatchedEggs.id, egg.id));
      const nextSlotAvailability = true;
      await tx
        .update(incubatorSlots)
        .set({ isAvailable: nextSlotAvailability, updatedAt: completedAt })
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
              speciesId: petSpeciesRow.id,
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
          speciesId: pets.speciesId,
          selectedForEvent: pets.selectedForEvent,
          isFavorite: pets.isFavorite,
          rarityId: pets.rarityId,
          recycleCrackedEggs: petRarities.recycleCrackedEggs
        })
        .from(pets)
        .innerJoin(petRarities, eq(pets.rarityId, petRarities.id))
        .where(
          and(
            eq(pets.id, body.petId!),
            eq(pets.ownerUserId, identity.userId),
            eq(pets.isScrapped, false)
          )
        )
        .limit(1);
      if (!pet) return { kind: 'not_found' as const };
      if (pet.isFavorite) return { kind: 'favorite_pet_protected' as const };

      const rewardAmount = pet.recycleCrackedEggs;
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
              speciesId: pet.speciesId,
              rarityId: pet.rarityId,
              isFavorite: pet.isFavorite,
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

    if (result.kind === 'favorite_pet_protected') {
      return reply.code(409).send({
        message: 'Favoriten können nicht recycelt werden. Entferne zuerst den Favoritenstatus.'
      });
    }
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


  app.post('/api/game/inventory/egg-slots/discard', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as {
      unhatchedEggId?: string;
      confirm?: boolean;
    };
    if (!body.unhatchedEggId || body.confirm !== true)
      return reply
        .code(400)
        .send({ message: 'unhatchedEggId and confirm=true are required' });

    const result = await db.transaction(async (tx) => {
      const [egg] = await tx
        .select({
          id: unhatchedEggs.id,
          eggTypeId: unhatchedEggs.eggTypeId,
          slotIndex: unhatchedEggs.slotIndex
        })
        .from(unhatchedEggs)
        .where(
          and(
            eq(unhatchedEggs.id, body.unhatchedEggId!),
            eq(unhatchedEggs.ownerUserId, identity.userId),
            eq(unhatchedEggs.state, 'ready_for_incubation')
          )
        )
        .limit(1);
      if (!egg) return { kind: 'not_found' as const };

      await tx.delete(unhatchedEggs).where(eq(unhatchedEggs.id, egg.id));
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'inventory_unhatched_egg_discarded',
        sourceType: 'player_action',
        sourceId: egg.id,
        delta: {
          unhatchedEggs: [
            {
              id: egg.id,
              eggTypeId: egg.eggTypeId,
              slotIndex: egg.slotIndex,
              change: -1
            }
          ],
          resources: []
        }
      });
      return { kind: 'ok' as const };
    });

    if (result.kind !== 'ok')
      return reply.code(404).send({ message: 'Ei nicht gefunden.' });
    return { ok: true };
  });


  app.post('/api/game/inventory/pet-slots/discard', async (request, reply) => {
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
          speciesId: pets.speciesId,
          slotIndex: pets.slotIndex,
          selectedForEvent: pets.selectedForEvent,
          isFavorite: pets.isFavorite
        })
        .from(pets)
        .where(
          and(
            eq(pets.id, body.petId!),
            eq(pets.ownerUserId, identity.userId),
            eq(pets.isScrapped, false)
          )
        )
        .limit(1);
      if (!pet) return { kind: 'not_found' as const };
      if (pet.isFavorite) return { kind: 'favorite_pet_protected' as const };

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
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'inventory_pet_discarded',
        sourceType: 'player_action',
        sourceId: pet.id,
        delta: {
          pets: [
            {
              id: pet.id,
              speciesId: pet.speciesId,
              slotIndex: pet.slotIndex,
              selectedForEvent: pet.selectedForEvent,
              isFavorite: pet.isFavorite,
              change: -1
            }
          ],
          resources: []
        }
      });
      return { kind: 'ok' as const };
    });

    if (result.kind === 'favorite_pet_protected') {
      return reply.code(409).send({
        message: 'Favoriten können nicht verworfen werden. Entferne zuerst den Favoritenstatus.'
      });
    }
    if (result.kind !== 'ok')
      return reply.code(404).send({ message: 'Pet nicht gefunden.' });
    return { ok: true };
  });

  app.post('/api/game/inventory/consumable-slots/discard', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as {
      consumableSlotId?: string;
      confirm?: boolean;
    };
    if (!body.consumableSlotId || body.confirm !== true)
      return reply
        .code(400)
        .send({ message: 'consumableSlotId and confirm=true are required' });

    const result = await db.transaction(async (tx) => {
      const [consumable] = await tx
        .select({
          id: consumableInventorySlots.id,
          consumableTypeId: consumableInventorySlots.consumableTypeId,
          slotIndex: consumableInventorySlots.slotIndex
        })
        .from(consumableInventorySlots)
        .where(
          and(
            eq(consumableInventorySlots.id, body.consumableSlotId!),
            eq(consumableInventorySlots.userId, identity.userId)
          )
        )
        .limit(1);
      if (!consumable) return { kind: 'not_found' as const };

      await tx
        .delete(consumableInventorySlots)
        .where(eq(consumableInventorySlots.id, consumable.id));
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'inventory_consumable_discarded',
        sourceType: 'player_action',
        sourceId: consumable.id,
        delta: {
          consumables: [
            {
              id: consumable.id,
              consumableTypeId: consumable.consumableTypeId,
              slotIndex: consumable.slotIndex,
              change: -1
            }
          ],
          resources: []
        }
      });
      return { kind: 'ok' as const };
    });

    if (result.kind !== 'ok')
      return reply.code(404).send({ message: 'Verbrauchbares nicht gefunden.' });
    return { ok: true };
  });

  app.post('/api/game/inventory/equipment-slots/discard', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as {
      equipmentSlotId?: string;
      confirm?: boolean;
    };
    if (!body.equipmentSlotId || body.confirm !== true)
      return reply
        .code(400)
        .send({ message: 'equipmentSlotId and confirm=true are required' });

    const result = await db.transaction(async (tx) => {
      const [equipment] = await tx
        .select({
          id: equipmentInventorySlots.id,
          equipmentTypeId: equipmentInventorySlots.equipmentTypeId,
          slotIndex: equipmentInventorySlots.slotIndex
        })
        .from(equipmentInventorySlots)
        .where(
          and(
            eq(equipmentInventorySlots.id, body.equipmentSlotId!),
            eq(equipmentInventorySlots.userId, identity.userId)
          )
        )
        .limit(1);
      if (!equipment) return { kind: 'not_found' as const };

      await tx
        .delete(equipmentInventorySlots)
        .where(eq(equipmentInventorySlots.id, equipment.id));
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'inventory_equipment_discarded',
        sourceType: 'player_action',
        sourceId: equipment.id,
        delta: {
          equipment: [
            {
              id: equipment.id,
              equipmentTypeId: equipment.equipmentTypeId,
              slotIndex: equipment.slotIndex,
              change: -1
            }
          ],
          resources: []
        }
      });
      return { kind: 'ok' as const };
    });

    if (result.kind !== 'ok')
      return reply.code(404).send({ message: 'Ausrüstung nicht gefunden.' });
    return { ok: true };
  });

  app.post('/api/game/inventory/hat-slots/discard', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as { hatSlotId?: string; confirm?: boolean };
    if (!body.hatSlotId || body.confirm !== true)
      return reply
        .code(400)
        .send({ message: 'hatSlotId and confirm=true are required' });

    const result = await db.transaction(async (tx) => {
      const [hat] = await tx
        .select({
          id: hatInventorySlots.id,
          hatId: hatInventorySlots.hatId,
          slotIndex: hatInventorySlots.slotIndex
        })
        .from(hatInventorySlots)
        .where(
          and(
            eq(hatInventorySlots.id, body.hatSlotId!),
            eq(hatInventorySlots.userId, identity.userId)
          )
        )
        .limit(1);
      if (!hat) return { kind: 'not_found' as const };

      await tx.delete(hatInventorySlots).where(eq(hatInventorySlots.id, hat.id));
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'inventory_hat_discarded',
        sourceType: 'player_action',
        sourceId: hat.id,
        delta: {
          hats: [
            {
              id: hat.id,
              hatId: hat.hatId,
              slotIndex: hat.slotIndex,
              change: -1
            }
          ],
          resources: []
        }
      });
      return { kind: 'ok' as const };
    });

    if (result.kind !== 'ok')
      return reply.code(404).send({ message: 'Hut nicht gefunden.' });
    return { ok: true };
  });

  app.post('/api/game/inventory/consumable-slots/move', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as {
      consumableSlotId?: string;
      toSlotIndex?: number;
    };
    if (!body.consumableSlotId || !Number.isInteger(body.toSlotIndex))
      return reply
        .code(400)
        .send({ message: 'consumableSlotId and toSlotIndex are required' });
    const toSlotIndex = body.toSlotIndex as number;
    const result = await db.transaction(async (tx) => {
      const dimensions = await getDimensionsInTx(
        tx,
        identity.userId,
        'consumables'
      );
      if (!isSlotInsideGrid(toSlotIndex, dimensions))
        return { kind: 'slot_out_of_bounds' as const };
      const [source] = await tx
        .select({
          id: consumableInventorySlots.id,
          slotIndex: consumableInventorySlots.slotIndex
        })
        .from(consumableInventorySlots)
        .where(
          and(
            eq(consumableInventorySlots.id, body.consumableSlotId!),
            eq(consumableInventorySlots.userId, identity.userId)
          )
        )
        .limit(1);
      if (!source || source.slotIndex === null)
        return { kind: 'not_found' as const };
      const [destination] = await tx
        .select({
          id: consumableInventorySlots.id,
          slotIndex: consumableInventorySlots.slotIndex
        })
        .from(consumableInventorySlots)
        .where(
          and(
            eq(consumableInventorySlots.userId, identity.userId),
            eq(consumableInventorySlots.slotIndex, toSlotIndex),
            not(eq(consumableInventorySlots.id, source.id))
          )
        )
        .limit(1);
      await tx
        .update(consumableInventorySlots)
        .set({ slotIndex: null, updatedAt: new Date() })
        .where(eq(consumableInventorySlots.id, source.id));
      if (destination)
        await tx
          .update(consumableInventorySlots)
          .set({ slotIndex: source.slotIndex, updatedAt: new Date() })
          .where(eq(consumableInventorySlots.id, destination.id));
      await tx
        .update(consumableInventorySlots)
        .set({ slotIndex: toSlotIndex, updatedAt: new Date() })
        .where(eq(consumableInventorySlots.id, source.id));
      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'inventory_consumable_slot_moved',
        sourceType: 'player_action',
        sourceId: source.id,
        delta: {
          consumableSlots: [
            {
              id: source.id,
              fromSlotIndex: source.slotIndex,
              toSlotIndex,
              swappedWithSlotId: destination?.id ?? null
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


  app.post('/api/game/equipment-sets/:setId/selection', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const { setId } = request.params as { setId: string };
    const body = (request.body ?? {}) as { selectedForEvent?: boolean };
    if (typeof body.selectedForEvent !== 'boolean')
      return reply.code(400).send({ message: 'selectedForEvent must be a boolean' });

    const result = await db.transaction(async (tx) => {
      await ensureEquipmentSetsInTx(tx, identity.userId);
      await lockUserInventoryInTx(tx, identity.userId);
      const [ownedSet] = await tx.select({ id: equipmentSets.id }).from(equipmentSets).where(and(eq(equipmentSets.id, setId), eq(equipmentSets.userId, identity.userId))).limit(1);
      if (!ownedSet) return { kind: 'not_found' as const };
      if (body.selectedForEvent) {
        await tx.update(equipmentSets).set({ selectedForEvent: false, updatedAt: new Date() }).where(and(eq(equipmentSets.userId, identity.userId), eq(equipmentSets.selectedForEvent, true)));
      }
      const [updatedSet] = await tx.update(equipmentSets).set({ selectedForEvent: body.selectedForEvent, updatedAt: new Date() }).where(eq(equipmentSets.id, ownedSet.id)).returning({ id: equipmentSets.id, selectedForEvent: equipmentSets.selectedForEvent });
      await tx.insert(economyLedger).values({ userId: identity.userId, actorUserId: identity.userId, eventType: 'inventory_equipment_set_selection_changed', sourceType: 'player_action', sourceId: ownedSet.id, delta: { equipmentSets: [{ id: ownedSet.id, selectedForEvent: body.selectedForEvent }] } });
      return { kind: 'ok' as const, set: updatedSet! };
    });
    if (result.kind === 'not_found') return reply.code(404).send({ message: 'Equipment set not found' });
    return { status: 'ok', setId: result.set.id, selectedForEvent: result.set.selectedForEvent };
  });

  app.post('/api/game/inventory/equipment-set-slots/move', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as { equipmentSlotId?: string; toEquipmentSetId?: string | null; toSetSlotIndex?: number | null; toSlotIndex?: number | null };
    if (!body.equipmentSlotId) return reply.code(400).send({ message: 'equipmentSlotId is required' });

    const result = await db.transaction(async (tx) => {
      await ensureEquipmentSetsInTx(tx, identity.userId);
      await lockUserInventoryInTx(tx, identity.userId);
      const [source] = await tx.select({ id: equipmentInventorySlots.id, slotIndex: equipmentInventorySlots.slotIndex, equipmentSetId: equipmentInventorySlots.equipmentSetId, equipmentSetSlotIndex: equipmentInventorySlots.equipmentSetSlotIndex }).from(equipmentInventorySlots).where(and(eq(equipmentInventorySlots.id, body.equipmentSlotId!), eq(equipmentInventorySlots.userId, identity.userId))).limit(1);
      if (!source) return { kind: 'not_found' as const };
      const now = new Date();

      if (body.toEquipmentSetId) {
        if (!Number.isInteger(body.toSetSlotIndex)) return { kind: 'slot_out_of_bounds' as const };
        const toSetSlotIndex = body.toSetSlotIndex as number;
        const [targetSet] = await tx.select({ id: equipmentSets.id, baseSlotCount: equipmentSets.baseSlotCount, bonusSlotCount: equipmentSets.bonusSlotCount }).from(equipmentSets).where(and(eq(equipmentSets.id, body.toEquipmentSetId), eq(equipmentSets.userId, identity.userId))).limit(1);
        if (!targetSet) return { kind: 'set_not_found' as const };
        const capacity = targetSet.baseSlotCount + targetSet.bonusSlotCount;
        if (toSetSlotIndex < 0 || toSetSlotIndex >= capacity) return { kind: 'slot_out_of_bounds' as const };
        const [destination] = await tx.select({ id: equipmentInventorySlots.id, slotIndex: equipmentInventorySlots.slotIndex, equipmentSetId: equipmentInventorySlots.equipmentSetId, equipmentSetSlotIndex: equipmentInventorySlots.equipmentSetSlotIndex }).from(equipmentInventorySlots).where(and(eq(equipmentInventorySlots.equipmentSetId, targetSet.id), eq(equipmentInventorySlots.equipmentSetSlotIndex, toSetSlotIndex), not(eq(equipmentInventorySlots.id, source.id)))).limit(1);
        await tx.update(equipmentInventorySlots).set({ slotIndex: null, equipmentSetId: null, equipmentSetSlotIndex: null, updatedAt: now }).where(eq(equipmentInventorySlots.id, source.id));
        if (destination) await tx.update(equipmentInventorySlots).set({ slotIndex: source.slotIndex, equipmentSetId: source.equipmentSetId, equipmentSetSlotIndex: source.equipmentSetSlotIndex, updatedAt: now }).where(eq(equipmentInventorySlots.id, destination.id));
        await tx.update(equipmentInventorySlots).set({ slotIndex: null, equipmentSetId: targetSet.id, equipmentSetSlotIndex: toSetSlotIndex, updatedAt: now }).where(eq(equipmentInventorySlots.id, source.id));
        await tx.insert(economyLedger).values({ userId: identity.userId, actorUserId: identity.userId, eventType: 'inventory_equipment_set_slot_moved', sourceType: 'player_action', sourceId: source.id, delta: { equipmentSlots: [{ id: source.id, fromSlotIndex: source.slotIndex, fromEquipmentSetId: source.equipmentSetId, fromSetSlotIndex: source.equipmentSetSlotIndex, toEquipmentSetId: targetSet.id, toSetSlotIndex, swappedWithSlotId: destination?.id ?? null }] } });
        return { kind: 'ok' as const };
      }

      if (!Number.isInteger(body.toSlotIndex)) return { kind: 'slot_out_of_bounds' as const };
      const toSlotIndex = body.toSlotIndex as number;
      const dimensions = await getDimensionsInTx(tx, identity.userId, 'equipment');
      if (!isSlotInsideGrid(toSlotIndex, dimensions)) return { kind: 'slot_out_of_bounds' as const };
      const [destination] = await tx.select({ id: equipmentInventorySlots.id, slotIndex: equipmentInventorySlots.slotIndex, equipmentSetId: equipmentInventorySlots.equipmentSetId, equipmentSetSlotIndex: equipmentInventorySlots.equipmentSetSlotIndex }).from(equipmentInventorySlots).where(and(eq(equipmentInventorySlots.userId, identity.userId), eq(equipmentInventorySlots.slotIndex, toSlotIndex), isNull(equipmentInventorySlots.equipmentSetId), not(eq(equipmentInventorySlots.id, source.id)))).limit(1);
      await tx.update(equipmentInventorySlots).set({ slotIndex: null, equipmentSetId: null, equipmentSetSlotIndex: null, updatedAt: now }).where(eq(equipmentInventorySlots.id, source.id));
      if (destination) await tx.update(equipmentInventorySlots).set({ slotIndex: null, equipmentSetId: source.equipmentSetId, equipmentSetSlotIndex: source.equipmentSetSlotIndex, updatedAt: now }).where(eq(equipmentInventorySlots.id, destination.id));
      await tx.update(equipmentInventorySlots).set({ slotIndex: toSlotIndex, equipmentSetId: null, equipmentSetSlotIndex: null, updatedAt: now }).where(eq(equipmentInventorySlots.id, source.id));
      await tx.insert(economyLedger).values({ userId: identity.userId, actorUserId: identity.userId, eventType: 'inventory_equipment_set_slot_moved', sourceType: 'player_action', sourceId: source.id, delta: { equipmentSlots: [{ id: source.id, fromSlotIndex: source.slotIndex, fromEquipmentSetId: source.equipmentSetId, fromSetSlotIndex: source.equipmentSetSlotIndex, toSlotIndex, swappedWithSlotId: destination?.id ?? null }] } });
      return { kind: 'ok' as const };
    });
    if (result.kind !== 'ok') return reply.code(409).send({ message: result.kind });
    return { ok: true };
  });

  app.post('/api/game/inventory/equipment-slots/move', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as { equipmentSlotId?: string; toSlotIndex?: number };
    if (!body.equipmentSlotId || !Number.isInteger(body.toSlotIndex))
      return reply.code(400).send({ message: 'equipmentSlotId and toSlotIndex are required' });
    const toSlotIndex = body.toSlotIndex as number;
    const result = await db.transaction(async (tx) => {
      await lockUserInventoryInTx(tx, identity.userId);
      const dimensions = await getDimensionsInTx(tx, identity.userId, 'equipment');
      if (!isSlotInsideGrid(toSlotIndex, dimensions)) return { kind: 'slot_out_of_bounds' as const };
      const [source] = await tx.select({ id: equipmentInventorySlots.id, slotIndex: equipmentInventorySlots.slotIndex }).from(equipmentInventorySlots).where(and(eq(equipmentInventorySlots.id, body.equipmentSlotId!), eq(equipmentInventorySlots.userId, identity.userId), isNull(equipmentInventorySlots.equipmentSetId))).limit(1);
      if (!source || source.slotIndex === null) return { kind: 'not_found' as const };
      const [destination] = await tx.select({ id: equipmentInventorySlots.id, slotIndex: equipmentInventorySlots.slotIndex }).from(equipmentInventorySlots).where(and(eq(equipmentInventorySlots.userId, identity.userId), eq(equipmentInventorySlots.slotIndex, toSlotIndex), isNull(equipmentInventorySlots.equipmentSetId), not(eq(equipmentInventorySlots.id, source.id)))).limit(1);
      await tx.update(equipmentInventorySlots).set({ slotIndex: null, updatedAt: new Date() }).where(eq(equipmentInventorySlots.id, source.id));
      if (destination) await tx.update(equipmentInventorySlots).set({ slotIndex: source.slotIndex, updatedAt: new Date() }).where(eq(equipmentInventorySlots.id, destination.id));
      await tx.update(equipmentInventorySlots).set({ slotIndex: toSlotIndex, updatedAt: new Date() }).where(eq(equipmentInventorySlots.id, source.id));
      await tx.insert(economyLedger).values({ userId: identity.userId, actorUserId: identity.userId, eventType: 'inventory_equipment_slot_moved', sourceType: 'player_action', sourceId: source.id, delta: { equipmentSlots: [{ id: source.id, fromSlotIndex: source.slotIndex, toSlotIndex, swappedWithSlotId: destination?.id ?? null }] } });
      return { kind: 'ok' as const };
    });
    if (result.kind !== 'ok') return reply.code(409).send({ message: result.kind });
    return { ok: true };
  });

  app.post('/api/game/inventory/hat-slots/move', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const body = (request.body ?? {}) as { hatSlotId?: string; toSlotIndex?: number };
    if (!body.hatSlotId || !Number.isInteger(body.toSlotIndex))
      return reply.code(400).send({ message: 'hatSlotId and toSlotIndex are required' });
    const toSlotIndex = body.toSlotIndex as number;
    const result = await db.transaction(async (tx) => {
      const dimensions = await getDimensionsInTx(tx, identity.userId, 'hats');
      if (!isSlotInsideGrid(toSlotIndex, dimensions)) return { kind: 'slot_out_of_bounds' as const };
      const [source] = await tx.select({ id: hatInventorySlots.id, slotIndex: hatInventorySlots.slotIndex }).from(hatInventorySlots).where(and(eq(hatInventorySlots.id, body.hatSlotId!), eq(hatInventorySlots.userId, identity.userId))).limit(1);
      if (!source || source.slotIndex === null) return { kind: 'not_found' as const };
      const [destination] = await tx.select({ id: hatInventorySlots.id, slotIndex: hatInventorySlots.slotIndex }).from(hatInventorySlots).where(and(eq(hatInventorySlots.userId, identity.userId), eq(hatInventorySlots.slotIndex, toSlotIndex), not(eq(hatInventorySlots.id, source.id)))).limit(1);
      await tx.update(hatInventorySlots).set({ slotIndex: null, updatedAt: new Date() }).where(eq(hatInventorySlots.id, source.id));
      if (destination) await tx.update(hatInventorySlots).set({ slotIndex: source.slotIndex, updatedAt: new Date() }).where(eq(hatInventorySlots.id, destination.id));
      await tx.update(hatInventorySlots).set({ slotIndex: toSlotIndex, updatedAt: new Date() }).where(eq(hatInventorySlots.id, source.id));
      await tx.insert(economyLedger).values({ userId: identity.userId, actorUserId: identity.userId, eventType: 'inventory_hat_slot_moved', sourceType: 'player_action', sourceId: source.id, delta: { hatSlots: [{ id: source.id, fromSlotIndex: source.slotIndex, toSlotIndex, swappedWithSlotId: destination?.id ?? null }] } });
      return { kind: 'ok' as const };
    });
    if (result.kind !== 'ok') return reply.code(409).send({ message: result.kind });
    return { ok: true };
  });

  app.post('/api/game/inventory/item-slots/move', async (_request, reply) => {
    return reply.code(410).send({
      message: 'Item slots were split into consumable, equipment, and hat inventories.'
    });
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

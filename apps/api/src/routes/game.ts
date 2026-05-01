import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { consumableInventory, economyLedger, eggLootTableEntries, unhatchedEggs, mysteryEggInventory, pets, resources } from '../db/schema.js';
import { getSessionIdentity } from './session-auth.js';

type PlayerInventory = {
  mysteryEggs: Array<{ eggTypeId: string; amount: number; updatedAt: string }>;
  unhatchedEggs: Array<{ id: string; eggTypeId: string; state: string }>;
  hatchedPets: Array<{ id: string; petTypeId: string; createdAt: string }>;
  consumables: Array<{ consumableTypeId: string; amount: number }>;
  crackedEggResources: Array<{ resourceType: string; amount: number; updatedAt: string }>;
};

function toIsoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
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
  const [mysteryEggs, unhatchedEggRows, petRows, consumableRows, resourceRows] = await Promise.all([
    db.select({ eggTypeId: mysteryEggInventory.eggTypeId, amount: mysteryEggInventory.amount, updatedAt: mysteryEggInventory.updatedAt }).from(mysteryEggInventory).where(eq(mysteryEggInventory.userId, userId)),
    db.select({ id: unhatchedEggs.id, eggTypeId: unhatchedEggs.eggTypeId, state: unhatchedEggs.state }).from(unhatchedEggs).where(eq(unhatchedEggs.ownerUserId, userId)),
    db.select({ id: pets.id, petTypeId: pets.petTypeId, createdAt: pets.createdAt }).from(pets).where(eq(pets.ownerUserId, userId)),
    db.select({ consumableTypeId: consumableInventory.consumableTypeId, amount: consumableInventory.amount }).from(consumableInventory).where(eq(consumableInventory.userId, userId)),
    db.select({ resourceType: resources.resourceType, amount: resources.amount, updatedAt: resources.updatedAt }).from(resources).where(eq(resources.userId, userId))
  ]);

  return {
    mysteryEggs: mysteryEggs.map((row) => ({ ...row, updatedAt: toIsoTimestamp(row.updatedAt) })),
    unhatchedEggs: unhatchedEggRows,
    hatchedPets: petRows.map((row) => ({ ...row, createdAt: toIsoTimestamp(row.createdAt) })),
    consumables: consumableRows,
    crackedEggResources: resourceRows.map((row) => ({ ...row, updatedAt: toIsoTimestamp(row.updatedAt) }))
  };
}

async function computeInventoryRevision(userId: string): Promise<string> {
  const [invMax, resourceMax, petMax] = await Promise.all([
    db.select({ updatedAt: sql<Date>`max(${mysteryEggInventory.updatedAt})` }).from(mysteryEggInventory).where(eq(mysteryEggInventory.userId, userId)),
    db.select({ updatedAt: sql<Date>`max(${resources.updatedAt})` }).from(resources).where(eq(resources.userId, userId)),
    db.select({ createdAt: sql<Date>`max(${pets.createdAt})` }).from(pets).where(eq(pets.ownerUserId, userId))
  ]);
  const payload = `${invMax[0]?.updatedAt ? toIsoTimestamp(invMax[0].updatedAt) : '0'}|${resourceMax[0]?.updatedAt ? toIsoTimestamp(resourceMax[0].updatedAt) : '0'}|${petMax[0]?.createdAt ? toIsoTimestamp(petMax[0].createdAt) : '0'}`;
  return createHash('sha1').update(payload).digest('hex');
}

export async function registerGameRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/game/inventory', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });
    const revision = await computeInventoryRevision(identity.userId);
    const inventory = await loadPlayerInventory(identity.userId);
    return { revision, inventory };
  });


  app.post('/api/game/mystery-eggs/identify', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });

    const body = (request.body ?? {}) as { eggTypeId?: string };
    if (!body.eggTypeId) {
      return reply.code(400).send({ message: 'eggTypeId is required' });
    }

    const result = await db.transaction(async (tx) => {
      const [inventoryRow] = await tx
        .select({ amount: mysteryEggInventory.amount })
        .from(mysteryEggInventory)
        .where(and(eq(mysteryEggInventory.userId, identity.userId), eq(mysteryEggInventory.eggTypeId, body.eggTypeId!)))
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
        .where(and(eq(eggLootTableEntries.eggTypeId, body.eggTypeId), eq(eggLootTableEntries.isActive, true), sql`${eggLootTableEntries.weight} > 0`));

      if (entries.length === 0) {
        throw new Error(`No active loot table entries for egg type ${body.eggTypeId}`);
      }

      const picked = pickWeightedOutcome(entries);

      await tx
        .update(mysteryEggInventory)
        .set({ amount: sql`greatest(${mysteryEggInventory.amount} - 1, 0)`, updatedAt: new Date() })
        .where(and(eq(mysteryEggInventory.userId, identity.userId), eq(mysteryEggInventory.eggTypeId, body.eggTypeId!)));

      if (picked.outcomeType === 'pet' && picked.petTypeId) {
        const [egg] = await tx.insert(unhatchedEggs).values({
          ownerUserId: identity.userId,
          eggTypeId: body.eggTypeId,
          hiddenPetTypeId: picked.petTypeId,
          state: 'ready_for_incubation'
        }).returning({ id: unhatchedEggs.id });

        await tx.insert(economyLedger).values({
          userId: identity.userId,
          actorUserId: identity.userId,
          eventType: 'mystery_egg_identified_to_unhatched_egg',
          sourceType: 'player_action',
          sourceId: egg?.id ?? null,
          delta: { mysteryEggInventory: [{ eggTypeId: body.eggTypeId, amountDelta: -1 }], unhatchedEggs: [{ eggTypeId: body.eggTypeId, amountDelta: 1 }] }
        });

        return { kind: 'unhatched_egg' as const };
      }

      const resourceAmount = picked.resourceAmount ?? 0;
      if (!picked.resourceType || resourceAmount <= 0) {
        throw new Error(`Loot table entry for ${body.eggTypeId} is invalid`);
      }

      await tx.insert(resources).values({
        userId: identity.userId,
        resourceType: picked.resourceType,
        amount: resourceAmount,
        updatedAt: new Date()
      }).onConflictDoUpdate({
        target: [resources.userId, resources.resourceType],
        set: { amount: sql`${resources.amount} + ${resourceAmount}`, updatedAt: new Date() }
      });

      await tx.insert(economyLedger).values({
        userId: identity.userId,
        actorUserId: identity.userId,
        eventType: 'mystery_egg_identified_to_egg_resources',
        sourceType: 'player_action',
        delta: {
          mysteryEggInventory: [{ eggTypeId: body.eggTypeId, amountDelta: -1 }],
          resources: [{ resourceType: picked.resourceType, amountDelta: resourceAmount }]
        }
      });

      return { kind: 'resources' as const };
    });

    if (result.kind === 'none') {
      return reply.code(409).send({ message: 'No mystery egg of this type available' });
    }

    return { ok: true, result: result.kind };
  });

  app.get('/api/game/inventory/stream', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ message: 'Unauthorized' });

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

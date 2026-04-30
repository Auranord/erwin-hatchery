import { db, pool } from './client.js';
import { eq } from 'drizzle-orm';
import { eggLootTableEntries, eggTypes, petTypes } from './schema.js';

async function seed(): Promise<void> {
  await db.insert(eggTypes).values([
    {
      id: 'mystery_egg',
      displayName: 'Mystery Ei',
      baseIncubationSeconds: 14400,
      isActive: true
    }
  ]).onConflictDoUpdate({
    target: eggTypes.id,
    set: {
      displayName: 'Mystery Ei',
      baseIncubationSeconds: 14400,
      isActive: true
    }
  });

  await db.insert(petTypes).values([
    {
      id: 'slime_scout',
      displayName: 'Schleim-Scout',
      rarity: 'common',
      role: 'scout',
      baseHp: 60,
      baseAttack: 12,
      baseDefense: 8,
      baseSpeed: 15,
      assetKey: 'pet_slime_scout',
      isActive: true
    },
    {
      id: 'ember_fox',
      displayName: 'Glutfuchs',
      rarity: 'rare',
      role: 'striker',
      baseHp: 72,
      baseAttack: 16,
      baseDefense: 10,
      baseSpeed: 17,
      assetKey: 'pet_ember_fox',
      isActive: true
    },
    {
      id: 'aegis_turtle',
      displayName: 'Aegis-Schildkröte',
      rarity: 'epic',
      role: 'tank',
      baseHp: 95,
      baseAttack: 10,
      baseDefense: 20,
      baseSpeed: 7,
      assetKey: 'pet_aegis_turtle',
      isActive: true
    }
  ]).onConflictDoUpdate({
    target: petTypes.id,
    set: {
      isActive: true
    }
  });

  await db.delete(eggLootTableEntries).where(eq(eggLootTableEntries.eggTypeId, 'mystery_egg'));

  await db.insert(eggLootTableEntries).values([
    {
      eggTypeId: 'mystery_egg',
      weight: 70,
      outcomeType: 'pet',
      petTypeId: 'slime_scout',
      isActive: true
    },
    {
      eggTypeId: 'mystery_egg',
      weight: 23,
      outcomeType: 'pet',
      petTypeId: 'ember_fox',
      isActive: true
    },
    {
      eggTypeId: 'mystery_egg',
      weight: 7,
      outcomeType: 'pet',
      petTypeId: 'aegis_turtle',
      isActive: true
    }
  ]);

  console.info('Seed completed for egg types, pet types, and loot table.');
}

void seed()
  .catch((error: unknown) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

import { db, pool } from './client.js';
import { inArray, sql } from 'drizzle-orm';
import { eggLootTableEntries, eggTypes, petTypes } from './schema.js';

const SEEDED_EGG_TYPE_IDS = ['common_mystery_egg', 'uncommon_mystery_egg', 'rare_mystery_egg'] as const;

const BASE_LOOT_ENTRIES = [
  { weight: 2800, outcomeType: 'resource', resourceType: 'cracked_eggs', resourceAmount: 10 },
  { weight: 2200, outcomeType: 'resource', resourceType: 'cracked_eggs', resourceAmount: 20 },
  { weight: 1200, outcomeType: 'resource', resourceType: 'cracked_eggs', resourceAmount: 35 },
  { weight: 600, outcomeType: 'resource', resourceType: 'cracked_eggs', resourceAmount: 60 },
  { weight: 800, outcomeType: 'pet', petTypeId: 'waldwachtel' },
  { weight: 800, outcomeType: 'pet', petTypeId: 'glitzer_spatz' },
  { weight: 700, outcomeType: 'pet', petTypeId: 'moorente' },
  { weight: 700, outcomeType: 'pet', petTypeId: 'turmeule' },
  { weight: 200, outcomeType: 'pet', petTypeId: 'goldener_erwin' }
] as const;

async function seed(): Promise<void> {
  await db.insert(eggTypes).values([
    { id: 'common_mystery_egg', displayName: 'Gewöhnliches Mystery Ei', baseIncubationSeconds: 14400, twitchRewardCost: 1000, twitchRewardBackgroundColor: '#9147ff', twitchRewardGlobalCooldownMinutes: 0, twitchRewardMaxPerStream: 0, twitchRewardMaxPerUserPerStream: 1, isActive: true },
    { id: 'uncommon_mystery_egg', displayName: 'Ungewöhnliches Mystery Ei', baseIncubationSeconds: 21600, twitchRewardCost: 2500, twitchRewardBackgroundColor: '#9147ff', twitchRewardGlobalCooldownMinutes: 0, twitchRewardMaxPerStream: 0, twitchRewardMaxPerUserPerStream: 1, isActive: true },
    { id: 'rare_mystery_egg', displayName: 'Seltenes Mystery Ei', baseIncubationSeconds: 28800, twitchRewardCost: 5000, twitchRewardBackgroundColor: '#9147ff', twitchRewardGlobalCooldownMinutes: 0, twitchRewardMaxPerStream: 0, twitchRewardMaxPerUserPerStream: 1, isActive: true }
  ]).onConflictDoUpdate({
    target: eggTypes.id,
    set: {
      displayName: sql`excluded.display_name`,
      baseIncubationSeconds: sql`excluded.base_incubation_seconds`,
      twitchRewardCost: sql`coalesce(excluded.twitch_reward_cost, ${eggTypes.twitchRewardCost})`,
      twitchRewardBackgroundColor: sql`coalesce(excluded.twitch_reward_background_color, ${eggTypes.twitchRewardBackgroundColor})`,
      twitchRewardGlobalCooldownMinutes: sql`coalesce(excluded.twitch_reward_global_cooldown_minutes, ${eggTypes.twitchRewardGlobalCooldownMinutes})`,
      twitchRewardMaxPerStream: sql`coalesce(excluded.twitch_reward_max_per_stream, ${eggTypes.twitchRewardMaxPerStream})`,
      twitchRewardMaxPerUserPerStream: sql`coalesce(excluded.twitch_reward_max_per_user_per_stream, ${eggTypes.twitchRewardMaxPerUserPerStream})`,
      isActive: true
    }
  });

  await db.insert(petTypes).values([
    { id: 'waldwachtel', displayName: 'Waldwachtel', rarity: 'regular', role: 'balanced', baseHp: 100, baseAttack: 10, baseDefense: 8, baseSpeed: 12, assetKey: 'pet_waldwachtel', isActive: true },
    { id: 'glitzer_spatz', displayName: 'Glitzer-Spatz', rarity: 'regular', role: 'fast', baseHp: 80, baseAttack: 8, baseDefense: 5, baseSpeed: 18, assetKey: 'pet_glitzer_spatz', isActive: true },
    { id: 'moorente', displayName: 'Moorente', rarity: 'regular', role: 'tank', baseHp: 120, baseAttack: 7, baseDefense: 12, baseSpeed: 7, assetKey: 'pet_moorente', isActive: true },
    { id: 'turmeule', displayName: 'Turmeule', rarity: 'regular', role: 'striker', baseHp: 90, baseAttack: 14, baseDefense: 7, baseSpeed: 10, assetKey: 'pet_turmeule', isActive: true },
    { id: 'goldener_erwin', displayName: 'Goldener Erwin', rarity: 'rare', role: 'allrounder', baseHp: 110, baseAttack: 13, baseDefense: 10, baseSpeed: 13, assetKey: 'pet_goldener_erwin', isActive: true }
  ]).onConflictDoUpdate({
    target: petTypes.id,
    set: { isActive: true }
  });

  await db.delete(eggLootTableEntries).where(inArray(eggLootTableEntries.eggTypeId, [...SEEDED_EGG_TYPE_IDS]));

  await db.insert(eggLootTableEntries).values(
    SEEDED_EGG_TYPE_IDS.flatMap((eggTypeId) =>
      BASE_LOOT_ENTRIES.map((entry) => ({
        eggTypeId,
        weight: entry.weight,
        outcomeType: entry.outcomeType,
        resourceType: 'resourceType' in entry ? entry.resourceType : null,
        resourceAmount: 'resourceAmount' in entry ? entry.resourceAmount : null,
        petTypeId: 'petTypeId' in entry ? entry.petTypeId : null,
        isActive: true
      }))
    )
  );

  console.info('Seed completed for egg types, pet types, and loot tables.');
}

void seed()
  .catch((error: unknown) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

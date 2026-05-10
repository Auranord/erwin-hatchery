import { db, pool } from './client.js';
import { inArray, sql } from 'drizzle-orm';
import {
  eggLootTableEntries,
  eggTypes,
  elements,
  hats,
  petAbilities,
  petClasses,
  petRarities,
  petSpecies,
  petTraits
} from './schema.js';

const SEEDED_EGG_TYPE_IDS = ['common_mystery_egg', 'uncommon_mystery_egg', 'rare_mystery_egg'] as const;

const BASE_LOOT_ENTRIES = [
  { weight: 2800, outcomeType: 'resource', resourceType: 'cracked_eggs', resourceAmount: 10 },
  { weight: 2200, outcomeType: 'resource', resourceType: 'cracked_eggs', resourceAmount: 20 },
  { weight: 1200, outcomeType: 'resource', resourceType: 'cracked_eggs', resourceAmount: 35 },
  { weight: 600, outcomeType: 'resource', resourceType: 'cracked_eggs', resourceAmount: 60 },
  { weight: 800, outcomeType: 'pet', petSpeciesId: 'waldwachtel' },
  { weight: 800, outcomeType: 'pet', petSpeciesId: 'glitzer_spatz' },
  { weight: 700, outcomeType: 'pet', petSpeciesId: 'moorente' },
  { weight: 700, outcomeType: 'pet', petSpeciesId: 'turmeule' },
  { weight: 200, outcomeType: 'pet', petSpeciesId: 'goldener_erwin' }
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

  await db.insert(petRarities).values([
    { id: 'regular', labelDe: 'Gewöhnlich', rank: 1, recycleCrackedEggs: 10, isActive: true },
    { id: 'rare', labelDe: 'Selten', rank: 2, recycleCrackedEggs: 35, isActive: true }
  ]).onConflictDoUpdate({ target: petRarities.id, set: { isActive: true } });

  await db.insert(petClasses).values([
    { id: 'protector', labelDe: 'Beschützer', description: 'Schützt das Team, indem er gegnerischen Angriffsdruck bindet.', relatedEnemyStat: 'ATK' },
    { id: 'sunderer', labelDe: 'Spalter', description: 'Bricht zähe Verteidigungen auf und zielt auf gegnerische DEF.', relatedEnemyStat: 'DEF' },
    { id: 'saboteur', labelDe: 'Saboteur', description: 'Stört schnelle Gegner und zielt auf gegnerische SPD.', relatedEnemyStat: 'SPD' },
    { id: 'drainer', labelDe: 'Entlader', description: 'Bremst den gegnerischen AP-Aufbau und zielt auf GAIN.', relatedEnemyStat: 'GAIN' },
    { id: 'nullifier', labelDe: 'Bannbrecher', description: 'Schwächt gegnerische Fähigkeitseffekte und zielt auf POW.', relatedEnemyStat: 'POW' }
  ]).onConflictDoUpdate({
    target: petClasses.id,
    set: {
      labelDe: sql`excluded.label_de`,
      description: sql`excluded.description`,
      relatedEnemyStat: sql`excluded.related_enemy_stat`
    }
  });

  await db.delete(petClasses).where(inArray(petClasses.id, ['balanced', 'scout', 'guardian', 'striker', 'hero']));

  await db.insert(elements).values([
    { id: 'nature', labelDe: 'Natur', description: 'Natur-Element.', isActive: true },
    { id: 'air', labelDe: 'Luft', description: 'Luft-Element.', isActive: true },
    { id: 'water', labelDe: 'Wasser', description: 'Wasser-Element.', isActive: true },
    { id: 'shadow', labelDe: 'Schatten', description: 'Schatten-Element.', isActive: true },
    { id: 'light', labelDe: 'Licht', description: 'Licht-Element.', isActive: true }
  ]).onConflictDoUpdate({ target: elements.id, set: { isActive: true } });

  await db.insert(petAbilities).values([
    { id: 'peck_burst', labelDe: 'Pick-Salve', description: 'Automatische Basisfähigkeit.', apRequired: 100, minAttacksRequired: 1, effectType: 'damage', isActive: true },
    { id: 'glimmer_dash', labelDe: 'Glitzer-Sprint', description: 'Automatische Basisfähigkeit.', apRequired: 80, minAttacksRequired: 2, effectType: 'damage', isActive: true },
    { id: 'mud_guard', labelDe: 'Moorwache', description: 'Automatische Basisfähigkeit.', apRequired: 120, minAttacksRequired: 1, effectType: 'shield', isActive: true },
    { id: 'owl_strike', labelDe: 'Eulenschlag', description: 'Automatische Basisfähigkeit.', apRequired: 100, minAttacksRequired: 1, effectType: 'damage', isActive: true },
    { id: 'golden_crowl', labelDe: 'Goldruf', description: 'Automatische Basisfähigkeit.', apRequired: 100, minAttacksRequired: 1, effectType: 'damage', isActive: true }
  ]).onConflictDoUpdate({ target: petAbilities.id, set: { isActive: true } });

  await db.insert(petTraits).values([
    { id: 'sturdy', labelDe: 'Robust', description: 'Mehr HP, etwas weniger SPD.', hpModifier: 10, atkModifier: 0, defModifier: 0, spdModifier: -2, gainModifier: 0, powModifier: 0, isActive: true },
    { id: 'sharp', labelDe: 'Scharfsinnig', description: 'Mehr ATK, etwas weniger DEF.', hpModifier: 0, atkModifier: 2, defModifier: -2, spdModifier: 0, gainModifier: 0, powModifier: 0, isActive: true },
    { id: 'focused', labelDe: 'Fokussiert', description: 'Mehr POW, etwas weniger GAIN.', hpModifier: 0, atkModifier: 0, defModifier: 0, spdModifier: 0, gainModifier: -5, powModifier: 10, isActive: true }
  ]).onConflictDoUpdate({ target: petTraits.id, set: { isActive: true } });

  await db.insert(hats).values([
    { id: 'tiny_crown', labelDe: 'Winzige Krone', description: 'Kosmetischer Hut ohne Stat-Effekt.', isActive: true }
  ]).onConflictDoUpdate({ target: hats.id, set: { isActive: true } });

  await db.insert(petSpecies).values([
    { id: 'waldwachtel', displayName: 'Waldwachtel', labelDe: 'Waldwachtel', description: 'Gemütliche Waldwachtel.', defaultHp: 100, defaultAtk: 10, defaultDef: 8, defaultSpd: 12, defaultGain: 100, defaultPow: 100, defaultAbilityId: 'peck_burst', assetKey: 'pet_waldwachtel', isActive: true },
    { id: 'glitzer_spatz', displayName: 'Glitzer-Spatz', labelDe: 'Glitzer-Spatz', description: 'Funkelnder schneller Spatz.', defaultHp: 80, defaultAtk: 8, defaultDef: 5, defaultSpd: 18, defaultGain: 115, defaultPow: 90, defaultAbilityId: 'glimmer_dash', assetKey: 'pet_glitzer_spatz', isActive: true },
    { id: 'moorente', displayName: 'Moorente', labelDe: 'Moorente', description: 'Zähe Ente aus dem Moor.', defaultHp: 120, defaultAtk: 7, defaultDef: 12, defaultSpd: 7, defaultGain: 90, defaultPow: 105, defaultAbilityId: 'mud_guard', assetKey: 'pet_moorente', isActive: true },
    { id: 'turmeule', displayName: 'Turmeule', labelDe: 'Turmeule', description: 'Wachsame Eule vom Turm.', defaultHp: 90, defaultAtk: 14, defaultDef: 7, defaultSpd: 10, defaultGain: 100, defaultPow: 115, defaultAbilityId: 'owl_strike', assetKey: 'pet_turmeule', isActive: true },
    { id: 'goldener_erwin', displayName: 'Goldener Erwin', labelDe: 'Goldener Erwin', description: 'Legendär glänzender Erwin.', defaultHp: 110, defaultAtk: 13, defaultDef: 10, defaultSpd: 13, defaultGain: 105, defaultPow: 110, defaultAbilityId: 'golden_crowl', assetKey: 'pet_goldener_erwin', isActive: true }
  ]).onConflictDoUpdate({
    target: petSpecies.id,
    set: {
      defaultAbilityId: sql`excluded.default_ability_id`,
      isActive: true
    }
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
        petSpeciesId: 'petSpeciesId' in entry ? entry.petSpeciesId : null
      }))
    )
  );

  console.info('Seed completed for egg types, pet RPG definitions, pet species, and loot tables.');
}

void seed()
  .catch((error: unknown) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

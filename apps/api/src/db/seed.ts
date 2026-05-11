import { db, pool } from './client.js';
import { eq, sql } from 'drizzle-orm';
import {
  eggLootTableEntries,
  eggTypes,
  equipmentTypes,
  elements,
  hats,
  petAbilities,
  petClasses,
  petRarities,
  petSpecies
} from './schema.js';

const BETA_EGG_TYPE_ID = 'beta_egg';
const CRACKED_EGGS_RESOURCE_TYPE = 'cracked_eggs';
const DEFAULT_ABILITY_ID = 'beta_instinct';

const PET_RARITIES = [
  { id: 'common', labelDe: 'Gewöhnlich', rank: 1, recycleCrackedEggs: 1, isActive: true },
  { id: 'uncommon', labelDe: 'Ungewöhnlich', rank: 2, recycleCrackedEggs: 3, isActive: true },
  { id: 'rare', labelDe: 'Selten', rank: 3, recycleCrackedEggs: 8, isActive: true },
  { id: 'epic', labelDe: 'Episch', rank: 4, recycleCrackedEggs: 20, isActive: true },
  { id: 'legendary', labelDe: 'Legendär', rank: 5, recycleCrackedEggs: 50, isActive: true }
] as const;

type RarityId = (typeof PET_RARITIES)[number]['id'];
type ClassId = 'protector' | 'sunderer' | 'saboteur' | 'drainer' | 'nullifier';
type ElementId = 'fire' | 'water' | 'air' | 'earth' | 'light';

type SeedPet = {
  code: string;
  displayName: string;
  rarity: RarityId;
  weight: number;
  element: ElementId;
  classId: ClassId;
};

const BETA_EGG_RESOURCE_REWARDS = [
  { resourceType: CRACKED_EGGS_RESOURCE_TYPE, resourceAmount: 50, weight: 800 },
  { resourceType: CRACKED_EGGS_RESOURCE_TYPE, resourceAmount: 100, weight: 800 },
  { resourceType: CRACKED_EGGS_RESOURCE_TYPE, resourceAmount: 200, weight: 800 }
] as const;

const PET_POOL = [
  { code: 'glutfink', displayName: 'Glutfink', rarity: 'common', weight: 70, element: 'fire', classId: 'nullifier' },
  { code: 'bachente', displayName: 'Bachente', rarity: 'common', weight: 70, element: 'water', classId: 'nullifier' },
  { code: 'windlerche', displayName: 'Windlerche', rarity: 'common', weight: 70, element: 'air', classId: 'nullifier' },
  { code: 'kieseltaube', displayName: 'Kieseltaube', rarity: 'common', weight: 70, element: 'earth', classId: 'protector' },
  { code: 'funkenmeise', displayName: 'Funkenmeise', rarity: 'common', weight: 70, element: 'fire', classId: 'protector' },
  { code: 'schilfreiher', displayName: 'Schilfreiher', rarity: 'common', weight: 70, element: 'water', classId: 'sunderer' },
  { code: 'mooswachtel', displayName: 'Mooswachtel', rarity: 'common', weight: 70, element: 'air', classId: 'sunderer' },
  { code: 'erdspatz', displayName: 'Erdspatz', rarity: 'common', weight: 70, element: 'earth', classId: 'saboteur' },
  { code: 'rauchsegler', displayName: 'Rauchsegler', rarity: 'common', weight: 70, element: 'fire', classId: 'saboteur' },
  { code: 'tropfenmoewe', displayName: 'Tropfenmöwe', rarity: 'common', weight: 70, element: 'water', classId: 'drainer' },
  { code: 'wolkenzaunkoenig', displayName: 'Wolkenzaunkönig', rarity: 'common', weight: 70, element: 'air', classId: 'drainer' },
  { code: 'knollenhuhn', displayName: 'Knollenhuhn', rarity: 'common', weight: 70, element: 'earth', classId: 'drainer' },
  { code: 'kerzenkauz', displayName: 'Kerzenkauz', rarity: 'uncommon', weight: 30, element: 'fire', classId: 'protector' },
  { code: 'perlentaucher', displayName: 'Perlentaucher', rarity: 'uncommon', weight: 30, element: 'water', classId: 'protector' },
  { code: 'sturmschwalbe', displayName: 'Sturmschwalbe', rarity: 'uncommon', weight: 30, element: 'air', classId: 'sunderer' },
  { code: 'lehmspecht', displayName: 'Lehmspecht', rarity: 'uncommon', weight: 30, element: 'earth', classId: 'sunderer' },
  { code: 'kupferfasan', displayName: 'Kupferfasan', rarity: 'uncommon', weight: 30, element: 'fire', classId: 'sunderer' },
  { code: 'regenkranich', displayName: 'Regenkranich', rarity: 'uncommon', weight: 30, element: 'water', classId: 'saboteur' },
  { code: 'boeenfalke', displayName: 'Böenfalke', rarity: 'uncommon', weight: 30, element: 'air', classId: 'saboteur' },
  { code: 'wurzelrabe', displayName: 'Wurzelrabe', rarity: 'uncommon', weight: 30, element: 'earth', classId: 'saboteur' },
  { code: 'phoenixkueken', displayName: 'Phönixküken', rarity: 'rare', weight: 14, element: 'fire', classId: 'nullifier' },
  { code: 'mondreiher', displayName: 'Mondreiher', rarity: 'rare', weight: 14, element: 'water', classId: 'nullifier' },
  { code: 'himmelsgreifchen', displayName: 'Himmelsgreifchen', rarity: 'rare', weight: 14, element: 'air', classId: 'protector' },
  { code: 'runenwachtel', displayName: 'Runenwachtel', rarity: 'rare', weight: 14, element: 'air', classId: 'protector' },
  { code: 'kristallkraehe', displayName: 'Kristallkrähe', rarity: 'rare', weight: 14, element: 'earth', classId: 'drainer' },
  { code: 'obsidianule', displayName: 'Obsidianule', rarity: 'rare', weight: 14, element: 'earth', classId: 'drainer' },
  { code: 'sonnenroc', displayName: 'Sonnenroc', rarity: 'epic', weight: 11, element: 'fire', classId: 'sunderer' },
  { code: 'tiefseealk', displayName: 'Tiefseealk', rarity: 'epic', weight: 11, element: 'water', classId: 'saboteur' },
  { code: 'bergwyrm_kondor', displayName: 'Bergwyrm-Kondor', rarity: 'epic', weight: 11, element: 'earth', classId: 'drainer' },
  { code: 'lichtseraph', displayName: 'Lichtseraph', rarity: 'legendary', weight: 3, element: 'light', classId: 'nullifier' }
] as const satisfies readonly SeedPet[];

function statValueForRarity(rarity: RarityId): number {
  const rarityRank = PET_RARITIES.find((entry) => entry.id === rarity)?.rank;
  if (!rarityRank) throw new Error(`Unknown rarity ${rarity}`);
  return 10 + (rarityRank - 1) * 2;
}

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  return values.reduce(
    (counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }),
    {} as Record<T, number>
  );
}

function assertCount(counts: Record<string, number>, key: string, expected: number): void {
  const actual = counts[key] ?? 0;
  if (actual !== expected) {
    throw new Error(`Invalid seed data: expected ${key} count ${expected}, got ${actual}`);
  }
}

function validatePetPool(): void {
  const totalWeight = PET_POOL.reduce((sum, pet) => sum + pet.weight, 0);
  if (totalWeight !== 1200) {
    throw new Error(`Invalid seed data: expected pet total weight 1200, got ${totalWeight}`);
  }

  const rarityWeights = PET_POOL.reduce<Record<string, number>>((totals, pet) => {
    totals[pet.rarity] = (totals[pet.rarity] ?? 0) + pet.weight;
    return totals;
  }, {});
  assertCount(rarityWeights, 'common', 840);
  assertCount(rarityWeights, 'uncommon', 240);
  assertCount(rarityWeights, 'rare', 84);
  assertCount(rarityWeights, 'epic', 33);
  assertCount(rarityWeights, 'legendary', 3);

  const classCounts = countBy(PET_POOL.map((pet) => pet.classId));
  for (const classId of ['protector', 'sunderer', 'saboteur', 'drainer', 'nullifier'] as const) {
    assertCount(classCounts, classId, 6);
  }

  const elementCounts = countBy(PET_POOL.map((pet) => pet.element));
  assertCount(elementCounts, 'fire', 7);
  assertCount(elementCounts, 'water', 7);
  assertCount(elementCounts, 'air', 7);
  assertCount(elementCounts, 'earth', 8);
  assertCount(elementCounts, 'light', 1);

  const nonLegendaryLightPets = PET_POOL.filter(
    (pet) => pet.element === 'light' && pet.rarity !== 'legendary'
  );
  if (nonLegendaryLightPets.length > 0) {
    throw new Error('Invalid seed data: light element must be legendary-only');
  }
}

function validateBetaEggResourceRewards(): void {
  const totalWeight = BETA_EGG_RESOURCE_REWARDS.reduce((sum, reward) => sum + reward.weight, 0);
  if (totalWeight !== 2400) {
    throw new Error(`Invalid seed data: expected resource total weight 2400, got ${totalWeight}`);
  }

  const rewardAmounts = new Set(BETA_EGG_RESOURCE_REWARDS.map((reward) => reward.resourceAmount));
  for (const expectedAmount of [50, 100, 200] as const) {
    if (!rewardAmounts.has(expectedAmount)) {
      throw new Error(`Invalid seed data: missing cracked egg reward amount ${expectedAmount}`);
    }
  }
}

async function seed(): Promise<void> {
  validatePetPool();
  validateBetaEggResourceRewards();

  await db.insert(eggTypes).values({
    id: BETA_EGG_TYPE_ID,
    displayName: 'Beta Ei',
    baseIncubationSeconds: 14400,
    twitchRewardCost: 1000,
    twitchRewardBackgroundColor: '#9147ff',
    twitchRewardGlobalCooldownMinutes: 0,
    twitchRewardMaxPerStream: 0,
    twitchRewardMaxPerUserPerStream: 1,
    isActive: true
  }).onConflictDoUpdate({
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

  await db.insert(petRarities).values([...PET_RARITIES]).onConflictDoUpdate({
    target: petRarities.id,
    set: {
      labelDe: sql`excluded.label_de`,
      rank: sql`excluded.rank`,
      recycleCrackedEggs: sql`excluded.recycle_cracked_eggs`,
      isActive: true
    }
  });

  await db.insert(petClasses).values([
    { id: 'protector', labelDe: 'Beschützer', description: 'Senkt gegnerischen ATK.', relatedEnemyStat: 'ATK' },
    { id: 'sunderer', labelDe: 'Spalter', description: 'Senkt gegnerische DEF.', relatedEnemyStat: 'DEF' },
    { id: 'saboteur', labelDe: 'Saboteur', description: 'Senkt gegnerische SPD.', relatedEnemyStat: 'SPD' },
    { id: 'drainer', labelDe: 'Entlader', description: 'Senkt gegnerischen GAIN.', relatedEnemyStat: 'GAIN' },
    { id: 'nullifier', labelDe: 'Bannbrecher', description: 'Senkt gegnerischen POW.', relatedEnemyStat: 'POW' }
  ]).onConflictDoUpdate({
    target: petClasses.id,
    set: {
      labelDe: sql`excluded.label_de`,
      description: sql`excluded.description`,
      relatedEnemyStat: sql`excluded.related_enemy_stat`
    }
  });

  await db.insert(elements).values([
    { id: 'fire', labelDe: 'Feuer', description: 'Feuer-Element.', isActive: true },
    { id: 'water', labelDe: 'Wasser', description: 'Wasser-Element.', isActive: true },
    { id: 'air', labelDe: 'Luft', description: 'Luft-Element.', isActive: true },
    { id: 'earth', labelDe: 'Erde', description: 'Erde-Element.', isActive: true },
    { id: 'light', labelDe: 'Licht', description: 'Legendäres Licht-Element.', isActive: true }
  ]).onConflictDoUpdate({
    target: elements.id,
    set: {
      labelDe: sql`excluded.label_de`,
      description: sql`excluded.description`,
      isActive: true
    }
  });

  await db.insert(petAbilities).values({
    id: DEFAULT_ABILITY_ID,
    labelDe: 'Beta-Instinkt',
    description: 'Einheitliche Basisfähigkeit für alle MVP-Pets.',
    apRequired: 100,
    minAttacksRequired: 1,
    effectType: 'mvp_basic',
    isActive: true
  }).onConflictDoUpdate({
    target: petAbilities.id,
    set: {
      labelDe: sql`excluded.label_de`,
      description: sql`excluded.description`,
      apRequired: sql`excluded.ap_required`,
      minAttacksRequired: sql`excluded.min_attacks_required`,
      effectType: sql`excluded.effect_type`,
      isActive: true
    }
  });


  await db.insert(equipmentTypes).values({
    id: 'beta_gem',
    displayName: 'Beta Gem',
    description: 'Beta-Test-Platzhalter ohne Kampfeffekt.',
    equipmentSlot: 'gem',
    config: { placeholder: true, combatEffect: 'none' },
    isActive: true
  }).onConflictDoUpdate({
    target: equipmentTypes.id,
    set: {
      displayName: sql`excluded.display_name`,
      description: sql`excluded.description`,
      equipmentSlot: sql`excluded.equipment_slot`,
      config: sql`excluded.config`,
      isActive: true
    }
  });

  await db.insert(hats).values([
    { id: 'tiny_crown', labelDe: 'Winzige Krone', description: 'Kosmetischer Hut ohne Stat-Effekt.', isActive: true }
  ]).onConflictDoUpdate({ target: hats.id, set: { isActive: true } });

  await db.insert(petSpecies).values(
    PET_POOL.map((pet) => {
      const statValue = statValueForRarity(pet.rarity);
      return {
        id: pet.code,
        displayName: pet.displayName,
        labelDe: pet.displayName,
        description: `${pet.displayName} aus dem Beta-Petpool.`,
        defaultHp: statValue * 10,
        defaultAtk: statValue,
        defaultDef: statValue,
        defaultSpd: statValue,
        defaultGain: statValue,
        defaultPow: statValue,
        defaultAbilityId: DEFAULT_ABILITY_ID,
        assetKey: `pet_${pet.code}`,
        isActive: true
      };
    })
  ).onConflictDoUpdate({
    target: petSpecies.id,
    set: {
      displayName: sql`excluded.display_name`,
      labelDe: sql`excluded.label_de`,
      description: sql`excluded.description`,
      defaultHp: sql`excluded.default_hp`,
      defaultAtk: sql`excluded.default_atk`,
      defaultDef: sql`excluded.default_def`,
      defaultSpd: sql`excluded.default_spd`,
      defaultGain: sql`excluded.default_gain`,
      defaultPow: sql`excluded.default_pow`,
      defaultAbilityId: sql`excluded.default_ability_id`,
      assetKey: sql`excluded.asset_key`,
      isActive: true
    }
  });

  await db.delete(eggLootTableEntries).where(eq(eggLootTableEntries.eggTypeId, BETA_EGG_TYPE_ID));

  await db.insert(eggLootTableEntries).values([
    ...PET_POOL.map((pet) => ({
      eggTypeId: BETA_EGG_TYPE_ID,
      weight: pet.weight,
      outcomeType: 'pet',
      resourceType: null,
      resourceAmount: null,
      petSpeciesId: pet.code
    })),
    ...BETA_EGG_RESOURCE_REWARDS.map((reward) => ({
      eggTypeId: BETA_EGG_TYPE_ID,
      weight: reward.weight,
      outcomeType: 'resource',
      resourceType: reward.resourceType,
      resourceAmount: reward.resourceAmount,
      petSpeciesId: null
    }))
  ]);

  console.info('Seed completed for Beta Ei, Beta Gem, MVP pet pool, and weighted pet/resource loot table.');
}

void seed()
  .catch((error: unknown) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

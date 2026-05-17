import { db, pool } from './client.js';
import { eq, sql } from 'drizzle-orm';
import {
  consumableTypes,
  economyLedger,
  eggLootTableEntries,
  eggTypes,
  equipmentTypes,
  elements,
  hats,
  mysteryEggInventory,
  petAbilities,
  petClasses,
  petRarities,
  petSpecies,
  users
} from './schema.js';

const BETA_EGG_TYPE_ID = 'beta_egg';
const STARTER_EGG_TYPE_ID = 'starter_egg';
const STARTER_EGG_GRANT_LEDGER_EVENT_TYPE = 'starter_egg_default_granted';
const CRACKED_EGGS_RESOURCE_TYPE = 'cracked_eggs';
const DEFAULT_ABILITY_ID = 'beta_instinct';
const SUBSCRIBER_SHOP_PET_IDS = new Set(['glutfink', 'bachente', 'windlerche', 'kieseltaube', 'funkenmeise']);
const CONSUMABLE_RESOURCE_PRICE = 100;
const CONSUMABLE_STOCK = 25;
const CONSUMABLE_IS_SHOP_PURCHASABLE = true;

const GEM_SHOP_BY_TIER = {
  1: { resourcePrice: 250, stock: 10, isShopPurchasable: true },
  2: { resourcePrice: 750, stock: 5, isShopPurchasable: true },
  3: { resourcePrice: 1500, stock: 2, isShopPurchasable: true }
} as const satisfies Record<
  1 | 2 | 3,
  { resourcePrice: number; stock: number; isShopPurchasable: boolean }
>;

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

type EquipmentStat = 'hp' | 'atk' | 'def' | 'spd' | 'gain' | 'pow';

type SeedEquipment = {
  id: string;
  displayName: string;
  description: string;
  stat: EquipmentStat;
  bonus: number;
  tier: 1 | 2 | 3;
};

const GEM_EQUIPMENT = [
  {
    id: 'heart_quartz_1',
    displayName: 'Herzquarz I',
    description: 'Ein zarter Quarz, der den Lebensfunken stärkt. Gewährt +10 HP.',
    stat: 'hp',
    bonus: 10,
    tier: 1
  },
  {
    id: 'heart_quartz_2',
    displayName: 'Herzquarz II',
    description: 'Ein klarer Quarz, der den Lebensfunken kräftigt. Gewährt +20 HP.',
    stat: 'hp',
    bonus: 20,
    tier: 2
  },
  {
    id: 'heart_quartz_3',
    displayName: 'Herzquarz III',
    description: 'Ein strahlender Quarz, der den Lebensfunken entfacht. Gewährt +30 HP.',
    stat: 'hp',
    bonus: 30,
    tier: 3
  },
  {
    id: 'ember_ruby_1',
    displayName: 'Glutrubin I',
    description: 'Ein warmer Rubin, der Angriffe mit Funkenmut füllt. Gewährt +1 ATK.',
    stat: 'atk',
    bonus: 1,
    tier: 1
  },
  {
    id: 'ember_ruby_2',
    displayName: 'Glutrubin II',
    description: 'Ein heißer Rubin, der Angriffe mit Flammenmut füllt. Gewährt +2 ATK.',
    stat: 'atk',
    bonus: 2,
    tier: 2
  },
  {
    id: 'ember_ruby_3',
    displayName: 'Glutrubin III',
    description: 'Ein lodernder Rubin, der Angriffe mit Feuerseele füllt. Gewährt +3 ATK.',
    stat: 'atk',
    bonus: 3,
    tier: 3
  },
  {
    id: 'bastion_emerald_1',
    displayName: 'Bastionssmaragd I',
    description: 'Ein ruhiger Smaragd, dessen Schimmer an feste Mauern erinnert. Gewährt +1 DEF.',
    stat: 'def',
    bonus: 1,
    tier: 1
  },
  {
    id: 'bastion_emerald_2',
    displayName: 'Bastionssmaragd II',
    description: 'Ein dichter Smaragd, dessen Schimmer an Bollwerke erinnert. Gewährt +2 DEF.',
    stat: 'def',
    bonus: 2,
    tier: 2
  },
  {
    id: 'bastion_emerald_3',
    displayName: 'Bastionssmaragd III',
    description: 'Ein tiefer Smaragd, dessen Schimmer an unbrechbare Wälle erinnert. Gewährt +3 DEF.',
    stat: 'def',
    bonus: 3,
    tier: 3
  },
  {
    id: 'gale_opal_1',
    displayName: 'Böenopal I',
    description: 'Ein leichter Opal, in dem eine kleine Böe tanzt. Gewährt +1 SPD.',
    stat: 'spd',
    bonus: 1,
    tier: 1
  },
  {
    id: 'gale_opal_2',
    displayName: 'Böenopal II',
    description: 'Ein schillernder Opal, in dem flinke Winde tanzen. Gewährt +2 SPD.',
    stat: 'spd',
    bonus: 2,
    tier: 2
  },
  {
    id: 'gale_opal_3',
    displayName: 'Böenopal III',
    description: 'Ein wirbelnder Opal, in dem Sturmwinde tanzen. Gewährt +3 SPD.',
    stat: 'spd',
    bonus: 3,
    tier: 3
  },
  {
    id: 'current_sapphire_1',
    displayName: 'Stromsaphir I',
    description: 'Ein blauer Saphir, der den Fluss gesammelter Energie lenkt. Gewährt +1 GAIN.',
    stat: 'gain',
    bonus: 1,
    tier: 1
  },
  {
    id: 'current_sapphire_2',
    displayName: 'Stromsaphir II',
    description: 'Ein tiefer Saphir, der den Fluss gesammelter Energie bündelt. Gewährt +2 GAIN.',
    stat: 'gain',
    bonus: 2,
    tier: 2
  },
  {
    id: 'current_sapphire_3',
    displayName: 'Stromsaphir III',
    description: 'Ein leuchtender Saphir, der den Fluss gesammelter Energie beschleunigt. Gewährt +3 GAIN.',
    stat: 'gain',
    bonus: 3,
    tier: 3
  },
  {
    id: 'sun_beryl_1',
    displayName: 'Sonnenberyll I',
    description: 'Ein goldener Beryll, der Fähigkeitseffekte sanft fokussiert. Gewährt +1 POW.',
    stat: 'pow',
    bonus: 1,
    tier: 1
  },
  {
    id: 'sun_beryl_2',
    displayName: 'Sonnenberyll II',
    description: 'Ein heller Beryll, der Fähigkeitseffekte klar fokussiert. Gewährt +2 POW.',
    stat: 'pow',
    bonus: 2,
    tier: 2
  },
  {
    id: 'sun_beryl_3',
    displayName: 'Sonnenberyll III',
    description: 'Ein gleißender Beryll, der Fähigkeitseffekte stark fokussiert. Gewährt +3 POW.',
    stat: 'pow',
    bonus: 3,
    tier: 3
  }
] as const satisfies readonly SeedEquipment[];

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

type StatId = 'hp' | 'atk' | 'def' | 'spd' | 'gain' | 'pow';

type SeedConsumable = {
  id: string;
  displayName: string;
  description: string;
  increaseStat: StatId;
  decreaseStat: StatId;
};

const PET_BASE_STATS = ['hp', 'atk', 'def', 'spd', 'gain', 'pow'] as const satisfies readonly StatId[];

function statModifierAmount(stat: StatId, direction: 1 | -1): number {
  return stat === 'hp' ? direction * 10 : direction;
}

const STAT_TRADEOFF_CONSUMABLES = [
  {
    id: 'lebkuchen_herz',
    displayName: 'Lebkuchen-Herz',
    description: 'Schenkt extra Ausdauer, macht den Hieb aber sanfter.',
    increaseStat: 'hp',
    decreaseStat: 'atk'
  },
  {
    id: 'marshmallow_polster',
    displayName: 'Marshmallow-Polster',
    description: 'Füllt die Reserven auf, lässt die Schale aber nachgiebiger werden.',
    increaseStat: 'hp',
    decreaseStat: 'def'
  },
  {
    id: 'sahneherz_taler',
    displayName: 'Sahneherz-Taler',
    description: 'Gibt mehr Durchhaltevermögen, während die Schritte träger werden.',
    increaseStat: 'hp',
    decreaseStat: 'spd'
  },
  {
    id: 'traubenzucker_herz',
    displayName: 'Traubenzucker-Herz',
    description: 'Stärkt die Reserven, bringt den inneren Takt aber kurz durcheinander.',
    increaseStat: 'hp',
    decreaseStat: 'gain'
  },
  {
    id: 'pfirsich_herzgelee',
    displayName: 'Pfirsich-Herzgelee',
    description: 'Macht zäher, dämpft jedoch den besonderen Glanz.',
    increaseStat: 'hp',
    decreaseStat: 'pow'
  },
  {
    id: 'knallzucker_spiess',
    displayName: 'Knallzucker-Spieß',
    description: 'Zündet kräftige Treffer, kostet aber etwas Durchhaltevermögen.',
    increaseStat: 'atk',
    decreaseStat: 'hp'
  },
  {
    id: 'zimtfunken_praline',
    displayName: 'Zimtfunken-Praline',
    description: 'Scharfe Süße für mehr Biss, aber mit dünnerer Schale.',
    increaseStat: 'atk',
    decreaseStat: 'def'
  },
  {
    id: 'chili_knisterbonbon',
    displayName: 'Chili-Knisterbonbon',
    description: 'Macht den nächsten Antritt wuchtiger, aber weniger flink.',
    increaseStat: 'atk',
    decreaseStat: 'spd'
  },
  {
    id: 'espresso_krokant',
    displayName: 'Espresso-Krokant',
    description: 'Bündelt rohe Kraft, kostet aber etwas Rhythmusgefühl.',
    increaseStat: 'atk',
    decreaseStat: 'gain'
  },
  {
    id: 'rauchmandel_toffee',
    displayName: 'Rauchmandel-Toffee',
    description: 'Verdichtet den Treffer, lässt besondere Magie matter funkeln.',
    increaseStat: 'atk',
    decreaseStat: 'pow'
  },
  {
    id: 'kandis_panzertaler',
    displayName: 'Kandis-Panzertaler',
    description: 'Härtet die Außenseite, lässt die Reserven aber knapper werden.',
    increaseStat: 'def',
    decreaseStat: 'hp'
  },
  {
    id: 'karamell_schildkeks',
    displayName: 'Karamell-Schildkeks',
    description: 'Härtet die Kruste, nimmt dem Schnabel aber etwas Schärfe.',
    increaseStat: 'def',
    decreaseStat: 'atk'
  },
  {
    id: 'marzipan_puffer',
    displayName: 'Marzipan-Puffer',
    description: 'Legt eine weiche Schutzschicht an, die Schritte schwerer macht.',
    increaseStat: 'def',
    decreaseStat: 'spd'
  },
  {
    id: 'honig_wallriegel',
    displayName: 'Honig-Wallriegel',
    description: 'Klebt zuverlässig als Schutz, bremst aber den Kampftakt.',
    increaseStat: 'def',
    decreaseStat: 'gain'
  },
  {
    id: 'nougat_bastion',
    displayName: 'Nougat-Bastion',
    description: 'Stärkt die Deckung, dämpft dafür das innere Glitzern.',
    increaseStat: 'def',
    decreaseStat: 'pow'
  },
  {
    id: 'pfefferminz_flitzer',
    displayName: 'Pfefferminz-Flitzer',
    description: 'Macht hellwach und schnell, zehrt aber an der Ausdauer.',
    increaseStat: 'spd',
    decreaseStat: 'hp'
  },
  {
    id: 'brause_flitzdrop',
    displayName: 'Brause-Flitzdrop',
    description: 'Prickelt in den Füßen, doch der Hieb wird leichter.',
    increaseStat: 'spd',
    decreaseStat: 'atk'
  },
  {
    id: 'zuckerwind_stange',
    displayName: 'Zuckerwind-Stange',
    description: 'Bringt Tempo in die Federn, aber macht die Hülle fragiler.',
    increaseStat: 'spd',
    decreaseStat: 'def'
  },
  {
    id: 'limetten_sausekugel',
    displayName: 'Limetten-Sausekugel',
    description: 'Zündet schnelle Bewegungen, kostet aber etwas Flow.',
    increaseStat: 'spd',
    decreaseStat: 'gain'
  },
  {
    id: 'wolkenwatte_happen',
    displayName: 'Wolkenwatte-Happen',
    description: 'Macht federleicht und fix, schwächt jedoch den Zauberfunken.',
    increaseStat: 'spd',
    decreaseStat: 'pow'
  },
  {
    id: 'karamell_taktbonbon',
    displayName: 'Karamell-Taktbonbon',
    description: 'Hilft, schneller in den Flow zu finden, nimmt aber etwas Reserve.',
    increaseStat: 'gain',
    decreaseStat: 'hp'
  },
  {
    id: 'sirup_taktgeber',
    displayName: 'Sirup-Taktgeber',
    description: 'Findet schneller in den Kampfrhythmus, mit etwas weniger Wucht.',
    increaseStat: 'gain',
    decreaseStat: 'atk'
  },
  {
    id: 'lakritz_kompass',
    displayName: 'Lakritz-Kompass',
    description: 'Richtet den inneren Takt aus, lockert aber die Deckung.',
    increaseStat: 'gain',
    decreaseStat: 'def'
  },
  {
    id: 'honigwirbel_lolli',
    displayName: 'Honigwirbel-Lolli',
    description: 'Lässt Aktionen runder laufen, während die Beine schwerer werden.',
    increaseStat: 'gain',
    decreaseStat: 'spd'
  },
  {
    id: 'malzstern_gelee',
    displayName: 'Malzstern-Gelee',
    description: 'Sammelt Energie zuverlässiger, aber der Sternenglanz wird milder.',
    increaseStat: 'gain',
    decreaseStat: 'pow'
  },
  {
    id: 'mondschein_dragee',
    displayName: 'Mondschein-Dragée',
    description: 'Lässt Sonderfunken heller strahlen, macht aber weniger zäh.',
    increaseStat: 'pow',
    decreaseStat: 'hp'
  },
  {
    id: 'sternzucker_trueffel',
    displayName: 'Sternzucker-Trüffel',
    description: 'Bringt Sonderfunken zum Leuchten, macht normale Treffer sanfter.',
    increaseStat: 'pow',
    decreaseStat: 'atk'
  },
  {
    id: 'mondglas_bonbon',
    displayName: 'Mondglas-Bonbon',
    description: 'Lädt geheimnisvolle Kräfte auf, lässt die Schale dünner wirken.',
    increaseStat: 'pow',
    decreaseStat: 'def'
  },
  {
    id: 'glitzer_makrone',
    displayName: 'Glitzer-Makrone',
    description: 'Verstärkt das Funkeln, aber die Bewegung wird gemächlicher.',
    increaseStat: 'pow',
    decreaseStat: 'spd'
  },
  {
    id: 'vanille_orakel',
    displayName: 'Vanille-Orakel',
    description: 'Öffnet den Blick für besondere Momente, stört jedoch den Takt.',
    increaseStat: 'pow',
    decreaseStat: 'gain'
  }
] as const satisfies readonly SeedConsumable[];

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

function validateShopMetadata(
  resourcePrice: number,
  stock: number,
  isShopPurchasable: boolean,
  label: string
): void {
  if (!Number.isInteger(resourcePrice) || resourcePrice < 0) {
    throw new Error(`Invalid seed data: ${label} resourcePrice must be a non-negative integer`);
  }
  if (!Number.isInteger(stock) || stock < 0) {
    throw new Error(`Invalid seed data: ${label} stock must be a non-negative integer`);
  }
  if (typeof isShopPurchasable !== 'boolean') {
    throw new Error(`Invalid seed data: ${label} isShopPurchasable must be boolean`);
  }
  if (isShopPurchasable && (resourcePrice <= 0 || stock <= 0)) {
    throw new Error(
      `Invalid seed data: ${label} purchasable shop entries must have positive resourcePrice and stock`
    );
  }
}

function validateGemEquipment(): void {
  const ids = new Set(GEM_EQUIPMENT.map((entry) => entry.id));
  if (ids.size !== GEM_EQUIPMENT.length) {
    throw new Error('Invalid seed data: equipment IDs must be unique');
  }

  const expectedEquipmentCount = PET_BASE_STATS.length * 3;
  if (GEM_EQUIPMENT.length !== expectedEquipmentCount) {
    throw new Error(
      `Invalid seed data: expected ${expectedEquipmentCount} gem equipment items, got ${GEM_EQUIPMENT.length}`
    );
  }

  const expectedBonuses: Record<EquipmentStat, readonly number[]> = {
    hp: [10, 20, 30],
    atk: [1, 2, 3],
    def: [1, 2, 3],
    spd: [1, 2, 3],
    gain: [1, 2, 3],
    pow: [1, 2, 3]
  };

  for (const [stat, expectedValues] of Object.entries(expectedBonuses) as Array<
    [EquipmentStat, readonly number[]]
  >) {
    const actualValues = GEM_EQUIPMENT.filter((equipment) => equipment.stat === stat)
      .map((equipment) => equipment.bonus)
      .sort((left, right) => left - right);
    if (actualValues.join(',') !== expectedValues.join(',')) {
      throw new Error(
        `Invalid seed data: expected gem bonuses ${expectedValues.join(',')} for ${stat}, got ${actualValues.join(',')}`
      );
    }
  }

  for (const equipment of GEM_EQUIPMENT) {
    const shop = GEM_SHOP_BY_TIER[equipment.tier];
    validateShopMetadata(
      shop.resourcePrice,
      shop.stock,
      shop.isShopPurchasable,
      equipment.id
    );
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

function validateStarterEggLootTable(): void {
  const starterPets = PET_POOL.filter((pet) => pet.rarity === 'uncommon');
  if (starterPets.length !== 8) {
    throw new Error(`Invalid seed data: expected 8 starter egg uncommon pets, got ${starterPets.length}`);
  }

  const totalWeight = starterPets.reduce((sum, pet) => sum + pet.weight, 0);
  if (totalWeight !== 240) {
    throw new Error(`Invalid seed data: expected starter egg total weight 240, got ${totalWeight}`);
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

function validateStatTradeoffConsumables(): void {
  const ids = new Set(STAT_TRADEOFF_CONSUMABLES.map((entry) => entry.id));
  if (ids.size !== STAT_TRADEOFF_CONSUMABLES.length) {
    throw new Error('Invalid seed data: consumable IDs must be unique');
  }

  const expectedCombinations = PET_BASE_STATS.length * (PET_BASE_STATS.length - 1);
  if (STAT_TRADEOFF_CONSUMABLES.length !== expectedCombinations) {
    throw new Error(
      `Invalid seed data: expected ${expectedCombinations} stat tradeoff consumables, got ${STAT_TRADEOFF_CONSUMABLES.length}`
    );
  }

  const combinations = new Set(
    STAT_TRADEOFF_CONSUMABLES.map((entry) => `${entry.increaseStat}:${entry.decreaseStat}`)
  );

  for (const increaseStat of PET_BASE_STATS) {
    for (const decreaseStat of PET_BASE_STATS) {
      if (increaseStat === decreaseStat) continue;
      if (!combinations.has(`${increaseStat}:${decreaseStat}`)) {
        throw new Error(
          `Invalid seed data: missing consumable tradeoff +${increaseStat}/-${decreaseStat}`
        );
      }
    }
  }

  validateShopMetadata(
    CONSUMABLE_RESOURCE_PRICE,
    CONSUMABLE_STOCK,
    CONSUMABLE_IS_SHOP_PURCHASABLE,
    'stat tradeoff consumables'
  );
}

async function seed(): Promise<void> {
  validatePetPool();
  validateBetaEggResourceRewards();
  validateStarterEggLootTable();
  validateGemEquipment();
  validateStatTradeoffConsumables();

  await db.insert(eggTypes).values([
    {
      id: BETA_EGG_TYPE_ID,
      displayName: 'Beta Ei',
      baseIncubationSeconds: 14400,
      twitchRewardCost: 1000,
      twitchRewardBackgroundColor: '#9147ff',
      twitchRewardGlobalCooldownMinutes: 0,
      twitchRewardMaxPerStream: 0,
      twitchRewardMaxPerUserPerStream: 1,
      isActive: true
    },
    {
      id: STARTER_EGG_TYPE_ID,
      displayName: 'Starter Ei',
      baseIncubationSeconds: 60,
      twitchRewardCost: null,
      twitchRewardBackgroundColor: null,
      twitchRewardGlobalCooldownMinutes: null,
      twitchRewardMaxPerStream: null,
      twitchRewardMaxPerUserPerStream: null,
      isActive: false
    }
  ]).onConflictDoUpdate({
    target: eggTypes.id,
    set: {
      displayName: sql`excluded.display_name`,
      baseIncubationSeconds: sql`excluded.base_incubation_seconds`,
      twitchRewardCost: sql`excluded.twitch_reward_cost`,
      twitchRewardBackgroundColor: sql`excluded.twitch_reward_background_color`,
      twitchRewardGlobalCooldownMinutes: sql`excluded.twitch_reward_global_cooldown_minutes`,
      twitchRewardMaxPerStream: sql`excluded.twitch_reward_max_per_stream`,
      twitchRewardMaxPerUserPerStream: sql`excluded.twitch_reward_max_per_user_per_stream`,
      isActive: sql`excluded.is_active`
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
    { id: 'protector', labelDe: 'Beschützer', description: 'Senkt gegnerischen ATK.', relatedEnemyStat: 'ATK', mainStat: 'DEF', secondaryStatOne: 'HP', secondaryStatTwo: 'GAIN' },
    { id: 'sunderer', labelDe: 'Spalter', description: 'Senkt gegnerische DEF.', relatedEnemyStat: 'DEF', mainStat: 'ATK', secondaryStatOne: 'SPD', secondaryStatTwo: 'POW' },
    { id: 'saboteur', labelDe: 'Saboteur', description: 'Senkt gegnerische SPD.', relatedEnemyStat: 'SPD', mainStat: 'SPD', secondaryStatOne: 'ATK', secondaryStatTwo: 'GAIN' },
    { id: 'drainer', labelDe: 'Entlader', description: 'Senkt gegnerischen GAIN.', relatedEnemyStat: 'GAIN', mainStat: 'GAIN', secondaryStatOne: 'HP', secondaryStatTwo: 'POW' },
    { id: 'nullifier', labelDe: 'Bannbrecher', description: 'Senkt gegnerischen POW.', relatedEnemyStat: 'POW', mainStat: 'POW', secondaryStatOne: 'DEF', secondaryStatTwo: 'SPD' }
  ]).onConflictDoUpdate({
    target: petClasses.id,
    set: {
      labelDe: sql`excluded.label_de`,
      description: sql`excluded.description`,
      relatedEnemyStat: sql`excluded.related_enemy_stat`,
      mainStat: sql`excluded.main_stat`,
      secondaryStatOne: sql`excluded.secondary_stat_one`,
      secondaryStatTwo: sql`excluded.secondary_stat_two`
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


  await db.insert(equipmentTypes).values(
    GEM_EQUIPMENT.map((equipment) => {
      const shop = GEM_SHOP_BY_TIER[equipment.tier];
      return {
        id: equipment.id,
        displayName: equipment.displayName,
        description: equipment.description,
        equipmentSlot: 'gem',
        config: {
          tier: equipment.tier,
          statBonuses: { [equipment.stat]: equipment.bonus }
        },
        resourcePrice: shop.resourcePrice,
        stock: shop.stock,
        isShopPurchasable: shop.isShopPurchasable,
        isActive: true
      };
    })
  ).onConflictDoUpdate({
    target: equipmentTypes.id,
    set: {
      displayName: sql`excluded.display_name`,
      description: sql`excluded.description`,
      equipmentSlot: sql`excluded.equipment_slot`,
      config: sql`excluded.config`,
      resourcePrice: sql`excluded.resource_price`,
      stock: sql`excluded.stock`,
      isShopPurchasable: sql`excluded.is_shop_purchasable`,
      isActive: true
    }
  });

  await db.insert(hats).values([
    { id: 'tiny_crown', labelDe: 'Winzige Krone', description: 'Kosmetischer Hut ohne Stat-Effekt.', isShopPurchasable: true, isActive: true }
  ]).onConflictDoUpdate({ target: hats.id, set: { labelDe: sql`excluded.label_de`, description: sql`excluded.description`, isShopPurchasable: sql`excluded.is_shop_purchasable`, isActive: true } });

  await db.insert(consumableTypes).values(
    STAT_TRADEOFF_CONSUMABLES.map((consumable) => ({
      id: consumable.id,
      displayName: consumable.displayName,
      description: consumable.description,
      effectType: 'pet_stat_tradeoff',
      config: {
        target: 'pet',
        duration: 'permanent',
        statModifiers: {
          [consumable.increaseStat]: statModifierAmount(consumable.increaseStat, 1),
          [consumable.decreaseStat]: statModifierAmount(consumable.decreaseStat, -1)
        }
      },
      resourcePrice: CONSUMABLE_RESOURCE_PRICE,
      stock: CONSUMABLE_STOCK,
      isShopPurchasable: CONSUMABLE_IS_SHOP_PURCHASABLE,
      isActive: true
    }))
  ).onConflictDoUpdate({
    target: consumableTypes.id,
    set: {
      displayName: sql`excluded.display_name`,
      description: sql`excluded.description`,
      effectType: sql`excluded.effect_type`,
      config: sql`excluded.config`,
      resourcePrice: sql`excluded.resource_price`,
      stock: sql`excluded.stock`,
      isShopPurchasable: sql`excluded.is_shop_purchasable`,
      isActive: true
    }
  });

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
        rarityId: pet.rarity,
        classId: pet.classId,
        elementId: pet.element,
        defaultAbilityId: DEFAULT_ABILITY_ID,
        assetKey: `pet_${pet.code}`,
        isShopPurchasable: SUBSCRIBER_SHOP_PET_IDS.has(pet.code),
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
      rarityId: sql`excluded.rarity_id`,
      classId: sql`excluded.class_id`,
      elementId: sql`excluded.element_id`,
      defaultAbilityId: sql`excluded.default_ability_id`,
      assetKey: sql`excluded.asset_key`,
      isShopPurchasable: sql`excluded.is_shop_purchasable`,
      isActive: true
    }
  });

  await db.delete(eggLootTableEntries).where(eq(eggLootTableEntries.eggTypeId, BETA_EGG_TYPE_ID));
  await db.delete(eggLootTableEntries).where(eq(eggLootTableEntries.eggTypeId, STARTER_EGG_TYPE_ID));

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
    })),
    ...PET_POOL.filter((pet) => pet.rarity === 'uncommon').map((pet) => ({
      eggTypeId: STARTER_EGG_TYPE_ID,
      weight: pet.weight,
      outcomeType: 'pet',
      resourceType: null,
      resourceAmount: null,
      petSpeciesId: pet.code
    }))
  ]);

  const playersMissingStarterEgg = await db
    .select({ id: users.id })
    .from(users)
    .where(
      sql`${users.isDeleted} = false and not exists (
        select 1 from ${economyLedger}
        where ${economyLedger.userId} = ${users.id}
          and ${economyLedger.eventType} = ${STARTER_EGG_GRANT_LEDGER_EVENT_TYPE}
          and ${economyLedger.isReverted} = false
      )`
    );

  if (playersMissingStarterEgg.length > 0) {
    await db.transaction(async (tx) => {
      const now = new Date();
      for (const player of playersMissingStarterEgg) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(
            hashtext('erwin_hatchery_user_inventory'),
            hashtext(${player.id})
          )`
        );

        const [existingGrant] = await tx
          .select({ id: economyLedger.id })
          .from(economyLedger)
          .where(
            sql`${economyLedger.userId} = ${player.id}
              and ${economyLedger.eventType} = ${STARTER_EGG_GRANT_LEDGER_EVENT_TYPE}
              and ${economyLedger.isReverted} = false`
          )
          .limit(1);
        if (existingGrant) continue;

        await tx
          .insert(mysteryEggInventory)
          .values({
            userId: player.id,
            eggTypeId: STARTER_EGG_TYPE_ID,
            amount: 1,
            updatedAt: now
          })
          .onConflictDoUpdate({
            target: [mysteryEggInventory.userId, mysteryEggInventory.eggTypeId],
            set: {
              amount: sql`${mysteryEggInventory.amount} + 1`,
              updatedAt: now
            }
          });

        await tx.insert(economyLedger).values({
          userId: player.id,
          actorUserId: null,
          eventType: STARTER_EGG_GRANT_LEDGER_EVENT_TYPE,
          sourceType: 'system_seed',
          sourceId: null,
          delta: {
            mysteryEggInventory: [
              { eggTypeId: STARTER_EGG_TYPE_ID, amountDelta: 1 }
            ]
          }
        });
      }
    });
  }

  console.info('Seed completed for Beta Ei, Starter Ei, tiered gem equipment, sweet stat-tradeoff consumables, MVP pet pool, and weighted pet/resource loot tables.');
}

void seed()
  .catch((error: unknown) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

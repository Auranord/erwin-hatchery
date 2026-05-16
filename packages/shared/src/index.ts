import { z } from 'zod';

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  database: z.enum(['ok', 'error']),
  version: z.string()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const INVENTORY_KINDS = ['incubators', 'unhatched_eggs', 'pets', 'consumables', 'equipment'] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export type InventoryGridDimensions = {
  kind: InventoryKind;
  columns: number;
  rows: number;
  baseRows: number;
  bonusRows: number;
  capacity: number;
  upgradeRef: string | null;
  nextRowUpgradeCostCrackedEggs: number | null;
};

export const DEFAULT_INVENTORY_GRIDS: Record<InventoryKind, { columns: number; baseRows: number; bonusRows: number; upgradeRef: string | null }> = {
  incubators: { columns: 1, baseRows: 1, bonusRows: 0, upgradeRef: 'incubator_inventory_rows' },
  unhatched_eggs: { columns: 8, baseRows: 3, bonusRows: 0, upgradeRef: 'unhatched_egg_inventory_rows' },
  pets: { columns: 4, baseRows: 4, bonusRows: 0, upgradeRef: 'pet_inventory_rows' },
  consumables: { columns: 8, baseRows: 3, bonusRows: 0, upgradeRef: 'consumable_inventory_rows' },
  equipment: { columns: 8, baseRows: 3, bonusRows: 0, upgradeRef: 'equipment_inventory_rows' }
};

export const INVENTORY_ROW_UPGRADE_BASE_COST_CRACKED_EGGS = 500;
export const EQUIPMENT_SET_UPGRADE_BASE_COST_CRACKED_EGGS = 500;

export function getInventoryRowUpgradeCostCrackedEggs(bonusRows: number): number {
  return INVENTORY_ROW_UPGRADE_BASE_COST_CRACKED_EGGS * 2 ** bonusRows;
}

export function getEquipmentSetSlotUpgradeCostCrackedEggs(bonusSlots: number): number {
  return EQUIPMENT_SET_UPGRADE_BASE_COST_CRACKED_EGGS * 2 ** bonusSlots;
}

export function getAdditionalEquipmentSetCostCrackedEggs(additionalSetCount: number): number {
  return EQUIPMENT_SET_UPGRADE_BASE_COST_CRACKED_EGGS * 2 ** additionalSetCount;
}

export const DEFAULT_CONSUMABLE_STACK_LIMIT = 1;

export const CONSUMABLE_STACK_LIMITS: Record<string, number> = {
  default: DEFAULT_CONSUMABLE_STACK_LIMIT
};

export function getInventoryCapacity(dimensions: Pick<InventoryGridDimensions, 'columns' | 'rows'>): number {
  return dimensions.columns * dimensions.rows;
}

export function getConsumableStackLimit(consumableTypeId: string): number {
  return CONSUMABLE_STACK_LIMITS[consumableTypeId] ?? DEFAULT_CONSUMABLE_STACK_LIMIT;
}

export function isSlotInsideGrid(slotIndex: number, dimensions: Pick<InventoryGridDimensions, 'columns' | 'rows'>): boolean {
  return Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < getInventoryCapacity(dimensions);
}

export type SlottedInventoryCell<T> = {
  slotIndex: number;
  item: T | null;
};

export type MysteryEggBalance = { eggTypeId: string; amount: number; updatedAt?: string };
export type EggResourceBalance = { resourceType: string; amount: number; updatedAt?: string };

export type IncubatorMetadata = {
  speedMultiplierBasisPoints: number;
  specialBonusBasisPoints: number;
  fuelBehavior: string;
  specialEffectConfig: unknown;
};

export type ActiveIncubationJob = {
  id: string;
  unhatchedEggId: string;
  state: string;
  startedAt: string;
  requiredProgressSeconds: number;
  progressSecondsAccumulated: number;
  lastProgressedAt: string | null;
  progressSnapshot?: unknown;
};

export type IncubatorSlotItem = {
  id: string;
  slotSource: string;
  slotLevel: number;
  slotIndex: number | null;
  isAvailable: boolean;
  metadata: IncubatorMetadata;
  activeJob: ActiveIncubationJob | null;
};

export type UnhatchedEggSlotItem = { id: string; eggTypeId: string; state: string };

export type PetTrait = {
  id: string;
  labelDe: string;
  description: string;
  hpModifier: number;
  atkModifier: number;
  defModifier: number;
  spdModifier: number;
  gainModifier: number;
  powModifier: number;
};

export type PetSlotItem = {
  id: string;
  speciesId: string;
  speciesDisplayName: string;
  rarityId: string;
  rarityLabelDe: string;
  classId: string;
  classLabelDe: string;
  elementId: string;
  elementLabelDe: string;
  abilityId: string;
  abilityLabelDe: string;
  nickname: string | null;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseSpd: number;
  baseGain: number;
  basePow: number;
  experience: number;
  level: number;
  isFavorite: boolean;
  equippedHatId: string | null;
  traits: PetTrait[];
  selectedForEvent: boolean;
  createdAt: string;
};

export type ConsumableSlotItem = {
  id: string;
  consumableTypeId: string;
  quantity: number;
};

export type EquipmentSlotItem = {
  id: string;
  equipmentTypeId: string;
};

export type EquipmentSetSlotCell = {
  slotIndex: number;
  item: EquipmentSlotItem | null;
};

export type EquipmentSetPayload = {
  id: string;
  setIndex: number;
  label: string;
  baseSlotCount: number;
  bonusSlotCount: number;
  slotCount: number;
  selectedForEvent: boolean;
  upgradeRef: string | null;
  slots: EquipmentSetSlotCell[];
};

export type HatCollectionItem = {
  id: string;
  hatId: string;
  labelDe: string;
  description: string;
  unlocked: boolean;
  unlockedAt: string | null;
};

export type HatCollection = {
  columns: number;
  total: number;
  unlockedCount: number;
  slots: Array<SlottedInventoryCell<HatCollectionItem>>;
};

export type SlottedGrid<T> = {
  dimensions: InventoryGridDimensions;
  slots: Array<SlottedInventoryCell<T>>;
};

export type IncubatorInventory = {
  dimensions: InventoryGridDimensions;
  incubators: IncubatorSlotItem[];
};


export type ShopOfferKind = 'equipment' | 'consumable';

export type ShopOfferItem = {
  kind: ShopOfferKind;
  typeId: string;
  displayName: string;
  description: string;
  resourcePrice: number;
  stock: number;
  purchasedThisWeek: number;
  remainingThisWeek: number;
};

export type ShopOffersPayload = {
  weekKey: string;
  weekStartsAt: string;
  weekEndsAt: string;
  currencyResourceType: string;
  equipmentOfferCount: number;
  consumableOfferCount: number;
  offers: ShopOfferItem[];
};

export type SubscriberShopOfferItem = {
  kind: 'pet_hat_pair';
  petSpeciesId: string;
  petDisplayName: string;
  hatId: string;
  hatLabelDe: string;
  displayName: string;
  description: string;
  resourcePrice: number;
  stock: number;
  purchasedThisMonth: number;
  remainingThisMonth: number;
};

export type SubscriberShopOffersPayload = {
  monthKey: string;
  monthStartsAt: string;
  monthEndsAt: string;
  currencyResourceType: string;
  offerCount: number;
  offers: SubscriberShopOfferItem[];
};

export type EquipmentSetUpgradesPayload = {
  setCount: number;
  setSlotBonusCount: number;
  nextSlotUpgradeCostCrackedEggs: number;
  nextSetCostCrackedEggs: number;
};

export type PlayerInventoryPayload = {
  mysteryEggs: MysteryEggBalance[];
  crackedEggResources: EggResourceBalance[];
  incubators: IncubatorInventory;
  unhatchedEggs: SlottedGrid<UnhatchedEggSlotItem>;
  pets: SlottedGrid<PetSlotItem>;
  consumables: SlottedGrid<ConsumableSlotItem>;
  equipment: SlottedGrid<EquipmentSlotItem>;
  equipmentSets: EquipmentSetPayload[];
  equipmentSetUpgrades: EquipmentSetUpgradesPayload;
  hats: HatCollection;
};

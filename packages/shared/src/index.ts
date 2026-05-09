import { z } from 'zod';

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  database: z.enum(['ok', 'error']),
  version: z.string()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const INVENTORY_KINDS = ['incubators', 'unhatched_eggs', 'pets', 'items'] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export type InventoryGridDimensions = {
  kind: InventoryKind;
  columns: number;
  rows: number;
  baseRows: number;
  bonusRows: number;
  capacity: number;
  upgradeRef: string | null;
};

export const DEFAULT_INVENTORY_GRIDS: Record<InventoryKind, { columns: number; baseRows: number; bonusRows: number; upgradeRef: string | null }> = {
  incubators: { columns: 4, baseRows: 1, bonusRows: 0, upgradeRef: null },
  unhatched_eggs: { columns: 8, baseRows: 3, bonusRows: 0, upgradeRef: 'unhatched_egg_inventory_rows' },
  pets: { columns: 4, baseRows: 4, bonusRows: 0, upgradeRef: 'pet_inventory_rows' },
  items: { columns: 8, baseRows: 3, bonusRows: 0, upgradeRef: 'item_inventory_rows' }
};

export const DEFAULT_ITEM_STACK_LIMIT = 99;

export const ITEM_STACK_LIMITS: Record<string, number> = {
  default: DEFAULT_ITEM_STACK_LIMIT
};

export function getInventoryCapacity(dimensions: Pick<InventoryGridDimensions, 'columns' | 'rows'>): number {
  return dimensions.columns * dimensions.rows;
}

export function getStackLimit(itemTypeId: string): number {
  return ITEM_STACK_LIMITS[itemTypeId] ?? DEFAULT_ITEM_STACK_LIMIT;
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
  rarityBonusBasisPoints: number;
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

export type PetSlotItem = {
  id: string;
  petTypeId: string;
  petTypeDisplayName: string;
  rarity: string;
  role: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  selectedForEvent: boolean;
  createdAt: string;
};

export type ConsumableSlotItem = {
  id: string;
  consumableTypeId: string;
  amount: number;
  stackLimit: number;
};

export type SlottedGrid<T> = {
  dimensions: InventoryGridDimensions;
  slots: Array<SlottedInventoryCell<T>>;
};

export type IncubatorInventory = {
  incubators: IncubatorSlotItem[];
};

export type PlayerInventoryPayload = {
  mysteryEggs: MysteryEggBalance[];
  crackedEggResources: EggResourceBalance[];
  incubators: IncubatorInventory;
  unhatchedEggs: SlottedGrid<UnhatchedEggSlotItem>;
  pets: SlottedGrid<PetSlotItem>;
  consumables: SlottedGrid<ConsumableSlotItem>;
};

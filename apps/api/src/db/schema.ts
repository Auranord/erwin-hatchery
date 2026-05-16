import {
  AnyPgColumn,
  boolean,
  integer,
  jsonb,
  bigint,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
};

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  twitchUserId: text('twitch_user_id').notNull().unique(),
  twitchLogin: text('twitch_login'),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  isProvisional: boolean('is_provisional').notNull().default(true),
  isDeleted: boolean('is_deleted').notNull().default(false),
  isSubscriber: boolean('is_subscriber').notNull().default(false),
  subscriberEndsAt: timestamp('subscriber_ends_at', { withTimezone: true }),
  createdAt: timestamps.createdAt,
  updatedAt: timestamps.updatedAt,
  lastLoginAt: timestamp('last_login_at', { withTimezone: true })
});

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  sessionTokenHash: text('session_token_hash').notNull().unique(),
  csrfState: text('csrf_state'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true })
});

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    userRoleUnique: uniqueIndex('roles_user_id_role_idx').on(
      table.userId,
      table.role
    )
  })
);

export const adminActionLogs = pgTable('admin_action_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id')
    .notNull()
    .references(() => users.id),
  targetUserId: uuid('target_user_id').references(() => users.id),
  actionType: text('action_type').notNull(),
  requestId: text('request_id').notNull().unique(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});
export const twitchEvents = pgTable('twitch_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  twitchEventId: text('twitch_event_id').notNull().unique(),
  type: text('type').notNull(),
  source: text('source').notNull(),
  userId: uuid('user_id').references(() => users.id),
  rawPayload: jsonb('raw_payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingStatus: text('processing_status').notNull().default('received'),
  error: text('error')
});



export const twitchIntegrationState = pgTable('twitch_integration_state', {
  id: text('id').primaryKey().default('default'),
  broadcasterUserId: text('broadcaster_user_id'),
  broadcasterLogin: text('broadcaster_login'),
  requiredScopes: text('required_scopes').notNull().default(''),
  setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true }),
  eventsubSyncedAt: timestamp('eventsub_synced_at', { withTimezone: true }),
  subscriptionBackfillCompletedAt: timestamp('subscription_backfill_completed_at', { withTimezone: true }),
  bitsBackfillCompletedAt: timestamp('bits_backfill_completed_at', { withTimezone: true }),
  requiresReauth: boolean('requires_reauth').notNull().default(false),
  eventsubHealthy: boolean('eventsub_healthy').notNull().default(false),
  lastHealthCheckAt: timestamp('last_health_check_at', { withTimezone: true }),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const twitchEventSubSubscriptions = pgTable(
  'twitch_eventsub_subscriptions',
  {
    eventType: text('event_type').notNull(),
    version: text('version').notNull().default('1'),
    twitchSubscriptionId: text('twitch_subscription_id'),
    status: text('status').notNull().default('missing'),
    callbackUrl: text('callback_url').notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.eventType, table.version] })
  })
);

export const twitchBackfillRuns = pgTable('twitch_backfill_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  source: text('source').notNull(),
  error: text('error')
});

export const twitchBitsBalances = pgTable('twitch_bits_balances', {
  userId: uuid('user_id').notNull().primaryKey().references(() => users.id),
  twitchUserId: text('twitch_user_id').notNull().unique(),
  importedBitsBaseline: bigint('imported_bits_baseline', { mode: 'number' }).notNull().default(0),
  eventsubBitsTotal: bigint('eventsub_bits_total', { mode: 'number' }).notNull().default(0),
  totalBitsCounted: bigint('total_bits_counted', { mode: 'number' }).notNull().default(0),
  voucherThresholdsGranted: integer('voucher_thresholds_granted').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const twitchUserTokens = pgTable('twitch_user_tokens', {
  userId: uuid('user_id')
    .notNull()
    .primaryKey()
    .references(() => users.id),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  scope: text('scope').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});

export const channelPointRedemptions = pgTable('channel_point_redemptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  twitchRedemptionId: text('twitch_redemption_id').notNull().unique(),
  twitchRewardId: text('twitch_reward_id').notNull(),
  userId: uuid('user_id').references(() => users.id),
  cost: integer('cost').notNull(),
  status: text('status').notNull(),
  rawPayload: jsonb('raw_payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true })
});

export const economyLedger = pgTable('economy_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  eventType: text('event_type').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: uuid('source_id'),
  delta: jsonb('delta').notNull(),
  revertsLedgerId: uuid('reverts_ledger_id').references(
    (): AnyPgColumn => economyLedger.id
  ),
  isReverted: boolean('is_reverted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});

export const resources = pgTable(
  'resources',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    resourceType: text('resource_type').notNull(),
    amount: integer('amount').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.resourceType] })
  })
);

export const eggTypes = pgTable('egg_types', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  baseIncubationSeconds: integer('base_incubation_seconds').notNull(),
  twitchRewardId: text('twitch_reward_id'),
  twitchRewardTitle: text('twitch_reward_title'),
  twitchRewardPrompt: text('twitch_reward_prompt'),
  twitchRewardCost: integer('twitch_reward_cost'),
  twitchRewardBackgroundColor: text('twitch_reward_background_color'),
  twitchRewardGlobalCooldownMinutes: integer(
    'twitch_reward_global_cooldown_minutes'
  ),
  twitchRewardMaxPerStream: integer('twitch_reward_max_per_stream'),
  twitchRewardMaxPerUserPerStream: integer(
    'twitch_reward_max_per_user_per_stream'
  ),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});

export const petRarities = pgTable(
  'pet_rarities',
  {
    id: text('id').primaryKey(),
    labelDe: text('label_de').notNull(),
    rank: integer('rank').notNull(),
    recycleCrackedEggs: integer('recycle_cracked_eggs').notNull().default(0),
    displayConfig: jsonb('display_config').notNull().default({}),
    economyConfig: jsonb('economy_config').notNull().default({}),
    combineProgressionConfig: jsonb('combine_progression_config')
      .notNull()
      .default({}),
    isActive: boolean('is_active').notNull().default(true)
  },
  (table) => ({
    rankUnique: uniqueIndex('pet_rarities_rank_idx').on(table.rank)
  })
);

export const petClasses = pgTable('pet_classes', {
  id: text('id').primaryKey(),
  labelDe: text('label_de').notNull(),
  description: text('description').notNull().default(''),
  relatedEnemyStat: text('related_enemy_stat').notNull()
});

export const elements = pgTable('elements', {
  id: text('id').primaryKey(),
  labelDe: text('label_de').notNull(),
  description: text('description').notNull().default(''),
  isActive: boolean('is_active').notNull().default(true)
});

export const petAbilities = pgTable('pet_abilities', {
  id: text('id').primaryKey(),
  labelDe: text('label_de').notNull(),
  description: text('description').notNull().default(''),
  apRequired: integer('ap_required').notNull(),
  minAttacksRequired: integer('min_attacks_required').notNull().default(0),
  effectType: text('effect_type').notNull(),
  effectConfig: jsonb('effect_config').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true)
});

export const hats = pgTable('hats', {
  id: text('id').primaryKey(),
  labelDe: text('label_de').notNull(),
  description: text('description').notNull().default(''),
  config: jsonb('config').notNull().default({}),
  isShopPurchasable: boolean('is_shop_purchasable').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});


export const shopOfferSelections = pgTable(
  'shop_offer_selections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    shopId: text('shop_id').notNull(),
    periodKey: text('period_key').notNull(),
    itemKind: text('item_kind').notNull(),
    typeId: text('type_id').notNull(),
    pairedTypeId: text('paired_type_id'),
    displayName: text('display_name').notNull(),
    description: text('description').notNull().default(''),
    resourcePrice: integer('resource_price').notNull(),
    stock: integer('stock').notNull(),
    displayOrder: integer('display_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    shopPeriodOrderUnique: uniqueIndex('shop_offer_selections_period_order_idx').on(
      table.shopId,
      table.periodKey,
      table.displayOrder
    )
  })
);

export const petSpecies = pgTable('pet_species', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  labelDe: text('label_de').notNull(),
  description: text('description').notNull().default(''),
  defaultHp: integer('default_hp').notNull(),
  defaultAtk: integer('default_atk').notNull(),
  defaultDef: integer('default_def').notNull(),
  defaultSpd: integer('default_spd').notNull(),
  defaultGain: integer('default_gain').notNull(),
  defaultPow: integer('default_pow').notNull(),
  rarityId: text('rarity_id')
    .notNull()
    .references(() => petRarities.id),
  classId: text('class_id')
    .notNull()
    .references(() => petClasses.id),
  elementId: text('element_id')
    .notNull()
    .references(() => elements.id),
  defaultAbilityId: text('default_ability_id')
    .notNull()
    .references(() => petAbilities.id),
  assetKey: text('asset_key').notNull(),
  isShopPurchasable: boolean('is_shop_purchasable').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true)
});

export const eggLootTableEntries = pgTable('egg_loot_table_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  eggTypeId: text('egg_type_id')
    .notNull()
    .references(() => eggTypes.id),
  weight: integer('weight').notNull(),
  outcomeType: text('outcome_type').notNull(),
  resourceType: text('resource_type'),
  resourceAmount: integer('resource_amount'),
  petSpeciesId: text('pet_species_id').references(() => petSpecies.id)
});

export const mysteryEggInventory = pgTable(
  'mystery_egg_inventory',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    eggTypeId: text('egg_type_id')
      .notNull()
      .references(() => eggTypes.id),
    amount: integer('amount').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.eggTypeId] })
  })
);

export const inventoryDimensions = pgTable(
  'inventory_dimensions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    inventoryKind: text('inventory_kind').notNull(),
    columns: integer('columns').notNull(),
    baseRows: integer('base_rows').notNull(),
    bonusRows: integer('bonus_rows').notNull().default(0),
    upgradeRef: text('upgrade_ref'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.inventoryKind] })
  })
);

export const unhatchedEggs = pgTable(
  'unhatched_eggs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    eggTypeId: text('egg_type_id')
      .notNull()
      .references(() => eggTypes.id),
    hiddenPetSpeciesId: text('hidden_pet_species_id')
      .notNull()
      .references(() => petSpecies.id),
    state: text('state').notNull(),
    slotIndex: integer('slot_index'),
    createdFromRedemptionId: uuid('created_from_redemption_id').references(
      () => channelPointRedemptions.id
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    ownerSlotUnique: uniqueIndex('unhatched_eggs_owner_slot_idx').on(
      table.ownerUserId,
      table.slotIndex
    )
  })
);

export const incubatorSlots = pgTable(
  'incubator_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    slotSource: text('slot_source').notNull(),
    slotLevel: integer('slot_level').notNull().default(1),
    slotIndex: integer('slot_index'),
    speedMultiplierBasisPoints: integer('speed_multiplier_basis_points')
      .notNull()
      .default(10000),
    specialBonusBasisPoints: integer('special_bonus_basis_points')
      .notNull()
      .default(0),
    fuelBehavior: text('fuel_behavior').notNull().default('none'),
    specialEffectConfig: jsonb('special_effect_config').notNull().default({}),
    isAvailable: boolean('is_available').notNull().default(true),
    removeWhenEmpty: boolean('remove_when_empty').notNull().default(false),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt
  },
  (table) => ({
    ownerSlotUnique: uniqueIndex('incubator_slots_owner_slot_idx').on(
      table.ownerUserId,
      table.slotIndex
    )
  })
);

export const incubationJobs = pgTable('incubation_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id),
  unhatchedEggId: uuid('unhatched_egg_id')
    .notNull()
    .references(() => unhatchedEggs.id),
  incubatorSlotId: uuid('incubator_slot_id')
    .notNull()
    .references(() => incubatorSlots.id),
  state: text('state').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  requiredProgressSeconds: integer('required_progress_seconds').notNull(),
  progressSecondsAccumulated: integer('progress_seconds_accumulated')
    .notNull()
    .default(0),
  lastProgressedAt: timestamp('last_progressed_at', { withTimezone: true }),
  progressSnapshot: jsonb('progress_snapshot').notNull()
});

export const petTraits = pgTable('pet_traits', {
  id: text('id').primaryKey(),
  labelDe: text('label_de').notNull(),
  description: text('description').notNull().default(''),
  hpModifier: integer('hp_modifier').notNull().default(0),
  atkModifier: integer('atk_modifier').notNull().default(0),
  defModifier: integer('def_modifier').notNull().default(0),
  spdModifier: integer('spd_modifier').notNull().default(0),
  gainModifier: integer('gain_modifier').notNull().default(0),
  powModifier: integer('pow_modifier').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamps.updatedAt
});

export const pets = pgTable(
  'pets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    speciesId: text('species_id')
      .notNull()
      .references(() => petSpecies.id),
    rarityId: text('rarity_id')
      .notNull()
      .references(() => petRarities.id),
    classId: text('class_id')
      .notNull()
      .references(() => petClasses.id),
    elementId: text('element_id')
      .notNull()
      .references(() => elements.id),
    abilityId: text('ability_id')
      .notNull()
      .references(() => petAbilities.id),
    nickname: text('nickname'),
    baseHp: integer('base_hp').notNull(),
    baseAtk: integer('base_atk').notNull(),
    baseDef: integer('base_def').notNull(),
    baseSpd: integer('base_spd').notNull(),
    baseGain: integer('base_gain').notNull(),
    basePow: integer('base_pow').notNull(),
    hatchVariance: jsonb('hatch_variance').notNull().default({}),
    experience: integer('experience').notNull().default(0),
    level: integer('level').notNull().default(0),
    equippedHatId: text('equipped_hat_id').references(() => hats.id),
    sourceUnhatchedEggId: uuid('source_unhatched_egg_id').references(() => unhatchedEggs.id),
    slotIndex: integer('slot_index'),
    isFavorite: boolean('is_favorite').notNull().default(false),
    selectedForEvent: boolean('selected_for_event').notNull().default(false),
    isScrapped: boolean('is_scrapped').notNull().default(false),
    scrappedAt: timestamp('scrapped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    ownerSlotUnique: uniqueIndex('pets_owner_slot_idx').on(
      table.ownerUserId,
      table.slotIndex
    )
  })
);

export const petTraitAssignments = pgTable(
  'pet_trait_assignments',
  {
    petId: uuid('pet_id')
      .notNull()
      .references(() => pets.id),
    traitId: text('trait_id')
      .notNull()
      .references(() => petTraits.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.petId, table.traitId] })
  })
);

export const consumableTypes = pgTable('consumable_types', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  effectType: text('effect_type').notNull(),
  config: jsonb('config').notNull(),
  resourcePrice: integer('resource_price').notNull().default(0),
  stock: integer('stock').notNull().default(0),
  isShopPurchasable: boolean('is_shop_purchasable').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true)
});

export const consumableInventorySlots = pgTable(
  'consumable_inventory_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    consumableTypeId: text('consumable_type_id')
      .notNull()
      .references(() => consumableTypes.id),
    slotIndex: integer('slot_index'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    userSlotUnique: uniqueIndex('consumable_inventory_slots_user_slot_idx').on(
      table.userId,
      table.slotIndex
    )
  })
);

export const equipmentTypes = pgTable('equipment_types', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  equipmentSlot: text('equipment_slot').notNull(),
  config: jsonb('config').notNull().default({}),
  resourcePrice: integer('resource_price').notNull().default(0),
  stock: integer('stock').notNull().default(0),
  isShopPurchasable: boolean('is_shop_purchasable').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});


export const equipmentSets = pgTable(
  'equipment_sets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    setIndex: integer('set_index').notNull(),
    label: text('label').notNull(),
    baseSlotCount: integer('base_slot_count').notNull().default(3),
    bonusSlotCount: integer('bonus_slot_count').notNull().default(0),
    selectedForEvent: boolean('selected_for_event').notNull().default(false),
    upgradeRef: text('upgrade_ref'),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt
  },
  (table) => ({
    userSetIndexUnique: uniqueIndex('equipment_sets_user_index_idx').on(
      table.userId,
      table.setIndex
    )
  })
);

export const equipmentInventorySlots = pgTable(
  'equipment_inventory_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    equipmentTypeId: text('equipment_type_id')
      .notNull()
      .references(() => equipmentTypes.id),
    slotIndex: integer('slot_index'),
    equipmentSetId: uuid('equipment_set_id').references(() => equipmentSets.id),
    equipmentSetSlotIndex: integer('equipment_set_slot_index'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    userSlotUnique: uniqueIndex('equipment_inventory_slots_user_slot_idx').on(
      table.userId,
      table.slotIndex
    ),
    setSlotUnique: uniqueIndex('equipment_inventory_slots_set_slot_idx').on(
      table.equipmentSetId,
      table.equipmentSetSlotIndex
    )
  })
);

export const userHatUnlocks = pgTable(
  'user_hat_unlocks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    hatId: text('hat_id')
      .notNull()
      .references(() => hats.id),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    sourceType: text('source_type').notNull().default('unknown'),
    sourceId: uuid('source_id')
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.hatId] })
  })
);

export const hatcheryUpgrades = pgTable('hatchery_upgrades', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  upgradeType: text('upgrade_type').notNull(),
  level: integer('level').notNull(),
  createdAt: timestamps.createdAt,
  updatedAt: timestamps.updatedAt
});

export const gameEvents = pgTable('game_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventType: text('event_type').notNull(),
  status: text('status').notNull(),
  startedByUserId: uuid('started_by_user_id').references(() => users.id),
  startedAt: timestamp('started_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  revertedAt: timestamp('reverted_at', { withTimezone: true }),
  resultJson: jsonb('result_json')
});

export const gameEventParticipants = pgTable('game_event_participants', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameEventId: uuid('game_event_id')
    .notNull()
    .references(() => gameEvents.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  petId: uuid('pet_id')
    .notNull()
    .references(() => pets.id),
  placement: integer('placement'),
  pointsAwarded: integer('points_awarded').notNull().default(0),
  runtimeState: jsonb('runtime_state').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});

export const leaderboardScores = pgTable(
  'leaderboard_scores',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    leaderboardType: text('leaderboard_type').notNull(),
    score: integer('score').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.leaderboardType] })
  })
);

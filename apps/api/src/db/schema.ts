import {
  AnyPgColumn,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
};

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  twitchUserId: text('twitch_user_id').notNull().unique(),
  twitchLogin: text('twitch_login'),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  isProvisional: boolean('is_provisional').notNull().default(true),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamps.createdAt,
  updatedAt: timestamps.updatedAt,
  lastLoginAt: timestamp('last_login_at', { withTimezone: true })
});


export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  sessionTokenHash: text('session_token_hash').notNull().unique(),
  csrfState: text('csrf_state'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true })
});

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: text('role').notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  userRoleUnique: uniqueIndex('roles_user_id_role_idx').on(table.userId, table.role)
}));


export const adminActionLogs = pgTable('admin_action_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id').notNull().references(() => users.id),
  targetUserId: uuid('target_user_id').references(() => users.id),
  actionType: text('action_type').notNull(),
  requestId: text('request_id').notNull().unique(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
export const twitchEvents = pgTable('twitch_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  twitchEventId: text('twitch_event_id').notNull().unique(),
  type: text('type').notNull(),
  source: text('source').notNull(),
  userId: uuid('user_id').references(() => users.id),
  rawPayload: jsonb('raw_payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingStatus: text('processing_status').notNull().default('received'),
  error: text('error')
});

export const channelPointRedemptions = pgTable('channel_point_redemptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  twitchRedemptionId: text('twitch_redemption_id').notNull().unique(),
  twitchRewardId: text('twitch_reward_id').notNull(),
  userId: uuid('user_id').references(() => users.id),
  cost: integer('cost').notNull(),
  status: text('status').notNull(),
  rawPayload: jsonb('raw_payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  revertsLedgerId: uuid('reverts_ledger_id').references((): AnyPgColumn => economyLedger.id),
  isReverted: boolean('is_reverted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const resources = pgTable(
  'resources',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    resourceType: text('resource_type').notNull(),
    amount: integer('amount').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.resourceType] })
  })
);

export const eggTypes = pgTable('egg_types', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  baseIncubationSeconds: integer('base_incubation_seconds').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const petTypes = pgTable('pet_types', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  rarity: text('rarity').notNull(),
  role: text('role').notNull(),
  baseHp: integer('base_hp').notNull(),
  baseAttack: integer('base_attack').notNull(),
  baseDefense: integer('base_defense').notNull(),
  baseSpeed: integer('base_speed').notNull(),
  assetKey: text('asset_key').notNull(),
  isActive: boolean('is_active').notNull().default(true)
});

export const eggLootTableEntries = pgTable('egg_loot_table_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  eggTypeId: text('egg_type_id').notNull().references(() => eggTypes.id),
  weight: integer('weight').notNull(),
  outcomeType: text('outcome_type').notNull(),
  resourceType: text('resource_type'),
  resourceAmount: integer('resource_amount'),
  petTypeId: text('pet_type_id').references(() => petTypes.id),
  isActive: boolean('is_active').notNull().default(true)
});

export const mysteryEggInventory = pgTable(
  'mystery_egg_inventory',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    eggTypeId: text('egg_type_id').notNull().references(() => eggTypes.id),
    amount: integer('amount').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.eggTypeId] })
  })
);

export const hiddenPetEggs = pgTable('hidden_pet_eggs', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  eggTypeId: text('egg_type_id').notNull().references(() => eggTypes.id),
  hiddenPetTypeId: text('hidden_pet_type_id').notNull().references(() => petTypes.id),
  state: text('state').notNull(),
  createdFromRedemptionId: uuid('created_from_redemption_id').references(() => channelPointRedemptions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const incubatorSlots = pgTable('incubator_slots', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  slotSource: text('slot_source').notNull(),
  slotLevel: integer('slot_level').notNull().default(1),
  isAvailable: boolean('is_available').notNull().default(true),
  removeWhenEmpty: boolean('remove_when_empty').notNull().default(false),
  createdAt: timestamps.createdAt,
  updatedAt: timestamps.updatedAt
});

export const incubationJobs = pgTable('incubation_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  hiddenPetEggId: uuid('hidden_pet_egg_id').notNull().references(() => hiddenPetEggs.id),
  incubatorSlotId: uuid('incubator_slot_id').notNull().references(() => incubatorSlots.id),
  state: text('state').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  requiredProgressSeconds: integer('required_progress_seconds').notNull(),
  progressSnapshot: jsonb('progress_snapshot').notNull()
});

export const pets = pgTable('pets', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  petTypeId: text('pet_type_id').notNull().references(() => petTypes.id),
  displayName: text('display_name'),
  hp: integer('hp').notNull(),
  attack: integer('attack').notNull(),
  defense: integer('defense').notNull(),
  speed: integer('speed').notNull(),
  statRolls: jsonb('stat_rolls').notNull(),
  sourceHiddenPetEggId: uuid('source_hidden_pet_egg_id').notNull().references(() => hiddenPetEggs.id),
  isFavorite: boolean('is_favorite').notNull().default(false),
  selectedForEvent: boolean('selected_for_event').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  hatchedAt: timestamp('hatched_at', { withTimezone: true }).notNull().defaultNow()
});

export const consumableTypes = pgTable('consumable_types', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  effectType: text('effect_type').notNull(),
  config: jsonb('config').notNull(),
  isActive: boolean('is_active').notNull().default(true)
});

export const consumableInventory = pgTable(
  'consumable_inventory',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    consumableTypeId: text('consumable_type_id').notNull().references(() => consumableTypes.id),
    amount: integer('amount').notNull().default(0)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.consumableTypeId] })
  })
);

export const hatcheryUpgrades = pgTable('hatchery_upgrades', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
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
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  revertedAt: timestamp('reverted_at', { withTimezone: true }),
  resultJson: jsonb('result_json')
});

export const gameEventParticipants = pgTable('game_event_participants', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameEventId: uuid('game_event_id').notNull().references(() => gameEvents.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  petId: uuid('pet_id').notNull().references(() => pets.id),
  placement: integer('placement'),
  pointsAwarded: integer('points_awarded').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const leaderboardScores = pgTable(
  'leaderboard_scores',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    leaderboardType: text('leaderboard_type').notNull(),
    score: integer('score').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.leaderboardType] })
  })
);

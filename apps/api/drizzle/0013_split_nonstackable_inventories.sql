CREATE TABLE "consumable_inventory_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "consumable_type_id" text NOT NULL REFERENCES "consumable_types"("id"),
  "slot_index" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "equipment_types" (
  "id" text PRIMARY KEY NOT NULL,
  "display_name" text NOT NULL,
  "description" text NOT NULL,
  "equipment_slot" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "equipment_inventory_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "equipment_type_id" text NOT NULL REFERENCES "equipment_types"("id"),
  "slot_index" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "hat_types" (
  "id" text PRIMARY KEY NOT NULL,
  "display_name" text NOT NULL,
  "description" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "hat_inventory_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "hat_type_id" text NOT NULL REFERENCES "hat_types"("id"),
  "slot_index" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

WITH expanded AS (
  SELECT
    cis.user_id,
    cis.consumable_type_id,
    cis.slot_index,
    cis.created_at,
    cis.updated_at,
    generate_series(1, cis.amount) AS copy_number
  FROM consumable_item_stacks cis
  WHERE cis.amount > 0
), ranked AS (
  SELECT
    user_id,
    consumable_type_id,
    created_at,
    updated_at,
    row_number() OVER (PARTITION BY user_id ORDER BY slot_index NULLS LAST, created_at, consumable_type_id, copy_number) - 1 AS slot_index
  FROM expanded
)
INSERT INTO consumable_inventory_slots (user_id, consumable_type_id, slot_index, created_at, updated_at)
SELECT
  user_id,
  consumable_type_id,
  CASE WHEN slot_index < 24 THEN slot_index ELSE NULL END,
  created_at,
  updated_at
FROM ranked;

CREATE UNIQUE INDEX "consumable_inventory_slots_user_slot_idx" ON "consumable_inventory_slots" ("user_id", "slot_index");
CREATE UNIQUE INDEX "equipment_inventory_slots_user_slot_idx" ON "equipment_inventory_slots" ("user_id", "slot_index");
CREATE UNIQUE INDEX "hat_inventory_slots_user_slot_idx" ON "hat_inventory_slots" ("user_id", "slot_index");

INSERT INTO "inventory_dimensions" ("user_id", "inventory_kind", "columns", "base_rows", "bonus_rows", "upgrade_ref", "updated_at")
SELECT id, 'consumables', 8, 3, 0, 'consumable_inventory_rows', now()
FROM users
ON CONFLICT ("user_id", "inventory_kind") DO UPDATE
SET "columns" = 8,
    "base_rows" = 3,
    "bonus_rows" = 0,
    "upgrade_ref" = 'consumable_inventory_rows',
    "updated_at" = now();

INSERT INTO "inventory_dimensions" ("user_id", "inventory_kind", "columns", "base_rows", "bonus_rows", "upgrade_ref", "updated_at")
SELECT id, 'equipment', 8, 3, 0, 'equipment_inventory_rows', now()
FROM users
ON CONFLICT ("user_id", "inventory_kind") DO NOTHING;

INSERT INTO "inventory_dimensions" ("user_id", "inventory_kind", "columns", "base_rows", "bonus_rows", "upgrade_ref", "updated_at")
SELECT id, 'hats', 8, 3, 0, 'hat_inventory_rows', now()
FROM users
ON CONFLICT ("user_id", "inventory_kind") DO NOTHING;

DELETE FROM "inventory_dimensions" WHERE "inventory_kind" = 'items';
DROP TABLE "consumable_item_stacks";
DROP TABLE "consumable_inventory";

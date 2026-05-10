CREATE TABLE "inventory_dimensions" (
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "inventory_kind" text NOT NULL,
  "columns" integer NOT NULL,
  "base_rows" integer NOT NULL,
  "bonus_rows" integer NOT NULL DEFAULT 0,
  "upgrade_ref" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_dimensions_user_id_inventory_kind_pk" PRIMARY KEY ("user_id", "inventory_kind")
);

ALTER TABLE "unhatched_eggs" ADD COLUMN "slot_index" integer;
ALTER TABLE "pets" ADD COLUMN "slot_index" integer;
ALTER TABLE "incubator_slots" ADD COLUMN "slot_index" integer;
ALTER TABLE "incubator_slots" ADD COLUMN "speed_multiplier_basis_points" integer NOT NULL DEFAULT 10000;
ALTER TABLE "incubator_slots" ADD COLUMN "special_bonus_basis_points" integer NOT NULL DEFAULT 0;
ALTER TABLE "incubator_slots" ADD COLUMN "fuel_behavior" text NOT NULL DEFAULT 'none';
ALTER TABLE "incubator_slots" ADD COLUMN "special_effect_config" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE "consumable_item_stacks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "consumable_type_id" text NOT NULL REFERENCES "consumable_types"("id"),
  "amount" integer NOT NULL DEFAULT 0,
  "slot_index" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

WITH user_ids AS (
  SELECT id AS user_id FROM users
  UNION SELECT owner_user_id AS user_id FROM unhatched_eggs
  UNION SELECT owner_user_id AS user_id FROM pets
  UNION SELECT user_id FROM consumable_inventory
  UNION SELECT owner_user_id AS user_id FROM incubator_slots
), counts AS (
  SELECT
    user_id,
    (SELECT count(*) FROM incubator_slots i WHERE i.owner_user_id = user_ids.user_id) AS incubator_count,
    (SELECT count(*) FROM unhatched_eggs e WHERE e.owner_user_id = user_ids.user_id AND e.state = 'ready_for_incubation') AS egg_count,
    (SELECT count(*) FROM pets p WHERE p.owner_user_id = user_ids.user_id) AS pet_count,
    (SELECT coalesce(sum(ceil(ci.amount / 99.0)), 0)::integer FROM consumable_inventory ci WHERE ci.user_id = user_ids.user_id) AS item_stack_count
  FROM user_ids
)
INSERT INTO "inventory_dimensions" ("user_id", "inventory_kind", "columns", "base_rows", "bonus_rows", "upgrade_ref")
SELECT user_id, 'incubators', 4, greatest(1, ceil(greatest(incubator_count, 1) / 4.0)::integer), 0, NULL FROM counts
UNION ALL
SELECT user_id, 'unhatched_eggs', 4, greatest(5, ceil(greatest(egg_count, 1) / 4.0)::integer), 0, 'unhatched_egg_inventory_rows' FROM counts
UNION ALL
SELECT user_id, 'pets', 4, greatest(5, ceil(greatest(pet_count, 1) / 4.0)::integer), 0, 'pet_inventory_rows' FROM counts
UNION ALL
SELECT user_id, 'items', 4, greatest(4, ceil(greatest(item_stack_count, 1) / 4.0)::integer), 0, 'item_inventory_rows' FROM counts;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY owner_user_id ORDER BY created_at, id) - 1 AS slot_index
  FROM unhatched_eggs
  WHERE state = 'ready_for_incubation'
)
UPDATE unhatched_eggs e SET slot_index = ranked.slot_index FROM ranked WHERE e.id = ranked.id;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY owner_user_id ORDER BY created_at, id) - 1 AS slot_index
  FROM pets
)
UPDATE pets p SET slot_index = ranked.slot_index FROM ranked WHERE p.id = ranked.id;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY owner_user_id ORDER BY created_at, id) - 1 AS slot_index
  FROM incubator_slots
)
UPDATE incubator_slots i SET slot_index = ranked.slot_index FROM ranked WHERE i.id = ranked.id;

WITH stack_source AS (
  SELECT
    ci.user_id,
    ci.consumable_type_id,
    generate_series(0, ceil(ci.amount / 99.0)::integer - 1) AS stack_number,
    ci.amount
  FROM consumable_inventory ci
  WHERE ci.amount > 0
), stacks AS (
  SELECT
    user_id,
    consumable_type_id,
    least(99, amount - (stack_number * 99)) AS stack_amount,
    row_number() OVER (PARTITION BY user_id ORDER BY consumable_type_id, stack_number) - 1 AS slot_index
  FROM stack_source
)
INSERT INTO consumable_item_stacks (user_id, consumable_type_id, amount, slot_index)
SELECT user_id, consumable_type_id, stack_amount, slot_index FROM stacks WHERE stack_amount > 0;

CREATE UNIQUE INDEX "unhatched_eggs_owner_slot_idx" ON "unhatched_eggs" ("owner_user_id", "slot_index");
CREATE UNIQUE INDEX "pets_owner_slot_idx" ON "pets" ("owner_user_id", "slot_index");
CREATE UNIQUE INDEX "incubator_slots_owner_slot_idx" ON "incubator_slots" ("owner_user_id", "slot_index");
CREATE UNIQUE INDEX "consumable_item_stacks_user_slot_idx" ON "consumable_item_stacks" ("user_id", "slot_index");

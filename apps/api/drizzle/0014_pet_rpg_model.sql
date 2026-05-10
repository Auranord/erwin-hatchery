CREATE TABLE IF NOT EXISTS "pet_rarities" (
  "id" text PRIMARY KEY NOT NULL,
  "label_de" text NOT NULL,
  "rank" integer NOT NULL,
  "recycle_cracked_eggs" integer NOT NULL DEFAULT 0,
  "display_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "economy_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "combine_progression_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "pet_classes" (
  "id" text PRIMARY KEY NOT NULL,
  "label_de" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "related_enemy_stat" text
);

CREATE TABLE IF NOT EXISTS "elements" (
  "id" text PRIMARY KEY NOT NULL,
  "label_de" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "is_active" boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "pet_abilities" (
  "id" text PRIMARY KEY NOT NULL,
  "label_de" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "ap_required" integer NOT NULL,
  "min_attacks_required" integer NOT NULL DEFAULT 0,
  "effect_type" text NOT NULL,
  "effect_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true
);

INSERT INTO pet_rarities (id, label_de, rank, recycle_cracked_eggs, is_active) VALUES
  ('regular', 'Gewöhnlich', 1, 10, true),
  ('rare', 'Selten', 2, 35, true)
ON CONFLICT (id) DO UPDATE SET label_de = excluded.label_de, rank = excluded.rank, recycle_cracked_eggs = excluded.recycle_cracked_eggs, is_active = true;

INSERT INTO pet_classes (id, label_de, description, related_enemy_stat) VALUES
  ('protector', 'Beschützer', 'Schützt das Team, indem er gegnerischen Angriffsdruck bindet.', 'ATK'),
  ('sunderer', 'Spalter', 'Bricht zähe Verteidigungen auf und zielt auf gegnerische DEF.', 'DEF'),
  ('saboteur', 'Saboteur', 'Stört schnelle Gegner und zielt auf gegnerische SPD.', 'SPD'),
  ('drainer', 'Entlader', 'Bremst den gegnerischen AP-Aufbau und zielt auf GAIN.', 'GAIN'),
  ('nullifier', 'Bannbrecher', 'Schwächt gegnerische Fähigkeitseffekte und zielt auf POW.', 'POW')
ON CONFLICT (id) DO UPDATE SET label_de = excluded.label_de, description = excluded.description, related_enemy_stat = excluded.related_enemy_stat;

INSERT INTO elements (id, label_de, description, is_active) VALUES
  ('nature', 'Natur', 'Natur-Element.', true),
  ('air', 'Luft', 'Luft-Element.', true),
  ('water', 'Wasser', 'Wasser-Element.', true),
  ('shadow', 'Schatten', 'Schatten-Element.', true),
  ('light', 'Licht', 'Licht-Element.', true)
ON CONFLICT (id) DO UPDATE SET label_de = excluded.label_de, description = excluded.description, is_active = true;

INSERT INTO pet_abilities (id, label_de, description, ap_required, min_attacks_required, effect_type, is_active) VALUES
  ('peck_burst', 'Pick-Salve', 'Automatische Basisfähigkeit.', 100, 1, 'damage', true),
  ('glimmer_dash', 'Glitzer-Sprint', 'Automatische Basisfähigkeit.', 80, 2, 'damage', true),
  ('mud_guard', 'Moorwache', 'Automatische Basisfähigkeit.', 120, 1, 'shield', true),
  ('owl_strike', 'Eulenschlag', 'Automatische Basisfähigkeit.', 100, 1, 'damage', true),
  ('golden_crowl', 'Goldruf', 'Automatische Basisfähigkeit.', 100, 1, 'damage', true)
ON CONFLICT (id) DO UPDATE SET label_de = excluded.label_de, description = excluded.description, ap_required = excluded.ap_required, min_attacks_required = excluded.min_attacks_required, effect_type = excluded.effect_type, is_active = true;

DO $$
BEGIN
  IF to_regclass('public.pet_species') IS NULL AND to_regclass('public.pet_types') IS NOT NULL THEN
    ALTER TABLE pet_types RENAME TO pet_species;
  END IF;
  IF to_regclass('public.hats') IS NULL AND to_regclass('public.hat_types') IS NOT NULL THEN
    ALTER TABLE hat_types RENAME TO hats;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "hats" (
  "id" text PRIMARY KEY NOT NULL,
  "label_de" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE pet_species ADD COLUMN IF NOT EXISTS label_de text;
UPDATE pet_species SET label_de = coalesce(label_de, display_name) WHERE label_de IS NULL;
ALTER TABLE pet_species ALTER COLUMN label_de SET NOT NULL;
ALTER TABLE pet_species ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pet_species' AND column_name = 'base_hp')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pet_species' AND column_name = 'default_hp') THEN
    ALTER TABLE pet_species RENAME COLUMN base_hp TO default_hp;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pet_species' AND column_name = 'base_attack')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pet_species' AND column_name = 'default_atk') THEN
    ALTER TABLE pet_species RENAME COLUMN base_attack TO default_atk;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pet_species' AND column_name = 'base_defense')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pet_species' AND column_name = 'default_def') THEN
    ALTER TABLE pet_species RENAME COLUMN base_defense TO default_def;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pet_species' AND column_name = 'base_speed')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pet_species' AND column_name = 'default_spd') THEN
    ALTER TABLE pet_species RENAME COLUMN base_speed TO default_spd;
  END IF;
END $$;

ALTER TABLE pet_species ADD COLUMN IF NOT EXISTS default_gain integer NOT NULL DEFAULT 100;
ALTER TABLE pet_species ADD COLUMN IF NOT EXISTS default_pow integer NOT NULL DEFAULT 100;

ALTER TABLE egg_loot_table_entries ADD COLUMN IF NOT EXISTS pet_species_id text;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'egg_loot_table_entries' AND column_name = 'pet_type_id') THEN
    UPDATE egg_loot_table_entries SET pet_species_id = coalesce(pet_species_id, pet_type_id);
    ALTER TABLE egg_loot_table_entries DROP COLUMN pet_type_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'unhatched_eggs' AND column_name = 'hidden_pet_type_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'unhatched_eggs' AND column_name = 'hidden_pet_species_id') THEN
    ALTER TABLE unhatched_eggs RENAME COLUMN hidden_pet_type_id TO hidden_pet_species_id;
  END IF;
END $$;

ALTER TABLE pets ADD COLUMN IF NOT EXISTS species_id text;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'pet_type_id') THEN
    UPDATE pets SET species_id = coalesce(species_id, pet_type_id);
  END IF;
END $$;
UPDATE pets SET species_id = 'waldwachtel' WHERE species_id IS NULL;
ALTER TABLE pets ALTER COLUMN species_id SET NOT NULL;

ALTER TABLE pets ADD COLUMN IF NOT EXISTS rarity_id text;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pet_species' AND column_name = 'rarity') THEN
    UPDATE pets p SET rarity_id = coalesce(p.rarity_id, ps.rarity, 'regular') FROM pet_species ps WHERE p.species_id = ps.id;
  END IF;
END $$;
UPDATE pets SET rarity_id = coalesce(rarity_id, CASE WHEN species_id = 'goldener_erwin' THEN 'rare' ELSE 'regular' END);
ALTER TABLE pets ALTER COLUMN rarity_id SET NOT NULL;

ALTER TABLE pets ADD COLUMN IF NOT EXISTS class_id text;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pet_species' AND column_name = 'role') THEN
    UPDATE pets p SET class_id = coalesce(
      p.class_id,
      CASE ps.role
        WHEN 'fast' THEN 'saboteur'
        WHEN 'tank' THEN 'protector'
        WHEN 'allrounder' THEN 'nullifier'
        WHEN 'rare_allrounder' THEN 'nullifier'
        WHEN 'balanced' THEN 'drainer'
        WHEN 'striker' THEN 'sunderer'
        ELSE ps.role
      END,
      'drainer'
    ) FROM pet_species ps WHERE p.species_id = ps.id;
  END IF;
END $$;
UPDATE pets SET class_id = CASE coalesce(class_id, '')
  WHEN 'balanced' THEN 'drainer'
  WHEN 'fast' THEN 'saboteur'
  WHEN 'scout' THEN 'saboteur'
  WHEN 'tank' THEN 'protector'
  WHEN 'guardian' THEN 'protector'
  WHEN 'striker' THEN 'sunderer'
  WHEN 'allrounder' THEN 'nullifier'
  WHEN 'rare_allrounder' THEN 'nullifier'
  WHEN 'hero' THEN 'nullifier'
  WHEN '' THEN CASE species_id WHEN 'glitzer_spatz' THEN 'saboteur' WHEN 'moorente' THEN 'protector' WHEN 'turmeule' THEN 'sunderer' WHEN 'goldener_erwin' THEN 'nullifier' ELSE 'drainer' END
  ELSE class_id
END;
ALTER TABLE pets ALTER COLUMN class_id SET NOT NULL;

ALTER TABLE pets ADD COLUMN IF NOT EXISTS element_id text;
UPDATE pets SET element_id = coalesce(element_id, CASE species_id WHEN 'glitzer_spatz' THEN 'air' WHEN 'moorente' THEN 'water' WHEN 'turmeule' THEN 'shadow' WHEN 'goldener_erwin' THEN 'light' ELSE 'nature' END);
ALTER TABLE pets ALTER COLUMN element_id SET NOT NULL;

ALTER TABLE pets ADD COLUMN IF NOT EXISTS ability_id text;
UPDATE pets SET ability_id = coalesce(ability_id, CASE species_id WHEN 'glitzer_spatz' THEN 'glimmer_dash' WHEN 'moorente' THEN 'mud_guard' WHEN 'turmeule' THEN 'owl_strike' WHEN 'goldener_erwin' THEN 'golden_crowl' ELSE 'peck_burst' END);
ALTER TABLE pets ALTER COLUMN ability_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'display_name')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'nickname') THEN
    ALTER TABLE pets RENAME COLUMN display_name TO nickname;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'hp')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'base_hp') THEN
    ALTER TABLE pets RENAME COLUMN hp TO base_hp;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'attack')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'base_atk') THEN
    ALTER TABLE pets RENAME COLUMN attack TO base_atk;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'defense')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'base_def') THEN
    ALTER TABLE pets RENAME COLUMN defense TO base_def;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'speed')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'base_spd') THEN
    ALTER TABLE pets RENAME COLUMN speed TO base_spd;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'stat_rolls')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pets' AND column_name = 'hatch_variance') THEN
    ALTER TABLE pets RENAME COLUMN stat_rolls TO hatch_variance;
  END IF;
END $$;

ALTER TABLE pets ADD COLUMN IF NOT EXISTS base_gain integer NOT NULL DEFAULT 100;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS base_pow integer NOT NULL DEFAULT 100;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS equipped_hat_id text;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS hatch_variance jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hats' AND column_name = 'display_name')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hats' AND column_name = 'label_de') THEN
    ALTER TABLE hats RENAME COLUMN display_name TO label_de;
  END IF;
END $$;
ALTER TABLE hats ADD COLUMN IF NOT EXISTS label_de text;
UPDATE hats SET label_de = coalesce(label_de, id) WHERE label_de IS NULL;
ALTER TABLE hats ALTER COLUMN label_de SET NOT NULL;
ALTER TABLE hats ALTER COLUMN description SET DEFAULT '';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hat_inventory_slots' AND column_name = 'hat_type_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hat_inventory_slots' AND column_name = 'hat_id') THEN
    ALTER TABLE hat_inventory_slots RENAME COLUMN hat_type_id TO hat_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'incubator_slots' AND column_name = 'rarity_bonus_basis_points')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'incubator_slots' AND column_name = 'special_bonus_basis_points') THEN
    ALTER TABLE incubator_slots RENAME COLUMN rarity_bonus_basis_points TO special_bonus_basis_points;
  END IF;
END $$;

ALTER TABLE game_event_participants ADD COLUMN IF NOT EXISTS runtime_state jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE pet_species DROP COLUMN IF EXISTS rarity;
ALTER TABLE pet_species DROP COLUMN IF EXISTS role;
ALTER TABLE pets DROP COLUMN IF EXISTS pet_type_id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'egg_loot_table_entries_pet_species_id_fkey') THEN
    ALTER TABLE egg_loot_table_entries ADD CONSTRAINT egg_loot_table_entries_pet_species_id_fkey FOREIGN KEY (pet_species_id) REFERENCES pet_species(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unhatched_eggs_hidden_pet_species_id_fkey') THEN
    ALTER TABLE unhatched_eggs ADD CONSTRAINT unhatched_eggs_hidden_pet_species_id_fkey FOREIGN KEY (hidden_pet_species_id) REFERENCES pet_species(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pets_species_id_fkey') THEN
    ALTER TABLE pets ADD CONSTRAINT pets_species_id_fkey FOREIGN KEY (species_id) REFERENCES pet_species(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pets_rarity_id_fkey') THEN
    ALTER TABLE pets ADD CONSTRAINT pets_rarity_id_fkey FOREIGN KEY (rarity_id) REFERENCES pet_rarities(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pets_class_id_fkey') THEN
    ALTER TABLE pets ADD CONSTRAINT pets_class_id_fkey FOREIGN KEY (class_id) REFERENCES pet_classes(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pets_element_id_fkey') THEN
    ALTER TABLE pets ADD CONSTRAINT pets_element_id_fkey FOREIGN KEY (element_id) REFERENCES elements(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pets_ability_id_fkey') THEN
    ALTER TABLE pets ADD CONSTRAINT pets_ability_id_fkey FOREIGN KEY (ability_id) REFERENCES pet_abilities(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pets_equipped_hat_id_fkey') THEN
    ALTER TABLE pets ADD CONSTRAINT pets_equipped_hat_id_fkey FOREIGN KEY (equipped_hat_id) REFERENCES hats(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hat_inventory_slots_hat_id_fkey') THEN
    ALTER TABLE hat_inventory_slots ADD CONSTRAINT hat_inventory_slots_hat_id_fkey FOREIGN KEY (hat_id) REFERENCES hats(id);
  END IF;
END $$;

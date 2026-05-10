ALTER TABLE pet_species ADD COLUMN IF NOT EXISTS default_ability_id text;

UPDATE pet_species
SET default_ability_id = CASE id
  WHEN 'waldwachtel' THEN 'peck_burst'
  WHEN 'glitzer_spatz' THEN 'glimmer_dash'
  WHEN 'moorente' THEN 'mud_guard'
  WHEN 'turmeule' THEN 'owl_strike'
  WHEN 'goldener_erwin' THEN 'golden_crowl'
  ELSE 'peck_burst'
END
WHERE default_ability_id IS NULL;

ALTER TABLE pet_species ALTER COLUMN default_ability_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pet_species_default_ability_id_fkey') THEN
    ALTER TABLE pet_species ADD CONSTRAINT pet_species_default_ability_id_fkey FOREIGN KEY (default_ability_id) REFERENCES pet_abilities(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pet_traits (
  id text PRIMARY KEY,
  label_de text NOT NULL,
  description text NOT NULL DEFAULT '',
  hp_modifier integer NOT NULL DEFAULT 0,
  atk_modifier integer NOT NULL DEFAULT 0,
  def_modifier integer NOT NULL DEFAULT 0,
  spd_modifier integer NOT NULL DEFAULT 0,
  gain_modifier integer NOT NULL DEFAULT 0,
  pow_modifier integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pet_trait_assignments (
  pet_id uuid NOT NULL REFERENCES pets(id),
  trait_id text NOT NULL REFERENCES pet_traits(id),
  assigned_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (pet_id, trait_id)
);

ALTER TABLE pet_species ADD COLUMN IF NOT EXISTS rarity_id text;
ALTER TABLE pet_species ADD COLUMN IF NOT EXISTS class_id text;
ALTER TABLE pet_species ADD COLUMN IF NOT EXISTS element_id text;

UPDATE pet_species
SET rarity_id = data.rarity_id,
    class_id = data.class_id,
    element_id = data.element_id
FROM (VALUES
  ('glutfink', 'common', 'nullifier', 'fire'),
  ('bachente', 'common', 'nullifier', 'water'),
  ('windlerche', 'common', 'nullifier', 'air'),
  ('kieseltaube', 'common', 'protector', 'earth'),
  ('funkenmeise', 'common', 'protector', 'fire'),
  ('schilfreiher', 'common', 'sunderer', 'water'),
  ('mooswachtel', 'common', 'sunderer', 'air'),
  ('erdspatz', 'common', 'saboteur', 'earth'),
  ('rauchsegler', 'common', 'saboteur', 'fire'),
  ('tropfenmoewe', 'common', 'drainer', 'water'),
  ('wolkenzaunkoenig', 'common', 'drainer', 'air'),
  ('knollenhuhn', 'common', 'drainer', 'earth'),
  ('kerzenkauz', 'uncommon', 'protector', 'fire'),
  ('perlentaucher', 'uncommon', 'protector', 'water'),
  ('sturmschwalbe', 'uncommon', 'sunderer', 'air'),
  ('lehmspecht', 'uncommon', 'sunderer', 'earth'),
  ('kupferfasan', 'uncommon', 'sunderer', 'fire'),
  ('regenkranich', 'uncommon', 'saboteur', 'water'),
  ('boeenfalke', 'uncommon', 'saboteur', 'air'),
  ('wurzelrabe', 'uncommon', 'saboteur', 'earth'),
  ('phoenixkueken', 'rare', 'nullifier', 'fire'),
  ('mondreiher', 'rare', 'nullifier', 'water'),
  ('himmelsgreifchen', 'rare', 'protector', 'air'),
  ('runenwachtel', 'rare', 'protector', 'air'),
  ('kristallkraehe', 'rare', 'drainer', 'earth'),
  ('obsidianule', 'rare', 'drainer', 'earth'),
  ('sonnenroc', 'epic', 'sunderer', 'fire'),
  ('tiefseealk', 'epic', 'saboteur', 'water'),
  ('bergwyrm_kondor', 'epic', 'drainer', 'earth'),
  ('lichtseraph', 'legendary', 'nullifier', 'light')
) AS data(id, rarity_id, class_id, element_id)
WHERE pet_species.id = data.id
  AND (pet_species.rarity_id IS NULL OR pet_species.class_id IS NULL OR pet_species.element_id IS NULL);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pet_species
    WHERE rarity_id IS NULL OR class_id IS NULL OR element_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot make pet_species dimensions required while rows are missing rarity/class/element assignments';
  END IF;
END $$;

ALTER TABLE pet_species ALTER COLUMN rarity_id SET NOT NULL;
ALTER TABLE pet_species ALTER COLUMN class_id SET NOT NULL;
ALTER TABLE pet_species ALTER COLUMN element_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'pet_species'::regclass
      AND c.contype = 'f'
      AND a.attname = 'rarity_id'
  ) THEN
    ALTER TABLE pet_species
      ADD CONSTRAINT pet_species_rarity_id_pet_rarities_id_fk
      FOREIGN KEY (rarity_id) REFERENCES pet_rarities(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'pet_species'::regclass
      AND c.contype = 'f'
      AND a.attname = 'class_id'
  ) THEN
    ALTER TABLE pet_species
      ADD CONSTRAINT pet_species_class_id_pet_classes_id_fk
      FOREIGN KEY (class_id) REFERENCES pet_classes(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'pet_species'::regclass
      AND c.contype = 'f'
      AND a.attname = 'element_id'
  ) THEN
    ALTER TABLE pet_species
      ADD CONSTRAINT pet_species_element_id_elements_id_fk
      FOREIGN KEY (element_id) REFERENCES elements(id);
  END IF;
END $$;

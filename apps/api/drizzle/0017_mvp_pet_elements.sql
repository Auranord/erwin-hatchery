INSERT INTO elements (id, label_de, description, is_active) VALUES
  ('fire', 'Feuer', 'Feuer-Element.', true),
  ('water', 'Wasser', 'Wasser-Element.', true),
  ('air', 'Luft', 'Luft-Element.', true),
  ('earth', 'Erde', 'Erde-Element.', true),
  ('light', 'Licht', 'Licht-Element.', true)
ON CONFLICT (id) DO UPDATE SET
  label_de = excluded.label_de,
  description = excluded.description,
  is_active = true;

UPDATE pets
SET element_id = CASE element_id
  WHEN 'nature' THEN 'earth'
  WHEN 'shadow' THEN 'fire'
  ELSE element_id
END
WHERE element_id IN ('nature', 'shadow');

UPDATE pets
SET element_id = CASE species_id
  WHEN 'glitzer_spatz' THEN 'air'
  WHEN 'moorente' THEN 'water'
  WHEN 'turmeule' THEN 'fire'
  WHEN 'goldener_erwin' THEN 'light'
  ELSE 'earth'
END
WHERE element_id IS NULL
  OR element_id NOT IN ('fire', 'water', 'air', 'earth', 'light');

DELETE FROM elements WHERE id IN ('nature', 'shadow');

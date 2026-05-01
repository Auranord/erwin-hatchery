CREATE TABLE IF NOT EXISTS mystery_egg_inventory (
  user_id uuid NOT NULL REFERENCES users(id),
  egg_type_id text NOT NULL REFERENCES egg_types(id),
  amount integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, egg_type_id)
);

INSERT INTO mystery_egg_inventory (user_id, egg_type_id, amount, updated_at)
SELECT owner_user_id, egg_type_id, COUNT(*), now()
FROM mystery_eggs
WHERE state IN ('unidentified', 'identified')
GROUP BY owner_user_id, egg_type_id
ON CONFLICT (user_id, egg_type_id)
DO UPDATE SET amount = mystery_egg_inventory.amount + EXCLUDED.amount, updated_at = now();

ALTER TABLE hidden_pet_eggs ADD COLUMN IF NOT EXISTS created_from_redemption_id uuid REFERENCES channel_point_redemptions(id);

UPDATE hidden_pet_eggs h
SET created_from_redemption_id = m.created_from_redemption_id
FROM mystery_eggs m
WHERE h.created_from_mystery_egg_id = m.id
  AND h.created_from_redemption_id IS NULL;

ALTER TABLE hidden_pet_eggs DROP CONSTRAINT IF EXISTS hidden_pet_eggs_created_from_mystery_egg_id_mystery_eggs_id_fk;
ALTER TABLE hidden_pet_eggs DROP COLUMN IF EXISTS created_from_mystery_egg_id;

DROP TABLE IF EXISTS mystery_eggs;

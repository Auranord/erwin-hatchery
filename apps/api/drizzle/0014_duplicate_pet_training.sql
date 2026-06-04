ALTER TABLE pets ADD COLUMN IF NOT EXISTS training_points integer NOT NULL DEFAULT 0;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS level_bonus_hp integer NOT NULL DEFAULT 0;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS level_bonus_atk integer NOT NULL DEFAULT 0;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS level_bonus_def integer NOT NULL DEFAULT 0;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS level_bonus_spd integer NOT NULL DEFAULT 0;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS level_bonus_gain integer NOT NULL DEFAULT 0;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS level_bonus_pow integer NOT NULL DEFAULT 0;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE pets ADD COLUMN IF NOT EXISTS consumed_by_pet_id uuid REFERENCES pets(id);
ALTER TABLE pets ADD COLUMN IF NOT EXISTS consumed_at timestamp with time zone;

UPDATE pets SET training_points = experience WHERE training_points = 0 AND experience > 0;
UPDATE pets SET status = 'active' WHERE status IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pets_status_check'
  ) THEN
    ALTER TABLE pets
      ADD CONSTRAINT pets_status_check CHECK (status IN ('active', 'consumed'));
  END IF;
END $$;

ALTER TABLE pet_classes ADD COLUMN IF NOT EXISTS main_stat text;
ALTER TABLE pet_classes ADD COLUMN IF NOT EXISTS secondary_stat_one text;
ALTER TABLE pet_classes ADD COLUMN IF NOT EXISTS secondary_stat_two text;

UPDATE pet_classes
SET
  main_stat = data.main_stat,
  secondary_stat_one = data.secondary_stat_one,
  secondary_stat_two = data.secondary_stat_two
FROM (VALUES
  ('protector', 'DEF', 'HP', 'GAIN'),
  ('sunderer', 'ATK', 'SPD', 'POW'),
  ('saboteur', 'SPD', 'ATK', 'GAIN'),
  ('drainer', 'GAIN', 'HP', 'POW'),
  ('nullifier', 'POW', 'DEF', 'SPD')
) AS data(id, main_stat, secondary_stat_one, secondary_stat_two)
WHERE pet_classes.id = data.id;

UPDATE pet_classes
SET
  main_stat = COALESCE(main_stat, related_enemy_stat),
  secondary_stat_one = COALESCE(secondary_stat_one, related_enemy_stat),
  secondary_stat_two = COALESCE(secondary_stat_two, related_enemy_stat)
WHERE main_stat IS NULL
   OR secondary_stat_one IS NULL
   OR secondary_stat_two IS NULL;

ALTER TABLE pet_classes ALTER COLUMN main_stat SET NOT NULL;
ALTER TABLE pet_classes ALTER COLUMN secondary_stat_one SET NOT NULL;
ALTER TABLE pet_classes ALTER COLUMN secondary_stat_two SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pet_classes_related_enemy_stat_check'
  ) THEN
    ALTER TABLE pet_classes
      ADD CONSTRAINT pet_classes_related_enemy_stat_check
      CHECK (related_enemy_stat IN ('HP', 'ATK', 'DEF', 'SPD', 'GAIN', 'POW'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pet_classes_main_stat_check'
  ) THEN
    ALTER TABLE pet_classes
      ADD CONSTRAINT pet_classes_main_stat_check
      CHECK (main_stat IN ('HP', 'ATK', 'DEF', 'SPD', 'GAIN', 'POW'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pet_classes_secondary_stat_one_check'
  ) THEN
    ALTER TABLE pet_classes
      ADD CONSTRAINT pet_classes_secondary_stat_one_check
      CHECK (secondary_stat_one IN ('HP', 'ATK', 'DEF', 'SPD', 'GAIN', 'POW'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pet_classes_secondary_stat_two_check'
  ) THEN
    ALTER TABLE pet_classes
      ADD CONSTRAINT pet_classes_secondary_stat_two_check
      CHECK (secondary_stat_two IN ('HP', 'ATK', 'DEF', 'SPD', 'GAIN', 'POW'));
  END IF;
END $$;

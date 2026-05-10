ALTER TABLE pet_classes ADD COLUMN IF NOT EXISTS related_enemy_stat text;

INSERT INTO pet_classes (id, label_de, description, related_enemy_stat) VALUES
  ('protector', 'Beschützer', 'Schützt das Team, indem er gegnerischen Angriffsdruck bindet.', 'ATK'),
  ('sunderer', 'Spalter', 'Bricht zähe Verteidigungen auf und zielt auf gegnerische DEF.', 'DEF'),
  ('saboteur', 'Saboteur', 'Stört schnelle Gegner und zielt auf gegnerische SPD.', 'SPD'),
  ('drainer', 'Entlader', 'Bremst den gegnerischen AP-Aufbau und zielt auf GAIN.', 'GAIN'),
  ('nullifier', 'Bannbrecher', 'Schwächt gegnerische Fähigkeitseffekte und zielt auf POW.', 'POW')
ON CONFLICT (id) DO UPDATE SET
  label_de = excluded.label_de,
  description = excluded.description,
  related_enemy_stat = excluded.related_enemy_stat;

UPDATE pets SET class_id = CASE class_id
  WHEN 'balanced' THEN 'drainer'
  WHEN 'fast' THEN 'saboteur'
  WHEN 'scout' THEN 'saboteur'
  WHEN 'tank' THEN 'protector'
  WHEN 'guardian' THEN 'protector'
  WHEN 'striker' THEN 'sunderer'
  WHEN 'allrounder' THEN 'nullifier'
  WHEN 'rare_allrounder' THEN 'nullifier'
  WHEN 'hero' THEN 'nullifier'
  ELSE class_id
END
WHERE class_id IN ('balanced', 'fast', 'scout', 'tank', 'guardian', 'striker', 'allrounder', 'rare_allrounder', 'hero');

DELETE FROM pet_classes WHERE id IN ('balanced', 'scout', 'guardian', 'striker', 'hero');

ALTER TABLE pet_classes DROP COLUMN IF EXISTS is_active;

ALTER TABLE pet_classes ALTER COLUMN related_enemy_stat SET NOT NULL;

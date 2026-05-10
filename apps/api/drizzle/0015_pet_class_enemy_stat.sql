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

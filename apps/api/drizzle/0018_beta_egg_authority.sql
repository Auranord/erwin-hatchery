-- Hatchery is authoritative for MVP egg reward types.
-- Beta Ei is active/redemption-backed; Starter Ei remains inactive and is granted once to each player.
UPDATE egg_types
SET is_active = false
WHERE id NOT IN ('beta_egg', 'starter_egg');
DELETE FROM egg_types
WHERE id NOT IN ('beta_egg', 'starter_egg')
  AND NOT EXISTS (SELECT 1 FROM mystery_egg_inventory WHERE mystery_egg_inventory.egg_type_id = egg_types.id)
  AND NOT EXISTS (SELECT 1 FROM unhatched_eggs WHERE unhatched_eggs.egg_type_id = egg_types.id)
  AND NOT EXISTS (SELECT 1 FROM egg_loot_table_entries WHERE egg_loot_table_entries.egg_type_id = egg_types.id);

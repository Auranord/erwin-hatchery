WITH stats AS (
  SELECT
    id AS user_id,
    coalesce((SELECT max(e.slot_index) + 1 FROM unhatched_eggs e WHERE e.owner_user_id = users.id AND e.state = 'ready_for_incubation'), 0) AS egg_slots_used,
    coalesce((SELECT max(p.slot_index) + 1 FROM pets p WHERE p.owner_user_id = users.id), 0) AS pet_slots_used,
    coalesce((SELECT max(cis.slot_index) + 1 FROM consumable_item_stacks cis WHERE cis.user_id = users.id), 0) AS item_slots_used
  FROM users
)
UPDATE inventory_dimensions d
SET
  columns = CASE d.inventory_kind
    WHEN 'unhatched_eggs' THEN 8
    WHEN 'pets' THEN 4
    WHEN 'items' THEN 8
    ELSE d.columns
  END,
  base_rows = CASE d.inventory_kind
    WHEN 'unhatched_eggs' THEN greatest(3, ceil(greatest(stats.egg_slots_used, 1) / 8.0)::integer)
    WHEN 'pets' THEN greatest(4, ceil(greatest(stats.pet_slots_used, 1) / 4.0)::integer)
    WHEN 'items' THEN greatest(3, ceil(greatest(stats.item_slots_used, 1) / 8.0)::integer)
    ELSE d.base_rows
  END,
  updated_at = now()
FROM stats
WHERE d.user_id = stats.user_id
  AND d.inventory_kind IN ('unhatched_eggs', 'pets', 'items');

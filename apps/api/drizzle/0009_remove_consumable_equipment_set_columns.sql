ALTER TABLE consumable_inventory_slots
  DROP COLUMN IF EXISTS equipment_set_id,
  DROP COLUMN IF EXISTS equipment_set_slot_index;

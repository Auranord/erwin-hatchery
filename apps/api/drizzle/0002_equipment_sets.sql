CREATE TABLE IF NOT EXISTS equipment_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  set_index integer NOT NULL,
  label text NOT NULL,
  base_slot_count integer NOT NULL DEFAULT 3,
  bonus_slot_count integer NOT NULL DEFAULT 0,
  selected_for_event boolean NOT NULL DEFAULT false,
  upgrade_ref text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS equipment_sets_user_index_idx
  ON equipment_sets(user_id, set_index);

CREATE UNIQUE INDEX IF NOT EXISTS equipment_sets_user_selected_event_idx
  ON equipment_sets(user_id)
  WHERE selected_for_event = true;

INSERT INTO equipment_sets (user_id, set_index, label, base_slot_count, bonus_slot_count, selected_for_event, upgrade_ref)
SELECT id, 0, 'Standard-Set', 3, 0, false, 'equipment_set_slots'
FROM users
ON CONFLICT DO NOTHING;

ALTER TABLE equipment_inventory_slots
  ADD COLUMN IF NOT EXISTS equipment_set_id uuid REFERENCES equipment_sets(id),
  ADD COLUMN IF NOT EXISTS equipment_set_slot_index integer;

CREATE UNIQUE INDEX IF NOT EXISTS equipment_inventory_slots_set_slot_idx
  ON equipment_inventory_slots(equipment_set_id, equipment_set_slot_index)
  WHERE equipment_set_id IS NOT NULL AND equipment_set_slot_index IS NOT NULL;

ALTER TABLE equipment_inventory_slots
  DROP CONSTRAINT IF EXISTS equipment_inventory_slots_exactly_one_location,
  ADD CONSTRAINT equipment_inventory_slots_exactly_one_location CHECK (
    (
      slot_index IS NOT NULL
      AND equipment_set_id IS NULL
      AND equipment_set_slot_index IS NULL
    )
    OR (
      slot_index IS NULL
      AND equipment_set_id IS NOT NULL
      AND equipment_set_slot_index IS NOT NULL
    )
    OR (
      slot_index IS NULL
      AND equipment_set_id IS NULL
      AND equipment_set_slot_index IS NULL
    )
  );

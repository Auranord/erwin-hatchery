ALTER TABLE consumable_types
  ADD COLUMN IF NOT EXISTS is_shop_purchasable boolean NOT NULL DEFAULT false;

ALTER TABLE equipment_types
  ADD COLUMN IF NOT EXISTS is_shop_purchasable boolean NOT NULL DEFAULT false;

UPDATE consumable_types
SET is_shop_purchasable = true
WHERE effect_type = 'pet_stat_tradeoff';

UPDATE equipment_types
SET is_shop_purchasable = true
WHERE equipment_slot = 'gem'
  AND config->>'tier' IN ('1', '2', '3');

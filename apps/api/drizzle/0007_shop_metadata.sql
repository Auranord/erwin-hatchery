ALTER TABLE consumable_types
  ADD COLUMN IF NOT EXISTS resource_price integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 0;

ALTER TABLE equipment_types
  ADD COLUMN IF NOT EXISTS resource_price integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 0;

ALTER TABLE consumable_types
  DROP CONSTRAINT IF EXISTS consumable_types_resource_price_nonnegative,
  ADD CONSTRAINT consumable_types_resource_price_nonnegative CHECK (resource_price >= 0),
  DROP CONSTRAINT IF EXISTS consumable_types_stock_nonnegative,
  ADD CONSTRAINT consumable_types_stock_nonnegative CHECK (stock >= 0);

ALTER TABLE equipment_types
  DROP CONSTRAINT IF EXISTS equipment_types_resource_price_nonnegative,
  ADD CONSTRAINT equipment_types_resource_price_nonnegative CHECK (resource_price >= 0),
  DROP CONSTRAINT IF EXISTS equipment_types_stock_nonnegative,
  ADD CONSTRAINT equipment_types_stock_nonnegative CHECK (stock >= 0);

UPDATE consumable_types
SET resource_price = 100,
    stock = 25
WHERE effect_type = 'pet_stat_tradeoff';

UPDATE equipment_types
SET resource_price = CASE (config->>'tier')::integer
      WHEN 1 THEN 250
      WHEN 2 THEN 750
      WHEN 3 THEN 1500
      ELSE resource_price
    END,
    stock = CASE (config->>'tier')::integer
      WHEN 1 THEN 10
      WHEN 2 THEN 5
      WHEN 3 THEN 2
      ELSE stock
    END
WHERE equipment_slot = 'gem'
  AND config->>'tier' IN ('1', '2', '3');

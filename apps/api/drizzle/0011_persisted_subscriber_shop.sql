CREATE TABLE IF NOT EXISTS shop_offer_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL,
  period_key text NOT NULL,
  item_kind text NOT NULL,
  type_id text NOT NULL,
  paired_type_id text,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  resource_price integer NOT NULL,
  stock integer NOT NULL,
  display_order integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_offer_selections_period_order_idx
  ON shop_offer_selections (shop_id, period_key, display_order);

ALTER TABLE pets
  ALTER COLUMN source_unhatched_egg_id DROP NOT NULL;

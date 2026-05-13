ALTER TABLE pet_species
  ADD COLUMN IF NOT EXISTS is_shop_purchasable boolean NOT NULL DEFAULT false;

ALTER TABLE hats
  ADD COLUMN IF NOT EXISTS is_shop_purchasable boolean NOT NULL DEFAULT false;

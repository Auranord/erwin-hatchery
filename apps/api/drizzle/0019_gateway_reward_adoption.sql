ALTER TABLE gateway_reward_mappings
  ADD COLUMN IF NOT EXISTS app_ownership_key text,
  ADD COLUMN IF NOT EXISTS ownership_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS manageable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_adopt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_mutate boolean NOT NULL DEFAULT false;

DROP INDEX IF EXISTS gateway_webhook_events_twitch_redemption_id_idx;

CREATE TABLE IF NOT EXISTS gateway_reward_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  local_reward_type text NOT NULL,
  display_name text NOT NULL,
  gateway_reward_id text NOT NULL,
  twitch_reward_id text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_synced_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gateway_reward_mappings_gateway_reward_id_idx
  ON gateway_reward_mappings (gateway_reward_id);
CREATE UNIQUE INDEX IF NOT EXISTS gateway_reward_mappings_twitch_reward_id_idx
  ON gateway_reward_mappings (twitch_reward_id);
CREATE UNIQUE INDEX IF NOT EXISTS gateway_reward_mappings_local_reward_type_idx
  ON gateway_reward_mappings (local_reward_type);

ALTER TABLE channel_point_redemptions
  ADD COLUMN IF NOT EXISTS gateway_reward_id text,
  ADD COLUMN IF NOT EXISTS reward_mapping_id uuid REFERENCES gateway_reward_mappings(id),
  ADD COLUMN IF NOT EXISTS local_reward_type text,
  ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS twitch_user_id text,
  ADD COLUMN IF NOT EXISTS twitch_user_login text,
  ADD COLUMN IF NOT EXISTS twitch_user_display_name text,
  ADD COLUMN IF NOT EXISTS reward_title text,
  ADD COLUMN IF NOT EXISTS reward_prompt text,
  ADD COLUMN IF NOT EXISTS user_input text,
  ADD COLUMN IF NOT EXISTS last_gateway_delivery_id text,
  ADD COLUMN IF NOT EXISTS last_gateway_event_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

ALTER TABLE channel_point_redemptions
  ALTER COLUMN cost SET DEFAULT 0;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twitch_user_id text UNIQUE NOT NULL,
  twitch_login text,
  display_name text,
  avatar_url text,
  is_provisional boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS twitch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twitch_event_id text UNIQUE NOT NULL,
  type text NOT NULL,
  source text NOT NULL,
  user_id uuid REFERENCES users(id),
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'received',
  error text
);

CREATE TABLE IF NOT EXISTS channel_point_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twitch_redemption_id text UNIQUE NOT NULL,
  twitch_reward_id text NOT NULL,
  user_id uuid REFERENCES users(id),
  cost integer NOT NULL,
  status text NOT NULL,
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS economy_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  actor_user_id uuid REFERENCES users(id),
  event_type text NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  delta jsonb NOT NULL,
  reverts_ledger_id uuid REFERENCES economy_ledger(id),
  is_reverted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resources (
  user_id uuid NOT NULL REFERENCES users(id),
  resource_type text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, resource_type)
);

CREATE TABLE IF NOT EXISTS egg_types (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  base_incubation_seconds integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pet_types (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  rarity text NOT NULL,
  role text NOT NULL,
  base_hp integer NOT NULL,
  base_attack integer NOT NULL,
  base_defense integer NOT NULL,
  base_speed integer NOT NULL,
  asset_key text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS egg_loot_table_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  egg_type_id text NOT NULL REFERENCES egg_types(id),
  weight integer NOT NULL,
  outcome_type text NOT NULL,
  resource_type text,
  resource_amount integer,
  pet_type_id text REFERENCES pet_types(id),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS mystery_egg_inventory (
  user_id uuid NOT NULL REFERENCES users(id),
  egg_type_id text NOT NULL REFERENCES egg_types(id),
  amount integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, egg_type_id)
);

CREATE TABLE IF NOT EXISTS unhatched_eggs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  egg_type_id text NOT NULL REFERENCES egg_types(id),
  hidden_pet_type_id text NOT NULL REFERENCES pet_types(id),
  state text NOT NULL,
  created_from_redemption_id uuid REFERENCES channel_point_redemptions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incubator_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  slot_source text NOT NULL,
  slot_level integer NOT NULL DEFAULT 1,
  is_available boolean NOT NULL DEFAULT true,
  remove_when_empty boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incubation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  unhatched_egg_id uuid NOT NULL REFERENCES unhatched_eggs(id),
  incubator_slot_id uuid NOT NULL REFERENCES incubator_slots(id),
  state text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  required_progress_seconds integer NOT NULL,
  progress_snapshot jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS pets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  pet_type_id text NOT NULL REFERENCES pet_types(id),
  display_name text,
  hp integer NOT NULL,
  attack integer NOT NULL,
  defense integer NOT NULL,
  speed integer NOT NULL,
  stat_rolls jsonb NOT NULL,
  source_unhatched_egg_id uuid NOT NULL REFERENCES unhatched_eggs(id),
  is_favorite boolean NOT NULL DEFAULT false,
  selected_for_event boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  hatched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consumable_types (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  description text NOT NULL,
  effect_type text NOT NULL,
  config jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS consumable_inventory (
  user_id uuid NOT NULL REFERENCES users(id),
  consumable_type_id text NOT NULL REFERENCES consumable_types(id),
  amount integer NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, consumable_type_id)
);

CREATE TABLE IF NOT EXISTS hatchery_upgrades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  upgrade_type text NOT NULL,
  level integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  status text NOT NULL,
  started_by_user_id uuid REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  reverted_at timestamptz,
  result_json jsonb
);

CREATE TABLE IF NOT EXISTS game_event_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_event_id uuid NOT NULL REFERENCES game_events(id),
  user_id uuid NOT NULL REFERENCES users(id),
  pet_id uuid NOT NULL REFERENCES pets(id),
  placement integer,
  points_awarded integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leaderboard_scores (
  user_id uuid NOT NULL REFERENCES users(id),
  leaderboard_type text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, leaderboard_type)
);

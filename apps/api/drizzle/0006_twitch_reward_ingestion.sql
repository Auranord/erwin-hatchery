CREATE TABLE IF NOT EXISTS twitch_integration_state (
  id text PRIMARY KEY DEFAULT 'default' NOT NULL,
  broadcaster_user_id text,
  broadcaster_login text,
  required_scopes text NOT NULL DEFAULT '',
  setup_completed_at timestamp with time zone,
  eventsub_synced_at timestamp with time zone,
  subscription_backfill_completed_at timestamp with time zone,
  bits_backfill_completed_at timestamp with time zone,
  requires_reauth boolean NOT NULL DEFAULT false,
  eventsub_healthy boolean NOT NULL DEFAULT false,
  last_health_check_at timestamp with time zone,
  last_error text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS twitch_eventsub_subscriptions (
  event_type text NOT NULL,
  version text NOT NULL DEFAULT '1',
  twitch_subscription_id text,
  status text NOT NULL DEFAULT 'missing',
  callback_url text NOT NULL,
  last_synced_at timestamp with time zone,
  last_error text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT twitch_eventsub_subscriptions_pk PRIMARY KEY(event_type, version)
);
CREATE TABLE IF NOT EXISTS twitch_backfill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  source text NOT NULL,
  error text
);
CREATE TABLE IF NOT EXISTS twitch_bits_balances (
  user_id uuid PRIMARY KEY NOT NULL REFERENCES users(id),
  twitch_user_id text NOT NULL UNIQUE,
  imported_bits_baseline bigint NOT NULL DEFAULT 0,
  eventsub_bits_total bigint NOT NULL DEFAULT 0,
  total_bits_counted bigint NOT NULL DEFAULT 0,
  voucher_thresholds_granted integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

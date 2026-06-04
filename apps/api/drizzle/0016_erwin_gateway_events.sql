CREATE TABLE IF NOT EXISTS gateway_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  delivery_id text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  twitch_redemption_id text,
  twitch_message_id text,
  raw_payload jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'received',
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS gateway_webhook_events_delivery_id_idx
  ON gateway_webhook_events (delivery_id);

CREATE UNIQUE INDEX IF NOT EXISTS gateway_webhook_events_event_id_idx
  ON gateway_webhook_events (event_id);

CREATE UNIQUE INDEX IF NOT EXISTS gateway_webhook_events_twitch_redemption_id_idx
  ON gateway_webhook_events (twitch_redemption_id)
  WHERE twitch_redemption_id IS NOT NULL;

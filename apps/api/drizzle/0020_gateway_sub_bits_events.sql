ALTER TABLE "gateway_webhook_events"
  ADD COLUMN IF NOT EXISTS "twitch_user_id" text,
  ADD COLUMN IF NOT EXISTS "twitch_user_login" text,
  ADD COLUMN IF NOT EXISTS "twitch_user_display_name" text;

CREATE UNIQUE INDEX IF NOT EXISTS "gateway_webhook_events_twitch_message_id_idx"
  ON "gateway_webhook_events" ("twitch_message_id")
  WHERE "twitch_message_id" IS NOT NULL;

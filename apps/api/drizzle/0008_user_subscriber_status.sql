ALTER TABLE "users"
  ADD COLUMN "is_subscriber" boolean NOT NULL DEFAULT false,
  ADD COLUMN "subscriber_ends_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "stream_state_cache" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "is_live" boolean DEFAULT false NOT NULL,
  "title" text,
  "category" text,
  "viewer_count" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone,
  "source" text DEFAULT 'fallback_offline' NOT NULL,
  "source_event_id" text,
  "source_delivery_id" text,
  "raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

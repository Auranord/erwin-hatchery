CREATE TABLE IF NOT EXISTS user_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  reporter_user_id uuid REFERENCES users(id),
  reporter_twitch_user_id text NOT NULL,
  reporter_display_name_snapshot text,
  category text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  current_path text,
  client_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_reports_category_check CHECK (category IN ('bug', 'feedback')),
  CONSTRAINT user_reports_status_check CHECK (status IN ('new', 'reviewing', 'closed'))
);

CREATE INDEX IF NOT EXISTS user_reports_reporter_twitch_created_idx
  ON user_reports (reporter_twitch_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_reports_status_created_idx
  ON user_reports (status, created_at DESC);

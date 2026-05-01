CREATE TABLE IF NOT EXISTS twitch_user_tokens (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  scope text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

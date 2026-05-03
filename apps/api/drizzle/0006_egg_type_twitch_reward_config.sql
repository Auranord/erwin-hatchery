ALTER TABLE egg_types
  ADD COLUMN IF NOT EXISTS twitch_reward_title text,
  ADD COLUMN IF NOT EXISTS twitch_reward_prompt text,
  ADD COLUMN IF NOT EXISTS twitch_reward_cost integer,
  ADD COLUMN IF NOT EXISTS twitch_reward_background_color text,
  ADD COLUMN IF NOT EXISTS twitch_reward_global_cooldown_minutes integer,
  ADD COLUMN IF NOT EXISTS twitch_reward_max_per_stream integer,
  ADD COLUMN IF NOT EXISTS twitch_reward_max_per_user_per_stream integer;

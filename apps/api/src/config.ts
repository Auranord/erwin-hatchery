import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }

    throw new Error(`Invalid boolean value: ${value}`);
  });

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  TWITCH_BROADCASTER_ID: z.string().min(1),
  TWITCH_BROADCASTER_USER_ID: z.string().min(1),
  TWITCH_EVENTSUB_SECRET: z.string().min(1),
  TWITCH_CHANNEL_POINT_REWARD_ID: z.string().min(1),
  TWITCH_EVENTSUB_CALLBACK_URL: z.string().url().refine((value) => value.endsWith('/api/twitch/eventsub'), 'Callback URL must end with /api/twitch/eventsub'),
  TWITCH_EVENTSUB_AUTO_SYNC: booleanFromEnv.default(true),
  SESSION_SECRET: z.string().min(32),
  OAUTH_CALLBACK_PATH: z.string().default('/api/auth/twitch/callback'),
  LOG_HEALTHCHECK_REQUESTS: booleanFromEnv.default(false)
});

export type AppConfig = z.infer<typeof configSchema>;

export const config: AppConfig = configSchema.parse(process.env);

export const isProduction = config.NODE_ENV === 'production';

export function getOAuthRedirectUri(): string {
  return new URL(config.OAUTH_CALLBACK_PATH, config.PUBLIC_APP_URL).toString();
}

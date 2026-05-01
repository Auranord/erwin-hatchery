import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  TWITCH_BROADCASTER_ID: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  OAUTH_CALLBACK_PATH: z.string().default('/api/auth/twitch/callback'),
  LOG_HEALTHCHECK_REQUESTS: z.coerce.boolean().default(false)
});

export type AppConfig = z.infer<typeof configSchema>;

export const config: AppConfig = configSchema.parse(process.env);

export const isProduction = config.NODE_ENV === 'production';

export function getOAuthRedirectUri(): string {
  return new URL(config.OAUTH_CALLBACK_PATH, config.PUBLIC_APP_URL).toString();
}

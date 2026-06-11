import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

function booleanFromEnv(name: string) {
  return z.union([z.boolean(), z.string()]).transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'flase', 'no', 'off'].includes(normalized)) {
      return false;
    }

    throw new Error(
      `Invalid boolean value for ${name}: ${value}. Expected true/false, 1/0, yes/no, or on/off.`
    );
  });
}


function optionalStringFromEnv() {
  return z.preprocess((value) => {
    if (typeof value === 'string' && value.trim() === '') {
      return undefined;
    }
    return value;
  }, z.string().min(1).optional());
}

function optionalUrlFromEnv() {
  return z.preprocess((value) => {
    if (typeof value === 'string' && value.trim() === '') {
      return undefined;
    }
    return value;
  }, z.string().url().optional());
}

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  TWITCH_BROADCASTER_ID: z.string().min(1),
  TWITCH_EVENTSUB_SECRET: optionalStringFromEnv(),
  TWITCH_EVENTSUB_AUTO_SYNC: booleanFromEnv('TWITCH_EVENTSUB_AUTO_SYNC').optional(),
  TWITCH_SUBSCRIPTION_RENEWAL_DAYS: z.coerce.number().int().min(1).max(90).default(31),
  TWITCH_BITS_PER_VOUCHER: z.coerce.number().int().min(1).default(500),
  FEATURE_BITS_EFFECTS: booleanFromEnv('FEATURE_BITS_EFFECTS').default(true),
  SESSION_SECRET: z.string().min(32),
  OVERLAY_SECRET: z.string().min(16).optional(),
  OAUTH_CALLBACK_PATH: z.string().default('/api/auth/twitch/callback'),
  LOG_HEALTHCHECK_REQUESTS: booleanFromEnv('LOG_HEALTHCHECK_REQUESTS').default(false),
  DEBUG_MODE: booleanFromEnv('DEBUG_MODE').default(false),
  DEBUG_EGG_RESOURCE_MULTIPLIER: z.coerce.number().int().min(1).default(1),
  INCUBATION_OFFLINE_MULTIPLIER: z.coerce.number().gt(0).default(1),
  INCUBATION_LIVE_BASE_MULTIPLIER: z.coerce.number().gt(0).default(2),
  INCUBATION_VIEWER_MULTIPLIER_PER_VIEWER: z.coerce.number().min(0).default(0.01),
  INCUBATION_MAX_MULTIPLIER: z.coerce.number().gt(0).default(3),
  SHOP_WEEKLY_EQUIPMENT_OFFER_COUNT: z.coerce.number().int().min(0).default(5),
  SHOP_WEEKLY_CONSUMABLE_OFFER_COUNT: z.coerce.number().int().min(0).default(5),
  SUBSCRIBER_SHOP_MONTHLY_OFFER_COUNT: z.coerce.number().int().min(0).default(5),
  PET_TRAINING_MAX_LEVEL: z.coerce.number().int().min(0).max(50).default(10),
  ERWIN_GATEWAY_ENABLED: booleanFromEnv('ERWIN_GATEWAY_ENABLED').default(false),
  ERWIN_GATEWAY_OBSERVE_ONLY: booleanFromEnv('ERWIN_GATEWAY_OBSERVE_ONLY').default(true),
  ERWIN_GATEWAY_REQUIRED: booleanFromEnv('ERWIN_GATEWAY_REQUIRED').default(false),
  ERWIN_GATEWAY_AUTO_FULFILL_REDEMPTIONS: booleanFromEnv('ERWIN_GATEWAY_AUTO_FULFILL_REDEMPTIONS').default(false),
  ERWIN_GATEWAY_URL: optionalUrlFromEnv(),
  ERWIN_GATEWAY_APP_API_KEY: optionalStringFromEnv(),
  ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET: optionalStringFromEnv(),
  ERWIN_GATEWAY_WEBHOOK_MAX_AGE_SECONDS: z.coerce.number().int().min(1).default(300)
})
  .transform((value) => ({
    ...value,
    TWITCH_EVENTSUB_AUTO_SYNC:
      value.TWITCH_EVENTSUB_AUTO_SYNC ?? !value.ERWIN_GATEWAY_ENABLED
  }))
  .superRefine((value, ctx) => {
    if (
      !value.ERWIN_GATEWAY_ENABLED &&
      value.TWITCH_EVENTSUB_AUTO_SYNC &&
      !value.TWITCH_EVENTSUB_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWITCH_EVENTSUB_SECRET'],
        message:
          'TWITCH_EVENTSUB_SECRET is required when ERWIN_GATEWAY_ENABLED=false and TWITCH_EVENTSUB_AUTO_SYNC=true.'
      });
    }

    if (
      (value.ERWIN_GATEWAY_ENABLED || value.ERWIN_GATEWAY_REQUIRED) &&
      !value.ERWIN_GATEWAY_URL
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ERWIN_GATEWAY_URL'],
        message:
          'ERWIN_GATEWAY_URL is required when ERWIN_GATEWAY_ENABLED or ERWIN_GATEWAY_REQUIRED is true.'
      });
    }

    if (
      (value.ERWIN_GATEWAY_ENABLED || value.ERWIN_GATEWAY_REQUIRED) &&
      !value.ERWIN_GATEWAY_APP_API_KEY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ERWIN_GATEWAY_APP_API_KEY'],
        message:
          'ERWIN_GATEWAY_APP_API_KEY is required when ERWIN_GATEWAY_ENABLED or ERWIN_GATEWAY_REQUIRED is true.'
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export const config: AppConfig = configSchema.parse(process.env);

export const isProduction = config.NODE_ENV === 'production';

export function getOAuthRedirectUri(): string {
  return new URL(config.OAUTH_CALLBACK_PATH, config.PUBLIC_APP_URL).toString();
}

export function getEventSubCallbackUrl(): string {
  return new URL('/api/twitch/eventsub', config.PUBLIC_APP_URL).toString();
}

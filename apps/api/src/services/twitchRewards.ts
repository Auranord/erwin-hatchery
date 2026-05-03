import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { eggTypes, twitchUserTokens, users } from '../db/schema.js';

export type TwitchReward = {
  id: string;
  title: string;
  cost: number;
  prompt: string;
  background_color: string;
  is_global_cooldown_enabled: boolean;
  global_cooldown_seconds: number;
  is_max_per_stream_enabled: boolean;
  max_per_stream: number;
  is_max_per_user_per_stream_enabled: boolean;
  max_per_user_per_stream: number;
};

const REWARD_PREFIX = '[Erwin Hatchery]';

function rewardTitleForEgg(eggDisplayName: string): string {
  return `${REWARD_PREFIX} ${eggDisplayName}`.slice(0, 45);
}

function rewardPromptForEgg(eggTypeId: string): string {
  return `Automatisch verwaltet. Ei-Typ: ${eggTypeId}`.slice(0, 200);
}

function rewardCostForEggType(eggTypeId: string): number {
  if (eggTypeId.includes('rare')) return 5000;
  if (eggTypeId.includes('uncommon')) return 2500;
  return 1000;
}

function rewardConfigForEggType(eggType: {
  id: string;
  displayName: string;
  twitchRewardTitle: string | null;
  twitchRewardPrompt: string | null;
  twitchRewardCost: number | null;
  twitchRewardBackgroundColor: string | null;
  twitchRewardGlobalCooldownMinutes: number | null;
  twitchRewardMaxPerStream: number | null;
  twitchRewardMaxPerUserPerStream: number | null;
}): {
  title: string;
  prompt: string;
  cost: number;
  backgroundColor: string;
  isGlobalCooldownEnabled: boolean;
  globalCooldownSeconds: number;
  isMaxPerStreamEnabled: boolean;
  maxPerStream: number;
  isMaxPerUserPerStreamEnabled: boolean;
  maxPerUserPerStream: number;
} {
  const title = (eggType.twitchRewardTitle?.trim() || rewardTitleForEgg(eggType.displayName)).slice(0, 45);
  const prompt = (eggType.twitchRewardPrompt?.trim() || rewardPromptForEgg(eggType.id)).slice(0, 200);
  const cost = eggType.twitchRewardCost ?? rewardCostForEggType(eggType.id);
  const backgroundColor = eggType.twitchRewardBackgroundColor?.trim() || '#9147ff';
  const cooldownMinutes = Math.max(0, eggType.twitchRewardGlobalCooldownMinutes ?? 0);
  const maxPerStream = Math.max(0, eggType.twitchRewardMaxPerStream ?? 0);
  const maxPerUserPerStream = Math.max(0, eggType.twitchRewardMaxPerUserPerStream ?? 0);
  return {
    title,
    prompt,
    cost,
    backgroundColor,
    isGlobalCooldownEnabled: cooldownMinutes > 0,
    globalCooldownSeconds: cooldownMinutes * 60,
    isMaxPerStreamEnabled: maxPerStream > 0,
    maxPerStream,
    isMaxPerUserPerStreamEnabled: maxPerUserPerStream > 0,
    maxPerUserPerStream
  };
}

async function twitchApi<T>(path: string, userToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.twitch.tv/helix${path}`, {
    ...init,
    headers: {
      'Client-Id': config.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Twitch custom reward API failed (${response.status}): ${details.slice(0, 300)}`);
  }

  return (await response.json()) as T;
}


export async function listManagedCustomRewards(): Promise<TwitchReward[]> {
  const broadcaster = await db
    .select({ accessToken: twitchUserTokens.accessToken, scope: twitchUserTokens.scope })
    .from(twitchUserTokens)
    .innerJoin(users, eq(users.id, twitchUserTokens.userId))
    .where(eq(users.twitchUserId, config.TWITCH_BROADCASTER_ID))
    .limit(1);
  const tokenRow = broadcaster[0];
  if (!tokenRow?.accessToken) throw new Error('Missing broadcaster OAuth token. Login with broadcaster account first.');
  if (!tokenRow.scope.includes('channel:manage:redemptions')) {
    throw new Error('Broadcaster token missing scope channel:manage:redemptions. Login again to refresh scopes.');
  }

  const existing = await twitchApi<{ data: TwitchReward[] }>(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}&only_manageable_rewards=true`, tokenRow.accessToken);
  return existing.data;
}

export async function syncEggTypeCustomRewards(): Promise<{ created: number; updated: number; total: number }> {
  const broadcaster = await db
    .select({ accessToken: twitchUserTokens.accessToken, scope: twitchUserTokens.scope })
    .from(twitchUserTokens)
    .innerJoin(users, eq(users.id, twitchUserTokens.userId))
    .where(eq(users.twitchUserId, config.TWITCH_BROADCASTER_ID))
    .limit(1);
  const tokenRow = broadcaster[0];
  if (!tokenRow?.accessToken) throw new Error('Missing broadcaster OAuth token. Login with broadcaster account first.');
  if (!tokenRow.scope.includes('channel:manage:redemptions')) {
    throw new Error('Broadcaster token missing scope channel:manage:redemptions. Login again to refresh scopes.');
  }

  const eggTypeRows = await db.select({
    id: eggTypes.id,
    displayName: eggTypes.displayName,
    twitchRewardTitle: eggTypes.twitchRewardTitle,
    twitchRewardPrompt: eggTypes.twitchRewardPrompt,
    twitchRewardCost: eggTypes.twitchRewardCost,
    twitchRewardBackgroundColor: eggTypes.twitchRewardBackgroundColor,
    twitchRewardGlobalCooldownMinutes: eggTypes.twitchRewardGlobalCooldownMinutes,
    twitchRewardMaxPerStream: eggTypes.twitchRewardMaxPerStream,
    twitchRewardMaxPerUserPerStream: eggTypes.twitchRewardMaxPerUserPerStream
  }).from(eggTypes).where(eq(eggTypes.isActive, true));
  const existing = await twitchApi<{ data: TwitchReward[] }>(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}&only_manageable_rewards=true`, tokenRow.accessToken);

  let created = 0;
  let updated = 0;
  for (const eggType of eggTypeRows) {
    const rewardConfig = rewardConfigForEggType(eggType);
    const current = existing.data.find((reward) => reward.title === rewardConfig.title);

    if (!current) {
      const createdReward = await twitchApi<{ data: TwitchReward[] }>(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}`, tokenRow.accessToken, {
        method: 'POST',
        body: JSON.stringify({
          title: rewardConfig.title,
          prompt: rewardConfig.prompt,
          cost: rewardConfig.cost,
          background_color: rewardConfig.backgroundColor,
          is_global_cooldown_enabled: rewardConfig.isGlobalCooldownEnabled,
          global_cooldown_seconds: rewardConfig.globalCooldownSeconds,
          is_max_per_stream_enabled: rewardConfig.isMaxPerStreamEnabled,
          max_per_stream: rewardConfig.maxPerStream,
          is_max_per_user_per_stream_enabled: rewardConfig.isMaxPerUserPerStreamEnabled,
          max_per_user_per_stream: rewardConfig.maxPerUserPerStream,
          is_enabled: true
        })
      });
      const rewardId = createdReward.data[0]?.id;
      if (rewardId) {
        await db.update(eggTypes).set({ twitchRewardId: rewardId }).where(eq(eggTypes.id, eggType.id));
      }
      created += 1;
      continue;
    }

    if (
      current.cost !== rewardConfig.cost
      || current.prompt !== rewardConfig.prompt
      || current.background_color !== rewardConfig.backgroundColor
      || current.is_global_cooldown_enabled !== rewardConfig.isGlobalCooldownEnabled
      || current.global_cooldown_seconds !== rewardConfig.globalCooldownSeconds
      || current.is_max_per_stream_enabled !== rewardConfig.isMaxPerStreamEnabled
      || current.max_per_stream !== rewardConfig.maxPerStream
      || current.is_max_per_user_per_stream_enabled !== rewardConfig.isMaxPerUserPerStreamEnabled
      || current.max_per_user_per_stream !== rewardConfig.maxPerUserPerStream
    ) {
      await twitchApi(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}&id=${encodeURIComponent(current.id)}`, tokenRow.accessToken, {
        method: 'PATCH',
        body: JSON.stringify({
          prompt: rewardConfig.prompt,
          cost: rewardConfig.cost,
          background_color: rewardConfig.backgroundColor,
          is_global_cooldown_enabled: rewardConfig.isGlobalCooldownEnabled,
          global_cooldown_seconds: rewardConfig.globalCooldownSeconds,
          is_max_per_stream_enabled: rewardConfig.isMaxPerStreamEnabled,
          max_per_stream: rewardConfig.maxPerStream,
          is_max_per_user_per_stream_enabled: rewardConfig.isMaxPerUserPerStreamEnabled,
          max_per_user_per_stream: rewardConfig.maxPerUserPerStream,
          is_enabled: true
        })
      });
      updated += 1;
    }

    await db.update(eggTypes).set({ twitchRewardId: current.id }).where(eq(eggTypes.id, eggType.id));
  }

  return { created, updated, total: eggTypeRows.length };
}

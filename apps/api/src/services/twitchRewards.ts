import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { eggTypes, twitchUserTokens, users } from '../db/schema.js';

type TwitchReward = {
  id: string;
  title: string;
  cost: number;
  prompt: string;
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

  const eggTypeRows = await db.select({ id: eggTypes.id, displayName: eggTypes.displayName }).from(eggTypes).where(eq(eggTypes.isActive, true));
  const existing = await twitchApi<{ data: TwitchReward[] }>(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}&only_manageable_rewards=true`, tokenRow.accessToken);

  let created = 0;
  let updated = 0;
  for (const eggType of eggTypeRows) {
    const title = rewardTitleForEgg(eggType.displayName);
    const prompt = rewardPromptForEgg(eggType.id);
    const cost = rewardCostForEggType(eggType.id);
    const current = existing.data.find((reward) => reward.title === title);

    if (!current) {
      await twitchApi(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}`, tokenRow.accessToken, {
        method: 'POST',
        body: JSON.stringify({ title, prompt, cost, is_enabled: true })
      });
      created += 1;
      continue;
    }

    if (current.cost !== cost || current.prompt !== prompt) {
      await twitchApi(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}&id=${encodeURIComponent(current.id)}`, tokenRow.accessToken, {
        method: 'PATCH',
        body: JSON.stringify({ prompt, cost, is_enabled: true })
      });
      updated += 1;
    }
  }

  return { created, updated, total: eggTypeRows.length };
}

import { db } from '../db/client.js';
import { gatewayRewardMappings } from '../db/schema.js';
import { createErwinGatewayClient, type GatewayChannelPointReward, type GatewayRewardSync } from './erwinGatewayClient.js';

export type GatewayRewardMappingRequest = {
  localRewardType: string;
  gatewayRewardId?: string;
  twitchRewardId?: string;
  displayName?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
};

export type GatewayRewardSyncResult = {
  synced: GatewayRewardSync;
  mappingsUpserted: number;
  mappingsSkipped: number;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function gatewayRewardId(reward: GatewayChannelPointReward): string {
  return reward.id;
}

export function twitchRewardId(reward: GatewayChannelPointReward): string | null {
  return stringOrNull(reward.twitch_reward_id) ?? stringOrNull(reward.twitchRewardId);
}

export function gatewayRewardDisplayName(reward: GatewayChannelPointReward): string {
  return stringOrNull(reward.title) ?? stringOrNull(reward.display_name) ?? gatewayRewardId(reward);
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function gatewayRewardAppOwnershipKey(reward: GatewayChannelPointReward): string | null {
  return stringOrNull(reward.appOwnershipKey) ?? stringOrNull(reward.app_ownership_key);
}

function gatewayRewardOwnershipStatus(reward: GatewayChannelPointReward): string {
  return stringOrNull(reward.ownershipStatus) ?? stringOrNull(reward.ownership_status) ?? 'unknown';
}

function gatewayRewardCanAdopt(reward: GatewayChannelPointReward): boolean {
  return booleanOrDefault(reward.canAdopt ?? reward.can_adopt, false);
}

function gatewayRewardCanMutate(reward: GatewayChannelPointReward): boolean {
  return booleanOrDefault(reward.canMutate ?? reward.can_mutate, gatewayRewardOwnershipStatus(reward) === 'owned_by_you');
}

function findSyncedReward(rewards: GatewayChannelPointReward[], mapping: GatewayRewardMappingRequest): GatewayChannelPointReward | null {
  const requestedGatewayRewardId = stringOrNull(mapping.gatewayRewardId);
  const requestedTwitchRewardId = stringOrNull(mapping.twitchRewardId);
  return rewards.find((reward) => {
    const rewardGatewayRewardId = gatewayRewardId(reward);
    const rewardTwitchRewardId = twitchRewardId(reward);
    return (
      (requestedGatewayRewardId !== null && rewardGatewayRewardId === requestedGatewayRewardId) ||
      (requestedTwitchRewardId !== null && rewardTwitchRewardId === requestedTwitchRewardId)
    );
  }) ?? null;
}

export async function listGatewayRewardsForAdmin() {
  const client = createErwinGatewayClient();
  if (!client) throw new Error('erwin-gateway is not configured or enabled');
  const [gatewayRewards, mappings] = await Promise.all([
    client.listRewards(),
    db.select().from(gatewayRewardMappings).orderBy(gatewayRewardMappings.displayName)
  ]);
  return { ...gatewayRewards, mappings };
}

export async function syncGatewayRewardsForAdmin(mappings: GatewayRewardMappingRequest[] = []): Promise<GatewayRewardSyncResult> {
  const client = createErwinGatewayClient();
  if (!client) throw new Error('erwin-gateway is not configured or enabled');
  const synced = await client.syncRewards();
  const syncedRewards = Array.isArray(synced.rewards) ? synced.rewards : [];
  let mappingsUpserted = 0;
  let mappingsSkipped = 0;

  for (const mapping of mappings) {
    const localRewardType = stringOrNull(mapping.localRewardType);
    if (!localRewardType) {
      mappingsSkipped += 1;
      continue;
    }

    const reward = findSyncedReward(syncedRewards, mapping);
    const resolvedGatewayRewardId = reward ? gatewayRewardId(reward) : stringOrNull(mapping.gatewayRewardId);
    const resolvedTwitchRewardId = reward ? twitchRewardId(reward) : stringOrNull(mapping.twitchRewardId);
    if (!resolvedGatewayRewardId || !resolvedTwitchRewardId) {
      mappingsSkipped += 1;
      continue;
    }

    await db
      .insert(gatewayRewardMappings)
      .values({
        localRewardType,
        displayName: stringOrNull(mapping.displayName) ?? (reward ? gatewayRewardDisplayName(reward) : localRewardType),
        gatewayRewardId: resolvedGatewayRewardId,
        twitchRewardId: resolvedTwitchRewardId,
        isActive: mapping.isActive ?? true,
        appOwnershipKey: reward ? gatewayRewardAppOwnershipKey(reward) : null,
        ownershipStatus: reward ? gatewayRewardOwnershipStatus(reward) : 'unknown',
        manageable: reward ? booleanOrDefault(reward.manageable, false) : false,
        canAdopt: reward ? gatewayRewardCanAdopt(reward) : false,
        canMutate: reward ? gatewayRewardCanMutate(reward) : false,
        lastSyncedAt: new Date(),
        metadata: {
          ...(mapping.metadata ?? {}),
          gatewayReward: reward ?? null
        },
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: gatewayRewardMappings.gatewayRewardId,
        set: {
          displayName: stringOrNull(mapping.displayName) ?? (reward ? gatewayRewardDisplayName(reward) : localRewardType),
          gatewayRewardId: resolvedGatewayRewardId,
          twitchRewardId: resolvedTwitchRewardId,
          isActive: mapping.isActive ?? true,
          appOwnershipKey: reward ? gatewayRewardAppOwnershipKey(reward) : null,
          ownershipStatus: reward ? gatewayRewardOwnershipStatus(reward) : 'unknown',
          manageable: reward ? booleanOrDefault(reward.manageable, false) : false,
          canAdopt: reward ? gatewayRewardCanAdopt(reward) : false,
          canMutate: reward ? gatewayRewardCanMutate(reward) : false,
          lastSyncedAt: new Date(),
          metadata: {
            ...(mapping.metadata ?? {}),
            gatewayReward: reward ?? null
          },
          updatedAt: new Date()
        }
      });
    mappingsUpserted += 1;
  }

  return { synced, mappingsUpserted, mappingsSkipped };
}

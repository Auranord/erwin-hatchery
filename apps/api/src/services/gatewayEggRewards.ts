import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { eggTypes, gatewayRewardMappings } from '../db/schema.js';
import { createErwinGatewayClient, type GatewayChannelPointReward } from './erwinGatewayClient.js';

const REWARD_PREFIX = '[Erwin Hatchery]';
const BASIC_MYSTERY_EGG_TYPE_ID = 'beta_egg';
const BASIC_MYSTERY_EGG_GATEWAY_TYPE = 'basic_mystery_egg';

export type EggTypeRewardConfig = {
  id: string;
  displayName: string;
  twitchRewardId: string | null;
  twitchRewardTitle: string | null;
  twitchRewardPrompt: string | null;
  twitchRewardCost: number | null;
  twitchRewardBackgroundColor: string | null;
  twitchRewardGlobalCooldownMinutes: number | null;
  twitchRewardMaxPerStream: number | null;
  twitchRewardMaxPerUserPerStream: number | null;
  isActive: boolean;
};

export type EggTypeGatewayRewardPlan = {
  localRewardType: string;
  title: string;
  prompt: string;
  cost: number;
  backgroundColor: string;
  isEnabled: boolean;
  isGlobalCooldownEnabled: boolean;
  globalCooldownSeconds: number;
  isMaxPerStreamEnabled: boolean;
  maxPerStream: number;
  isMaxPerUserPerStreamEnabled: boolean;
  maxPerUserPerStream: number;
  metadata: { source: 'erwin-hatchery'; rewardKind: 'egg_type'; eggTypeId: string; appOwnershipKey: string; gatewayLocalRewardType: string };
};

export type GatewayEggRewardSyncResult = {
  created: number;
  updated: number;
  skipped: number;
  total: number;
  rewards: Array<{
    eggTypeId: string;
    localRewardType: string;
    gatewayRewardId: string;
    twitchRewardId: string;
    title: string;
    isEnabled: boolean;
    ownershipStatus: string;
    manageable: boolean;
    canAdopt: boolean;
    canMutate: boolean;
    appOwnershipKey: string;
    action: 'created' | 'updated' | 'adopted' | 'discovered' | 'skipped';
    error?: string;
  }>;
  adopted: number;
  discovered: number;
  blocked: number;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function localRewardTypeForEggType(eggTypeId: string): string {
  return `egg_type:${eggTypeId}`;
}

export function gatewayLocalRewardTypeForEggType(eggTypeId: string): string {
  return eggTypeId === BASIC_MYSTERY_EGG_TYPE_ID ? BASIC_MYSTERY_EGG_GATEWAY_TYPE : localRewardTypeForEggType(eggTypeId);
}

export function appOwnershipKeyForEggType(eggTypeId: string): string {
  return eggTypeId === BASIC_MYSTERY_EGG_TYPE_ID ? 'hatchery:basic_mystery_egg' : `hatchery:egg_type:${eggTypeId}`;
}

function rewardTitleForEgg(displayName: string): string {
  return `${REWARD_PREFIX} ${displayName}`.slice(0, 45);
}

function rewardPromptForEgg(eggTypeId: string): string {
  return `Gibt dir ein ${eggTypeId === 'beta_egg' ? 'Beta Ei' : 'Mystery Ei'} in Erwin Hatchery.`.slice(0, 200);
}

function rewardCostForEggType(eggTypeId: string): number {
  if (eggTypeId.includes('rare')) return 5000;
  if (eggTypeId.includes('uncommon')) return 2500;
  return 1000;
}

export function gatewayRewardPlanForEggType(eggType: EggTypeRewardConfig): EggTypeGatewayRewardPlan {
  const cooldownMinutes = Math.max(0, eggType.twitchRewardGlobalCooldownMinutes ?? 0);
  const maxPerStream = Math.max(0, eggType.twitchRewardMaxPerStream ?? 0);
  const maxPerUserPerStream = Math.max(0, eggType.twitchRewardMaxPerUserPerStream ?? 0);
  return {
    localRewardType: localRewardTypeForEggType(eggType.id),
    title: (eggType.twitchRewardTitle?.trim() || rewardTitleForEgg(eggType.displayName)).slice(0, 45),
    prompt: (eggType.twitchRewardPrompt?.trim() || rewardPromptForEgg(eggType.id)).slice(0, 200),
    cost: eggType.twitchRewardCost ?? rewardCostForEggType(eggType.id),
    backgroundColor: eggType.twitchRewardBackgroundColor?.trim() || '#9147ff',
    isEnabled: eggType.isActive,
    isGlobalCooldownEnabled: cooldownMinutes > 0,
    globalCooldownSeconds: cooldownMinutes * 60,
    isMaxPerStreamEnabled: maxPerStream > 0,
    maxPerStream,
    isMaxPerUserPerStreamEnabled: maxPerUserPerStream > 0,
    maxPerUserPerStream,
    metadata: {
      source: 'erwin-hatchery',
      rewardKind: 'egg_type',
      eggTypeId: eggType.id,
      appOwnershipKey: appOwnershipKeyForEggType(eggType.id),
      gatewayLocalRewardType: gatewayLocalRewardTypeForEggType(eggType.id)
    }
  };
}

function gatewayRewardTwitchId(reward: GatewayChannelPointReward): string | null {
  return stringOrNull(reward.twitch_reward_id) ?? stringOrNull(reward.twitchRewardId);
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

function gatewayRewardManageable(reward: GatewayChannelPointReward): boolean {
  return booleanOrDefault(reward.manageable, false);
}

function gatewayRewardCanAdopt(reward: GatewayChannelPointReward): boolean {
  return booleanOrDefault(reward.canAdopt ?? reward.can_adopt, false);
}

function gatewayRewardCanMutate(reward: GatewayChannelPointReward): boolean {
  return booleanOrDefault(reward.canMutate ?? reward.can_mutate, gatewayRewardOwnershipStatus(reward) === 'owned_by_you');
}

function gatewayRewardEnabled(reward: GatewayChannelPointReward): boolean {
  return booleanOrDefault(reward.enabled ?? reward.is_enabled, false);
}

function isSameOwnershipKey(reward: GatewayChannelPointReward, appOwnershipKey: string): boolean {
  return gatewayRewardAppOwnershipKey(reward) === appOwnershipKey;
}

function hasSameRewardConfig(reward: GatewayChannelPointReward, plan: EggTypeGatewayRewardPlan): boolean {
  return (
    reward.title === plan.title &&
    reward.cost === plan.cost &&
    reward.prompt === plan.prompt &&
    (reward.background_color ?? plan.backgroundColor) === plan.backgroundColor &&
    (reward.enabled ?? reward.is_enabled ?? false) === plan.isEnabled &&
    (reward.is_global_cooldown_enabled ?? plan.isGlobalCooldownEnabled) === plan.isGlobalCooldownEnabled &&
    (reward.global_cooldown_seconds ?? plan.globalCooldownSeconds) === plan.globalCooldownSeconds &&
    (reward.is_max_per_stream_enabled ?? plan.isMaxPerStreamEnabled) === plan.isMaxPerStreamEnabled &&
    (reward.max_per_stream ?? plan.maxPerStream) === plan.maxPerStream &&
    (reward.is_max_per_user_per_stream_enabled ?? plan.isMaxPerUserPerStreamEnabled) === plan.isMaxPerUserPerStreamEnabled &&
    (reward.max_per_user_per_stream ?? plan.maxPerUserPerStream) === plan.maxPerUserPerStream
  );
}

export function rewardPayload(plan: EggTypeGatewayRewardPlan): Record<string, unknown> {
  return {
    title: plan.title,
    prompt: plan.prompt,
    cost: plan.cost,
    background_color: plan.backgroundColor,
    is_enabled: plan.isEnabled,
    is_global_cooldown_enabled: plan.isGlobalCooldownEnabled,
    ...(plan.isGlobalCooldownEnabled && plan.globalCooldownSeconds > 0
      ? { global_cooldown_seconds: plan.globalCooldownSeconds }
      : {}),
    is_max_per_stream_enabled: plan.isMaxPerStreamEnabled,
    ...(plan.isMaxPerStreamEnabled && plan.maxPerStream > 0 ? { max_per_stream: plan.maxPerStream } : {}),
    is_max_per_user_per_stream_enabled: plan.isMaxPerUserPerStreamEnabled,
    ...(plan.isMaxPerUserPerStreamEnabled && plan.maxPerUserPerStream > 0
      ? { max_per_user_per_stream: plan.maxPerUserPerStream }
      : {})
  };
}

export async function listEggTypeGatewayRewardStatusForAdmin() {
  const [eggTypeRows, mappings] = await Promise.all([
    db
      .select({
        id: eggTypes.id,
        displayName: eggTypes.displayName,
        twitchRewardId: eggTypes.twitchRewardId,
        twitchRewardTitle: eggTypes.twitchRewardTitle,
        twitchRewardPrompt: eggTypes.twitchRewardPrompt,
        twitchRewardCost: eggTypes.twitchRewardCost,
        twitchRewardBackgroundColor: eggTypes.twitchRewardBackgroundColor,
        twitchRewardGlobalCooldownMinutes: eggTypes.twitchRewardGlobalCooldownMinutes,
        twitchRewardMaxPerStream: eggTypes.twitchRewardMaxPerStream,
        twitchRewardMaxPerUserPerStream: eggTypes.twitchRewardMaxPerUserPerStream,
        isActive: eggTypes.isActive
      })
      .from(eggTypes)
      .orderBy(eggTypes.id),
    db.select().from(gatewayRewardMappings).orderBy(gatewayRewardMappings.displayName)
  ]);

  const mappingByLocalType = new Map(mappings.map((mapping) => [mapping.localRewardType, mapping]));
  return {
    eggTypes: eggTypeRows.map((eggType) => {
      const plan = gatewayRewardPlanForEggType(eggType);
      const mapping = mappingByLocalType.get(plan.localRewardType) ?? null;
      return { eggType, plan, mapping };
    }),
    mappings
  };
}


async function storeGatewayEggRewardMapping(input: {
  eggTypeId: string;
  plan: EggTypeGatewayRewardPlan;
  reward: GatewayChannelPointReward;
  twitchRewardId: string;
  isActive: boolean;
  appOwnershipKey: string;
}) {
  const { eggTypeId, plan, reward, twitchRewardId, isActive, appOwnershipKey } = input;
  await db.transaction(async (tx) => {
    if (isActive) {
      await tx.update(eggTypes).set({ twitchRewardId }).where(eq(eggTypes.id, eggTypeId));
    }
    await tx
      .insert(gatewayRewardMappings)
      .values({
        localRewardType: plan.localRewardType,
        displayName: reward.title ?? plan.title,
        gatewayRewardId: reward.id,
        twitchRewardId,
        isActive,
        appOwnershipKey,
        ownershipStatus: gatewayRewardOwnershipStatus(reward),
        manageable: gatewayRewardManageable(reward),
        canAdopt: gatewayRewardCanAdopt(reward),
        canMutate: gatewayRewardCanMutate(reward),
        lastSyncedAt: new Date(),
        metadata: {
          plan,
          gatewayReward: reward,
          gatewayLocalRewardType: gatewayLocalRewardTypeForEggType(eggTypeId),
          adoptionRequired: !isActive
        },
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: gatewayRewardMappings.localRewardType,
        set: {
          displayName: reward.title ?? plan.title,
          gatewayRewardId: reward.id,
          twitchRewardId,
          isActive,
          appOwnershipKey,
          ownershipStatus: gatewayRewardOwnershipStatus(reward),
          manageable: gatewayRewardManageable(reward),
          canAdopt: gatewayRewardCanAdopt(reward),
          canMutate: gatewayRewardCanMutate(reward),
          lastSyncedAt: new Date(),
          metadata: {
            plan,
            gatewayReward: reward,
            gatewayLocalRewardType: gatewayLocalRewardTypeForEggType(eggTypeId),
            adoptionRequired: !isActive
          },
          updatedAt: new Date()
        }
      });
  });
}

function findCandidateReward(rewards: GatewayChannelPointReward[], eggType: EggTypeRewardConfig, plan: EggTypeGatewayRewardPlan, appOwnershipKey: string): GatewayChannelPointReward | null {
  return rewards.find((reward) => {
    const metadata = reward.metadata ?? {};
    return (
      reward.id === eggType.twitchRewardId ||
      gatewayRewardTwitchId(reward) === eggType.twitchRewardId ||
      isSameOwnershipKey(reward, appOwnershipKey) ||
      metadata.eggTypeId === eggType.id ||
      metadata.egg_type_id === eggType.id ||
      metadata.appOwnershipKey === appOwnershipKey ||
      reward.title === plan.title
    );
  }) ?? null;
}

export async function syncEggTypeGatewayRewardsForAdmin(): Promise<GatewayEggRewardSyncResult> {
  const client = createErwinGatewayClient();
  if (!client) throw new Error('erwin-gateway is not configured or enabled');

  const eggTypeRows = await db
    .select({
      id: eggTypes.id,
      displayName: eggTypes.displayName,
      twitchRewardId: eggTypes.twitchRewardId,
      twitchRewardTitle: eggTypes.twitchRewardTitle,
      twitchRewardPrompt: eggTypes.twitchRewardPrompt,
      twitchRewardCost: eggTypes.twitchRewardCost,
      twitchRewardBackgroundColor: eggTypes.twitchRewardBackgroundColor,
      twitchRewardGlobalCooldownMinutes: eggTypes.twitchRewardGlobalCooldownMinutes,
      twitchRewardMaxPerStream: eggTypes.twitchRewardMaxPerStream,
      twitchRewardMaxPerUserPerStream: eggTypes.twitchRewardMaxPerUserPerStream,
      isActive: eggTypes.isActive
    })
    .from(eggTypes)
    .orderBy(eggTypes.id);

  await client.syncRewards();
  const listedRewards = await client.listRewards();
  let gatewayRewards = Array.isArray(listedRewards.rewards) ? listedRewards.rewards : [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let adopted = 0;
  let discovered = 0;
  let blocked = 0;
  const rewards: GatewayEggRewardSyncResult['rewards'] = [];

  for (const eggType of eggTypeRows) {
    const plan = gatewayRewardPlanForEggType(eggType);
    const appOwnershipKey = appOwnershipKeyForEggType(eggType.id);
    const current = findCandidateReward(gatewayRewards, eggType, plan, appOwnershipKey);
    let reward = current;
    let action: GatewayEggRewardSyncResult['rewards'][number]['action'] = 'skipped';
    let error: string | undefined;

    if (reward) {
      const ownershipStatus = gatewayRewardOwnershipStatus(reward);
      const needsAdoption = ownershipStatus === 'unowned' || (ownershipStatus === 'unknown' && gatewayRewardAppOwnershipKey(reward) !== appOwnershipKey);
      if (needsAdoption && gatewayRewardCanAdopt(reward)) {
        reward = await client.adoptReward(reward.id, {
          app_ownership_key: appOwnershipKey,
          expected_twitch_reward_id: gatewayRewardTwitchId(reward) ?? undefined,
          local_reward_type: gatewayLocalRewardTypeForEggType(eggType.id)
        });
        adopted += 1;
        action = 'adopted';
        gatewayRewards = gatewayRewards.map((candidate) => (candidate.id === reward?.id ? reward : candidate));
      } else if (needsAdoption) {
        discovered += 1;
        action = 'discovered';
        error = gatewayRewardManageable(reward)
          ? 'Reward is not yet adoptable by erwin-gateway.'
          : 'Reward is not manageable by the Twitch client.';
      } else if (ownershipStatus === 'owned_by_other') {
        blocked += 1;
        action = 'discovered';
        error = 'Reward is owned by another gateway app.';
      }
    }

    if (!reward) {
      reward = await client.createReward(rewardPayload(plan));
      created += 1;
      action = 'created';
    } else if (gatewayRewardCanMutate(reward)) {
      if (hasSameRewardConfig(reward, plan)) {
        if (action === 'skipped') skipped += 1;
      } else {
        reward = await client.updateReward(reward.id, rewardPayload(plan));
        updated += 1;
        action = action === 'adopted' ? 'adopted' : 'updated';
      }
    } else if (action === 'skipped') {
      discovered += 1;
      action = 'discovered';
      error = 'Reward is not adopted by Hatchery, so update/delete actions are disabled.';
    }

    const twitchRewardId = gatewayRewardTwitchId(reward);
    if (!twitchRewardId) throw new Error(`Gateway reward ${reward.id} is missing a Twitch reward id`);

    const canMutate = gatewayRewardCanMutate(reward);
    await storeGatewayEggRewardMapping({
      eggTypeId: eggType.id,
      plan,
      reward,
      twitchRewardId,
      isActive: canMutate && plan.isEnabled,
      appOwnershipKey
    });

    rewards.push({
      eggTypeId: eggType.id,
      localRewardType: plan.localRewardType,
      gatewayRewardId: reward.id,
      twitchRewardId,
      title: reward.title ?? plan.title,
      isEnabled: gatewayRewardEnabled(reward),
      ownershipStatus: gatewayRewardOwnershipStatus(reward),
      manageable: gatewayRewardManageable(reward),
      canAdopt: gatewayRewardCanAdopt(reward),
      canMutate,
      appOwnershipKey,
      action,
      ...(error ? { error } : {})
    });
  }

  return { created, updated, skipped, adopted, discovered, blocked, total: eggTypeRows.length, rewards };
}

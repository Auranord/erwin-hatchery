import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { eggTypes, gatewayRewardMappings } from '../db/schema.js';
import { createErwinGatewayClient, type GatewayChannelPointReward } from './erwinGatewayClient.js';

const REWARD_PREFIX = '[Erwin Hatchery]';

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
  metadata: { source: 'erwin-hatchery'; rewardKind: 'egg_type'; eggTypeId: string };
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
  }>;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function localRewardTypeForEggType(eggTypeId: string): string {
  return `egg_type:${eggTypeId}`;
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
    metadata: { source: 'erwin-hatchery', rewardKind: 'egg_type', eggTypeId: eggType.id }
  };
}

function gatewayRewardTwitchId(reward: GatewayChannelPointReward): string | null {
  return stringOrNull(reward.twitch_reward_id) ?? stringOrNull(reward.twitchRewardId);
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

function rewardPayload(plan: EggTypeGatewayRewardPlan): Record<string, unknown> {
  return {
    title: plan.title,
    prompt: plan.prompt,
    cost: plan.cost,
    background_color: plan.backgroundColor,
    is_enabled: plan.isEnabled,
    enabled: plan.isEnabled,
    is_global_cooldown_enabled: plan.isGlobalCooldownEnabled,
    global_cooldown_seconds: plan.globalCooldownSeconds,
    is_max_per_stream_enabled: plan.isMaxPerStreamEnabled,
    max_per_stream: plan.maxPerStream,
    is_max_per_user_per_stream_enabled: plan.isMaxPerUserPerStreamEnabled,
    max_per_user_per_stream: plan.maxPerUserPerStream,
    metadata: plan.metadata
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

  const gatewayRewards = await client.listRewards();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const rewards: GatewayEggRewardSyncResult['rewards'] = [];

  for (const eggType of eggTypeRows) {
    const plan = gatewayRewardPlanForEggType(eggType);
    const current = gatewayRewards.rewards.find((reward) => {
      const metadata = reward.metadata ?? {};
      return (
        reward.id === eggType.twitchRewardId ||
        gatewayRewardTwitchId(reward) === eggType.twitchRewardId ||
        metadata.eggTypeId === eggType.id ||
        metadata.egg_type_id === eggType.id ||
        reward.title === plan.title
      );
    });

    const reward = current
      ? await (hasSameRewardConfig(current, plan)
          ? Promise.resolve(current)
          : client.updateReward(current.id, rewardPayload(plan)))
      : await client.createReward(rewardPayload(plan));

    if (current) {
      if (hasSameRewardConfig(current, plan)) skipped += 1;
      else updated += 1;
    } else {
      created += 1;
    }

    const twitchRewardId = gatewayRewardTwitchId(reward);
    if (!twitchRewardId) throw new Error(`Gateway reward ${reward.id} is missing a Twitch reward id`);

    await db.transaction(async (tx) => {
      await tx.update(eggTypes).set({ twitchRewardId }).where(eq(eggTypes.id, eggType.id));
      await tx
        .insert(gatewayRewardMappings)
        .values({
          localRewardType: plan.localRewardType,
          displayName: plan.title,
          gatewayRewardId: reward.id,
          twitchRewardId,
          isActive: plan.isEnabled,
          lastSyncedAt: new Date(),
          metadata: { plan, gatewayReward: reward },
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: gatewayRewardMappings.localRewardType,
          set: {
            displayName: plan.title,
            gatewayRewardId: reward.id,
            twitchRewardId,
            isActive: plan.isEnabled,
            lastSyncedAt: new Date(),
            metadata: { plan, gatewayReward: reward },
            updatedAt: new Date()
          }
        });
    });

    rewards.push({
      eggTypeId: eggType.id,
      localRewardType: plan.localRewardType,
      gatewayRewardId: reward.id,
      twitchRewardId,
      title: plan.title,
      isEnabled: plan.isEnabled
    });
  }

  return { created, updated, skipped, total: eggTypeRows.length, rewards };
}

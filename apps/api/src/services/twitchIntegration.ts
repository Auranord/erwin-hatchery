import { desc, eq, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { economyLedger, resources, twitchBackfillRuns, twitchBitsBalances, twitchEvents, twitchIntegrationState, users } from '../db/schema.js';
import { createErwinGatewayClient, smokeCheckErwinGateway } from './erwinGatewayClient.js';
import { REQUIRED_EVENTSUB_SUBSCRIPTIONS, checkEventSubHealth, syncChannelPointRedemptionEventSub } from './twitchEventSub.js';

export const REQUIRED_BROADCASTER_SCOPES = ['channel:read:subscriptions', 'channel:read:redemptions', 'channel:manage:redemptions', 'bits:read'] as const;

const VOUCHER_RESOURCE_TYPE = 'voucher';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function missingRequiredScopes(_scopeString: string): string[] {
  return [];
}

async function ensureState(values: Partial<typeof twitchIntegrationState.$inferInsert> = {}) {
  const now = new Date();
  const [row] = await db
    .insert(twitchIntegrationState)
    .values({
      id: 'default',
      requiredScopes: '',
      updatedAt: now,
      ...values,
    })
    .onConflictDoUpdate({
      target: [twitchIntegrationState.id],
      set: { requiredScopes: '', updatedAt: now, ...values },
    })
    .returning();
  return row;
}

async function readSetupReadiness() {
  const [state] = await db.select().from(twitchIntegrationState).where(eq(twitchIntegrationState.id, 'default')).limit(1);
  const health = await checkEventSubHealth();
  const gatewaySmoke = await smokeCheckErwinGateway();
  const missingScopes: string[] = [];
  const backfillsComplete = Boolean(state?.subscriptionBackfillCompletedAt && state.bitsBackfillCompletedAt);
  const ready = Boolean(gatewaySmoke.ok && backfillsComplete);

  return { state, health, missingScopes, ready, gatewaySmoke };
}

export async function finalizeSetupIfReady(): Promise<void> {
  const { state, ready } = await readSetupReadiness();
  if (!ready || state?.setupCompletedAt) return;
  await ensureState({ setupCompletedAt: new Date(), lastError: null });
}

export async function getSetupStatus() {
  const { state, health, missingScopes, ready, gatewaySmoke } = await readSetupReadiness();
  const backfills = await db.select().from(twitchBackfillRuns).orderBy(desc(twitchBackfillRuns.startedAt)).limit(10);
  return {
    completed: ready,
    requiresReauth: false,
    broadcaster: state?.broadcasterUserId ? { userId: state.broadcasterUserId, login: state.broadcasterLogin } : null,
    requiredScopes: [],
    missingScopes,
    setupCompletedAt: state?.setupCompletedAt ?? null,
    eventsubSyncedAt: state?.eventsubSyncedAt ?? null,
    subscriptionBackfillCompletedAt: state?.subscriptionBackfillCompletedAt ?? null,
    bitsBackfillCompletedAt: state?.bitsBackfillCompletedAt ?? null,
    lastHealthCheckAt: state?.lastHealthCheckAt ?? null,
    lastError: state?.lastError ?? null,
    eventSub: health,
    gateway: gatewaySmoke,
    twitchTransport: 'erwin-gateway',
    backfillSource: 'erwin-gateway backfills only; direct Helix backfills are retired',
    lastBackfillRuns: backfills,
  };
}

export async function runHealthCheck(log: { info: Function; warn: Function; error: Function }) {
  await syncChannelPointRedemptionEventSub(log);
  const gatewaySmoke = await smokeCheckErwinGateway();
  await ensureState({
    lastHealthCheckAt: new Date(),
    requiresReauth: false,
    eventsubHealthy: false,
    lastError: gatewaySmoke.ok ? null : gatewaySmoke.error,
  });
  await finalizeSetupIfReady();
  return getSetupStatus();
}

async function upsertProvisionalUserInTx(
  tx: Tx,
  input: {
    twitchUserId: string;
    login?: string | null;
    displayName?: string | null;
  },
) {
  const now = new Date();
  const existing = (await tx.select().from(users).where(eq(users.twitchUserId, input.twitchUserId)).limit(1))[0];
  if (existing) {
    const [updated] = await tx
      .update(users)
      .set({
        twitchLogin: input.login ?? existing.twitchLogin,
        displayName: input.displayName ?? existing.displayName,
        updatedAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning();
    return updated ?? existing;
  }
  const [created] = await tx
    .insert(users)
    .values({
      twitchUserId: input.twitchUserId,
      twitchLogin: input.login ?? null,
      displayName: input.displayName ?? null,
      isProvisional: true,
      lastLoginAt: null,
      updatedAt: now,
    })
    .returning();
  if (!created) throw new Error('Failed to create provisional user');
  return created;
}

async function grantVoucherInTx(
  tx: Tx,
  input: {
    userId: string;
    sourceId: string;
    sourceType: string;
    eventType: string;
    amount: number;
    reason: string;
  },
) {
  if (input.amount <= 0) return;
  const now = new Date();
  await tx
    .insert(resources)
    .values({
      userId: input.userId,
      resourceType: VOUCHER_RESOURCE_TYPE,
      amount: input.amount,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [resources.userId, resources.resourceType],
      set: {
        amount: sql`${resources.amount} + ${input.amount}`,
        updatedAt: now,
      },
    });
  await tx.insert(economyLedger).values({
    userId: input.userId,
    actorUserId: null,
    eventType: input.eventType,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    delta: {
      resources: [
        {
          resourceType: VOUCHER_RESOURCE_TYPE,
          amountDelta: input.amount,
          reason: input.reason,
        },
      ],
    },
  });
}

export async function grantBitsVouchersForEvent(input: {
  twitchEventRowId: string;
  twitchUserId: string;
  login?: string | null;
  displayName?: string | null;
  bits: number;
  reason: string;
}) {
  const bits = Math.max(0, Math.floor(input.bits));
  if (bits <= 0) return;
  await db.transaction(async (tx) => {
    const user = await upsertProvisionalUserInTx(tx, {
      twitchUserId: input.twitchUserId,
      login: input.login,
      displayName: input.displayName,
    });
    const [existing] = await tx.select().from(twitchBitsBalances).where(eq(twitchBitsBalances.userId, user.id)).limit(1);
    const imported = existing?.importedBitsBaseline ?? 0;
    const live = (existing?.eventsubBitsTotal ?? 0) + bits;
    const total = imported + live;
    const thresholds = Math.floor(total / config.TWITCH_BITS_PER_VOUCHER);
    const alreadyGranted = existing?.voucherThresholdsGranted ?? 0;
    const vouchersToGrant = Math.max(0, thresholds - alreadyGranted);
    await tx
      .insert(twitchBitsBalances)
      .values({
        userId: user.id,
        twitchUserId: input.twitchUserId,
        importedBitsBaseline: imported,
        eventsubBitsTotal: live,
        totalBitsCounted: total,
        voucherThresholdsGranted: thresholds,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [twitchBitsBalances.userId],
        set: {
          eventsubBitsTotal: live,
          totalBitsCounted: total,
          voucherThresholdsGranted: thresholds,
          updatedAt: new Date(),
        },
      });
    await grantVoucherInTx(tx, {
      userId: user.id,
      sourceId: input.twitchEventRowId,
      sourceType: 'eventsub_bits',
      eventType: 'bits_voucher_granted',
      amount: vouchersToGrant,
      reason: input.reason,
    });
  });
}

async function createBackfillRun(type: string, source: string) {
  const [run] = await db.insert(twitchBackfillRuns).values({ type, status: 'running', source }).returning();
  if (!run) throw new Error('Failed to create backfill run');
  return run;
}

function gatewayBackfillConfigurationError(backfillType: 'subscription' | 'bits'): Error {
  return new Error(
    `Cannot run ${backfillType} backfill: ERWIN_GATEWAY_ENABLED=true requires erwin-gateway backfills, but the erwin-gateway client is not configured. Set ERWIN_GATEWAY_URL and ERWIN_GATEWAY_APP_API_KEY.`,
  );
}

async function runGatewaySubscriptionBackfill(): Promise<void> {
  const client = createErwinGatewayClient();
  if (!client) {
    const error = gatewayBackfillConfigurationError('subscription');
    await ensureState({ lastError: error.message });
    throw error;
  }
  const run = await createBackfillRun('subscriptions', 'erwin-gateway/subscriptions/backfill');
  try {
    const result = await client.runSubscriptionBackfill();
    const now = new Date();
    await db.update(twitchBackfillRuns).set({ status: 'completed', completedAt: now }).where(eq(twitchBackfillRuns.id, run.id));
    await ensureState({
      subscriptionBackfillCompletedAt: now,
      lastError: null,
    });
    await finalizeSetupIfReady();
    await db
      .insert(twitchEvents)
      .values({
        twitchEventId: `gateway_subscription_backfill:${run.id}`,
        type: 'gateway_subscription_backfill',
        source: 'erwin_gateway',
        rawPayload: result,
        processedAt: now,
        processingStatus: 'processed',
      })
      .onConflictDoNothing();
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    await db.update(twitchBackfillRuns).set({ status: 'failed', completedAt: new Date(), error: message }).where(eq(twitchBackfillRuns.id, run.id));
    await ensureState({ lastError: message });
    throw error;
  }
}

export async function runSubscriptionBackfill(): Promise<void> {
  const already = await db.select().from(twitchIntegrationState).where(eq(twitchIntegrationState.id, 'default')).limit(1);
  if (already[0]?.subscriptionBackfillCompletedAt) {
    await finalizeSetupIfReady();
    return;
  }
  await runGatewaySubscriptionBackfill();
}

async function runGatewayBitsBackfill(): Promise<void> {
  const client = createErwinGatewayClient();
  if (!client) {
    const error = gatewayBackfillConfigurationError('bits');
    await ensureState({ lastError: error.message });
    throw error;
  }
  const run = await createBackfillRun('bits', 'erwin-gateway/bits/backfill');
  try {
    const result = await client.runBitsBackfill();
    const now = new Date();
    await db.update(twitchBackfillRuns).set({ status: 'completed', completedAt: now }).where(eq(twitchBackfillRuns.id, run.id));
    await ensureState({ bitsBackfillCompletedAt: now, lastError: null });
    await finalizeSetupIfReady();
    await db
      .insert(twitchEvents)
      .values({
        twitchEventId: `gateway_bits_backfill:${run.id}`,
        type: 'gateway_bits_backfill',
        source: 'erwin_gateway',
        rawPayload: result,
        processedAt: now,
        processingStatus: 'processed',
      })
      .onConflictDoNothing();
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    await db.update(twitchBackfillRuns).set({ status: 'failed', completedAt: new Date(), error: message }).where(eq(twitchBackfillRuns.id, run.id));
    await ensureState({ lastError: message });
    throw error;
  }
}

export async function runBitsBackfill(): Promise<void> {
  const already = await db.select().from(twitchIntegrationState).where(eq(twitchIntegrationState.id, 'default')).limit(1);
  if (already[0]?.bitsBackfillCompletedAt) {
    await finalizeSetupIfReady();
    return;
  }
  await runGatewayBitsBackfill();
}

export async function runAllBackfills(log: { info: Function; warn: Function; error: Function }): Promise<void> {
  await runSubscriptionBackfill();
  await runBitsBackfill();
  await finalizeSetupIfReady();
  log.info('Twitch setup backfills completed');
}

export async function markEventSubRevoked(reason: string): Promise<void> {
  const authRelated = reason.includes('authorization') || reason.includes('user_removed') || reason.includes('permission');
  await ensureState({
    requiresReauth: authRelated,
    eventsubHealthy: false,
    lastError: `EventSub revoked: ${reason}`,
  });
}

export { REQUIRED_EVENTSUB_SUBSCRIPTIONS };

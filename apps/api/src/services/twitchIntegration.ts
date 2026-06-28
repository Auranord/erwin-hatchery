import { desc, eq, sql } from 'drizzle-orm';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, getEventSubCallbackUrl } from '../config.js';
import { db } from '../db/client.js';
import {
  economyLedger,
  resources,
  roles,
  twitchBackfillRuns,
  twitchBitsBalances,
  twitchEvents,
  twitchIntegrationState,
  twitchUserTokens,
  users
} from '../db/schema.js';
import { createErwinGatewayClient, smokeCheckErwinGateway } from './erwinGatewayClient.js';
import {
  REQUIRED_EVENTSUB_SUBSCRIPTIONS,
  checkEventSubHealth,
  syncChannelPointRedemptionEventSub
} from './twitchEventSub.js';

export const REQUIRED_BROADCASTER_SCOPES = [
  'channel:read:subscriptions',
  'channel:read:redemptions',
  'channel:manage:redemptions',
  'bits:read'
] as const;

const VOUCHER_RESOURCE_TYPE = 'voucher';
const SETUP_STATE_COOKIE = 'eh_setup_oauth_state';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type TwitchTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string[];
};

type TwitchUser = {
  id: string;
  login: string;
  display_name: string;
  profile_image_url?: string;
};

type HelixSubscription = {
  user_id: string;
  user_login: string;
  user_name: string;
  gifter_id?: string;
  gifter_login?: string;
  gifter_name?: string;
};

type HelixBitsLeaderboardEntry = {
  user_id: string;
  user_login: string;
  user_name: string;
  score: number;
};

function parseCookie(request: FastifyRequest, name: string): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  const entry = raw
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.split('=').slice(1).join('=')) : null;
}

export function createSetupStateCookie(reply: FastifyReply): string {
  const state = randomBytes(24).toString('hex');
  reply.header(
    'Set-Cookie',
    `${SETUP_STATE_COOKIE}=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${config.NODE_ENV === 'production' ? '; Secure' : ''}`
  );
  return state;
}

export function validateSetupState(request: FastifyRequest, state: string | undefined): boolean {
  const cookieState = parseCookie(request, SETUP_STATE_COOKIE);
  if (!state || !cookieState || state.length !== cookieState.length) return false;
  return timingSafeEqual(Buffer.from(state), Buffer.from(cookieState));
}

export function clearSetupStateCookie(reply: FastifyReply): void {
  reply.header(
    'Set-Cookie',
    `${SETUP_STATE_COOKIE}=deleted; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${config.NODE_ENV === 'production' ? '; Secure' : ''}`
  );
}

export function setupRedirectUri(): string {
  return new URL('/api/setup/twitch/callback', config.PUBLIC_APP_URL).toString();
}

async function readErrorDetails(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return text.trim().slice(0, 300) || 'no response body';
}

async function twitchTokenRequest(params: Record<string, string>): Promise<TwitchTokenResponse> {
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.TWITCH_CLIENT_ID,
      client_secret: config.TWITCH_CLIENT_SECRET,
      ...params
    })
  });
  if (!response.ok) throw new Error(`Twitch token request failed: ${response.status} (${await readErrorDetails(response)})`);
  return (await response.json()) as TwitchTokenResponse;
}

async function twitchApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.twitch.tv/helix${path}`, {
    ...init,
    headers: {
      'Client-Id': config.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) throw new Error(`Twitch API ${path} failed: ${response.status} (${await readErrorDetails(response)})`);
  return (await response.json()) as T;
}

export function missingRequiredScopes(scopeString: string): string[] {
  const granted = new Set(scopeString.split(/\s+/).filter(Boolean));
  return REQUIRED_BROADCASTER_SCOPES.filter((scope) => !granted.has(scope));
}

async function ensureState(values: Partial<typeof twitchIntegrationState.$inferInsert> = {}) {
  const now = new Date();
  const [row] = await db
    .insert(twitchIntegrationState)
    .values({
      id: 'default',
      requiredScopes: REQUIRED_BROADCASTER_SCOPES.join(' '),
      updatedAt: now,
      ...values
    })
    .onConflictDoUpdate({
      target: [twitchIntegrationState.id],
      set: { requiredScopes: REQUIRED_BROADCASTER_SCOPES.join(' '), updatedAt: now, ...values }
    })
    .returning();
  return row;
}

async function readSetupReadiness() {
  const [state] = await db.select().from(twitchIntegrationState).where(eq(twitchIntegrationState.id, 'default')).limit(1);
  const health = await checkEventSubHealth();
  const gatewaySmoke = config.ERWIN_GATEWAY_ENABLED ? await smokeCheckErwinGateway() : null;
  const tokenRows: Array<{ scope: string }> = config.ERWIN_GATEWAY_ENABLED
    ? []
    : await db
        .select({ scope: twitchUserTokens.scope })
        .from(twitchUserTokens)
        .innerJoin(users, eq(users.id, twitchUserTokens.userId))
        .where(eq(users.twitchUserId, config.TWITCH_BROADCASTER_ID))
        .limit(1);
  const missingScopes = config.ERWIN_GATEWAY_ENABLED
    ? []
    : tokenRows[0]
      ? missingRequiredScopes(tokenRows[0].scope)
      : REQUIRED_BROADCASTER_SCOPES.slice();
  const backfillsComplete = Boolean(state?.subscriptionBackfillCompletedAt && state.bitsBackfillCompletedAt);
  const ready = config.ERWIN_GATEWAY_ENABLED
    ? Boolean(gatewaySmoke?.ok && backfillsComplete)
    : Boolean(
        tokenRows[0] &&
          missingScopes.length === 0 &&
          !state?.requiresReauth &&
          health.enabled &&
          state?.eventsubSyncedAt &&
          backfillsComplete
      );

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
  const completed = ready;
  const suppressedGatewaySkipError = config.ERWIN_GATEWAY_ENABLED && state?.lastError === 'Direct broadcaster Twitch health check skipped because ERWIN_GATEWAY_ENABLED=true';
  return {
    completed,
    requiresReauth: config.ERWIN_GATEWAY_ENABLED ? false : state?.requiresReauth ?? false,
    broadcaster: state?.broadcasterUserId ? { userId: state.broadcasterUserId, login: state.broadcasterLogin } : null,
    requiredScopes: config.ERWIN_GATEWAY_ENABLED ? [] : REQUIRED_BROADCASTER_SCOPES,
    missingScopes,
    setupCompletedAt: state?.setupCompletedAt ?? null,
    eventsubSyncedAt: state?.eventsubSyncedAt ?? null,
    subscriptionBackfillCompletedAt: state?.subscriptionBackfillCompletedAt ?? null,
    bitsBackfillCompletedAt: state?.bitsBackfillCompletedAt ?? null,
    lastHealthCheckAt: state?.lastHealthCheckAt ?? null,
    lastError: suppressedGatewaySkipError ? null : state?.lastError ?? null,
    eventSub: health,
    gateway: gatewaySmoke,
    twitchTransport: config.ERWIN_GATEWAY_ENABLED ? 'erwin-gateway' : 'direct_twitch',
    backfillSource: config.ERWIN_GATEWAY_ENABLED ? 'erwin-gateway backfills only; direct Helix backfills are disabled' : 'direct Twitch Helix/EventSub',
    lastBackfillRuns: backfills
  };
}

export async function completeSetupOAuth(code: string, log: { info: Function; warn: Function; error: Function }) {
  const tokenJson = await twitchTokenRequest({ code, grant_type: 'authorization_code', redirect_uri: setupRedirectUri() });
  if (!tokenJson.access_token || !tokenJson.refresh_token || !tokenJson.expires_in) throw new Error('Twitch token response was incomplete');
  const scopeString = (tokenJson.scope ?? []).join(' ');
  const missing = missingRequiredScopes(scopeString);
  if (missing.length > 0) {
    await ensureState({ requiresReauth: true, lastError: `Missing scopes: ${missing.join(', ')}` });
    throw new Error(`Missing Twitch scopes: ${missing.join(', ')}`);
  }
  const userResponse = await twitchApi<{ data: TwitchUser[] }>('/users', tokenJson.access_token);
  const twitchUser = userResponse.data[0];
  if (!twitchUser) throw new Error('Could not load Twitch profile');
  if (twitchUser.id !== config.TWITCH_BROADCASTER_ID) {
    await ensureState({ requiresReauth: true, lastError: 'Broadcaster Twitch user ID mismatch' });
    throw new Error('Twitch account does not match TWITCH_BROADCASTER_ID');
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    const existing = (await tx.select().from(users).where(eq(users.twitchUserId, twitchUser.id)).limit(1))[0];
    const user = existing
      ? (await tx.update(users).set({ twitchLogin: twitchUser.login, displayName: twitchUser.display_name, avatarUrl: twitchUser.profile_image_url ?? null, isProvisional: false, updatedAt: now, lastLoginAt: now }).where(eq(users.id, existing.id)).returning())[0]
      : (await tx.insert(users).values({ twitchUserId: twitchUser.id, twitchLogin: twitchUser.login, displayName: twitchUser.display_name, avatarUrl: twitchUser.profile_image_url ?? null, isProvisional: false, lastLoginAt: now }).returning())[0];
    if (!user) throw new Error('Failed to persist broadcaster user');
    await tx.insert(roles).values({ userId: user.id, role: 'owner', createdByUserId: user.id }).onConflictDoNothing();
    await tx.insert(twitchUserTokens).values({ userId: user.id, accessToken: tokenJson.access_token!, refreshToken: tokenJson.refresh_token!, scope: scopeString, expiresAt: new Date(now.getTime() + tokenJson.expires_in! * 1000), updatedAt: now }).onConflictDoUpdate({ target: [twitchUserTokens.userId], set: { accessToken: tokenJson.access_token!, refreshToken: tokenJson.refresh_token!, scope: scopeString, expiresAt: new Date(now.getTime() + tokenJson.expires_in! * 1000), updatedAt: now } });
  });
  await ensureState({ broadcasterUserId: twitchUser.id, broadcasterLogin: twitchUser.login, requiredScopes: REQUIRED_BROADCASTER_SCOPES.join(' '), requiresReauth: false, lastError: null });
  await syncChannelPointRedemptionEventSub(log);
  await runAllBackfills(log);
  await finalizeSetupIfReady();
  return getSetupStatus();
}

export async function refreshBroadcasterToken(): Promise<void> {
  if (config.ERWIN_GATEWAY_ENABLED) {
    throw new Error('Broadcaster token refresh is disabled while ERWIN_GATEWAY_ENABLED=true');
  }
  const rows = await db.select({ userId: twitchUserTokens.userId, refreshToken: twitchUserTokens.refreshToken }).from(twitchUserTokens).innerJoin(users, eq(users.id, twitchUserTokens.userId)).where(eq(users.twitchUserId, config.TWITCH_BROADCASTER_ID)).limit(1);
  const row = rows[0];
  if (!row) throw new Error('Missing broadcaster token');
  const tokenJson = await twitchTokenRequest({ grant_type: 'refresh_token', refresh_token: row.refreshToken });
  if (!tokenJson.access_token || !tokenJson.refresh_token || !tokenJson.expires_in) throw new Error('Twitch refresh response was incomplete');
  await db.update(twitchUserTokens).set({ accessToken: tokenJson.access_token, refreshToken: tokenJson.refresh_token, scope: (tokenJson.scope ?? []).join(' '), expiresAt: new Date(Date.now() + tokenJson.expires_in * 1000), updatedAt: new Date() }).where(eq(twitchUserTokens.userId, row.userId));
}

export async function runHealthCheck(log: { info: Function; warn: Function; error: Function }) {
  if (config.ERWIN_GATEWAY_ENABLED) {
    await syncChannelPointRedemptionEventSub(log);
    const gatewaySmoke = await smokeCheckErwinGateway();
    await ensureState({
      lastHealthCheckAt: new Date(),
      requiresReauth: false,
      eventsubHealthy: false,
      lastError: gatewaySmoke.ok ? null : gatewaySmoke.error
    });
    await finalizeSetupIfReady();
    return getSetupStatus();
  }

  try {
    await refreshBroadcasterToken();
    await syncChannelPointRedemptionEventSub(log);
    const status = await getSetupStatus();
    await ensureState({ lastHealthCheckAt: new Date(), requiresReauth: status.missingScopes.length > 0, eventsubHealthy: status.eventSub.enabled, lastError: status.eventSub.error });
    await finalizeSetupIfReady();
    return getSetupStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    await ensureState({ lastHealthCheckAt: new Date(), requiresReauth: true, lastError: message, eventsubHealthy: false });
    throw error;
  }
}

async function getBroadcasterToken(): Promise<string> {
  const [row] = await db.select({ accessToken: twitchUserTokens.accessToken }).from(twitchUserTokens).innerJoin(users, eq(users.id, twitchUserTokens.userId)).where(eq(users.twitchUserId, config.TWITCH_BROADCASTER_ID)).limit(1);
  if (!row) throw new Error('Missing broadcaster token');
  return row.accessToken;
}

async function upsertProvisionalUserInTx(tx: Tx, input: { twitchUserId: string; login?: string | null; displayName?: string | null }) {
  const now = new Date();
  const existing = (await tx.select().from(users).where(eq(users.twitchUserId, input.twitchUserId)).limit(1))[0];
  if (existing) {
    const [updated] = await tx.update(users).set({ twitchLogin: input.login ?? existing.twitchLogin, displayName: input.displayName ?? existing.displayName, updatedAt: now }).where(eq(users.id, existing.id)).returning();
    return updated ?? existing;
  }
  const [created] = await tx.insert(users).values({ twitchUserId: input.twitchUserId, twitchLogin: input.login ?? null, displayName: input.displayName ?? null, isProvisional: true, lastLoginAt: null, updatedAt: now }).returning();
  if (!created) throw new Error('Failed to create provisional user');
  return created;
}

async function grantVoucherInTx(tx: Tx, input: { userId: string; sourceId: string; sourceType: string; eventType: string; amount: number; reason: string }) {
  if (input.amount <= 0) return;
  const now = new Date();
  await tx.insert(resources).values({ userId: input.userId, resourceType: VOUCHER_RESOURCE_TYPE, amount: input.amount, updatedAt: now }).onConflictDoUpdate({ target: [resources.userId, resources.resourceType], set: { amount: sql`${resources.amount} + ${input.amount}`, updatedAt: now } });
  await tx.insert(economyLedger).values({ userId: input.userId, actorUserId: null, eventType: input.eventType, sourceType: input.sourceType, sourceId: input.sourceId, delta: { resources: [{ resourceType: VOUCHER_RESOURCE_TYPE, amountDelta: input.amount, reason: input.reason }] } });
}

export async function grantBitsVouchersForEvent(input: { twitchEventRowId: string; twitchUserId: string; login?: string | null; displayName?: string | null; bits: number; reason: string }) {
  const bits = Math.max(0, Math.floor(input.bits));
  if (bits <= 0) return;
  await db.transaction(async (tx) => {
    const user = await upsertProvisionalUserInTx(tx, { twitchUserId: input.twitchUserId, login: input.login, displayName: input.displayName });
    const [existing] = await tx.select().from(twitchBitsBalances).where(eq(twitchBitsBalances.userId, user.id)).limit(1);
    const imported = existing?.importedBitsBaseline ?? 0;
    const live = (existing?.eventsubBitsTotal ?? 0) + bits;
    const total = imported + live;
    const thresholds = Math.floor(total / config.TWITCH_BITS_PER_VOUCHER);
    const alreadyGranted = existing?.voucherThresholdsGranted ?? 0;
    const vouchersToGrant = Math.max(0, thresholds - alreadyGranted);
    await tx.insert(twitchBitsBalances).values({ userId: user.id, twitchUserId: input.twitchUserId, importedBitsBaseline: imported, eventsubBitsTotal: live, totalBitsCounted: total, voucherThresholdsGranted: thresholds, updatedAt: new Date() }).onConflictDoUpdate({ target: [twitchBitsBalances.userId], set: { eventsubBitsTotal: live, totalBitsCounted: total, voucherThresholdsGranted: thresholds, updatedAt: new Date() } });
    await grantVoucherInTx(tx, { userId: user.id, sourceId: input.twitchEventRowId, sourceType: 'eventsub_bits', eventType: 'bits_voucher_granted', amount: vouchersToGrant, reason: input.reason });
  });
}

async function createBackfillRun(type: string, source: string) {
  const [run] = await db.insert(twitchBackfillRuns).values({ type, status: 'running', source }).returning();
  if (!run) throw new Error('Failed to create backfill run');
  return run;
}

function gatewayBackfillConfigurationError(backfillType: 'subscription' | 'bits'): Error {
  return new Error(
    `Cannot run ${backfillType} backfill: ERWIN_GATEWAY_ENABLED=true requires erwin-gateway backfills, but the erwin-gateway client is not configured. Set ERWIN_GATEWAY_URL and ERWIN_GATEWAY_APP_API_KEY, or set ERWIN_GATEWAY_ENABLED=false for direct Helix rollback mode.`
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
    await ensureState({ subscriptionBackfillCompletedAt: now, lastError: null });
    await finalizeSetupIfReady();
    await db.insert(twitchEvents).values({
      twitchEventId: `gateway_subscription_backfill:${run.id}`,
      type: 'gateway_subscription_backfill',
      source: 'erwin_gateway',
      rawPayload: result,
      processedAt: now,
      processingStatus: 'processed'
    }).onConflictDoNothing();
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
  if (config.ERWIN_GATEWAY_ENABLED) {
    await runGatewaySubscriptionBackfill();
    return;
  }
  const run = await createBackfillRun('subscriptions', 'helix/subscriptions');
  try {
    const token = await getBroadcasterToken();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ broadcaster_id: config.TWITCH_BROADCASTER_ID, first: '100' });
      if (cursor) query.set('after', cursor);
      const page = await twitchApi<{ data: HelixSubscription[]; pagination?: { cursor?: string } }>(`/subscriptions?${query.toString()}`, token);
      for (const sub of page.data) {
        await db.transaction(async (tx) => {
          const [eventRow] = await tx.insert(twitchEvents).values({ twitchEventId: `subscription_backfill:${sub.user_id}`, type: 'subscription_backfill', source: 'twitch_backfill', rawPayload: sub, processedAt: new Date(), processingStatus: 'processed' }).onConflictDoNothing().returning({ id: twitchEvents.id });
          if (!eventRow) return;
          const user = await upsertProvisionalUserInTx(tx, { twitchUserId: sub.user_id, login: sub.user_login, displayName: sub.user_name });
          await grantVoucherInTx(tx, { userId: user.id, sourceId: eventRow.id, sourceType: 'subscription_backfill', eventType: 'subscription_backfill_voucher_granted', amount: 1, reason: 'subscription_backfill_recipient' });
          if (sub.gifter_id) {
            const [giftRow] = await tx.insert(twitchEvents).values({ twitchEventId: `subscription_gift_backfill:${sub.gifter_id}:${sub.user_id}`, type: 'subscription_gift_backfill', source: 'twitch_backfill', rawPayload: sub, processedAt: new Date(), processingStatus: 'processed' }).onConflictDoNothing().returning({ id: twitchEvents.id });
            if (giftRow) {
              const gifter = await upsertProvisionalUserInTx(tx, { twitchUserId: sub.gifter_id, login: sub.gifter_login, displayName: sub.gifter_name });
              await grantVoucherInTx(tx, { userId: gifter.id, sourceId: giftRow.id, sourceType: 'subscription_gift_backfill', eventType: 'subscription_gift_backfill_voucher_granted', amount: 1, reason: 'subscription_backfill_gifter' });
            }
          }
        });
      }
      cursor = page.pagination?.cursor ?? null;
    } while (cursor);
    const now = new Date();
    await db.update(twitchBackfillRuns).set({ status: 'completed', completedAt: now }).where(eq(twitchBackfillRuns.id, run.id));
    await ensureState({ subscriptionBackfillCompletedAt: now, lastError: null });
    await finalizeSetupIfReady();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    await db.update(twitchBackfillRuns).set({ status: 'failed', completedAt: new Date(), error: message }).where(eq(twitchBackfillRuns.id, run.id));
    await ensureState({ lastError: message });
    throw error;
  }
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
    await db.insert(twitchEvents).values({
      twitchEventId: `gateway_bits_backfill:${run.id}`,
      type: 'gateway_bits_backfill',
      source: 'erwin_gateway',
      rawPayload: result,
      processedAt: now,
      processingStatus: 'processed'
    }).onConflictDoNothing();
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
  if (config.ERWIN_GATEWAY_ENABLED) {
    await runGatewayBitsBackfill();
    return;
  }
  const run = await createBackfillRun('bits', 'helix/bits/leaderboard');
  try {
    const token = await getBroadcasterToken();
    const page = await twitchApi<{ data: HelixBitsLeaderboardEntry[] }>(`/bits/leaderboard?count=100&period=all`, token);
    for (const entry of page.data) {
      await db.transaction(async (tx) => {
        const [eventRow] = await tx.insert(twitchEvents).values({ twitchEventId: `bits_backfill:${entry.user_id}`, type: 'bits_backfill', source: 'twitch_backfill', rawPayload: entry, processedAt: new Date(), processingStatus: 'processed' }).onConflictDoNothing().returning({ id: twitchEvents.id });
        if (!eventRow) return;
        const user = await upsertProvisionalUserInTx(tx, { twitchUserId: entry.user_id, login: entry.user_login, displayName: entry.user_name });
        const [existing] = await tx.select().from(twitchBitsBalances).where(eq(twitchBitsBalances.userId, user.id)).limit(1);
        const liveBits = existing?.eventsubBitsTotal ?? 0;
        const totalBits = entry.score + liveBits;
        const thresholds = Math.floor(totalBits / config.TWITCH_BITS_PER_VOUCHER);
        const vouchersToGrant = Math.max(0, thresholds - (existing?.voucherThresholdsGranted ?? 0));
        await tx.insert(twitchBitsBalances).values({ userId: user.id, twitchUserId: entry.user_id, importedBitsBaseline: entry.score, eventsubBitsTotal: liveBits, totalBitsCounted: totalBits, voucherThresholdsGranted: thresholds, updatedAt: new Date() }).onConflictDoUpdate({ target: [twitchBitsBalances.userId], set: { importedBitsBaseline: entry.score, totalBitsCounted: totalBits, voucherThresholdsGranted: thresholds, updatedAt: new Date() } });
        await grantVoucherInTx(tx, { userId: user.id, sourceId: eventRow.id, sourceType: 'bits_backfill', eventType: 'bits_backfill_voucher_granted', amount: vouchersToGrant, reason: 'bits_leaderboard_baseline' });
      });
    }
    const now = new Date();
    await db.update(twitchBackfillRuns).set({ status: 'completed', completedAt: now }).where(eq(twitchBackfillRuns.id, run.id));
    await ensureState({ bitsBackfillCompletedAt: now, lastError: null });
    await finalizeSetupIfReady();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    await db.update(twitchBackfillRuns).set({ status: 'failed', completedAt: new Date(), error: message }).where(eq(twitchBackfillRuns.id, run.id));
    await ensureState({ lastError: message });
    throw error;
  }
}

export async function runAllBackfills(log: { info: Function; warn: Function; error: Function }): Promise<void> {
  await runSubscriptionBackfill();
  await runBitsBackfill();
  await finalizeSetupIfReady();
  log.info('Twitch setup backfills completed');
}

export async function markEventSubRevoked(reason: string): Promise<void> {
  const authRelated = reason.includes('authorization') || reason.includes('user_removed') || reason.includes('permission');
  await ensureState({ requiresReauth: authRelated, eventsubHealthy: false, lastError: `EventSub revoked: ${reason}` });
}

export { REQUIRED_EVENTSUB_SUBSCRIPTIONS };

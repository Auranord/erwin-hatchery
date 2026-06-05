import { createHmac, timingSafeEqual } from 'node:crypto';

export type GatewayWebhookPayload = {
  delivery_id?: string;
  event_id?: string;
  type?: string;
  event_type?: string;
  data?: unknown;
  twitch?: {
    redemption?: { id?: string };
    message_id?: string;
  };
  redemption?: { id?: string };
  message?: { id?: string };
};

export type GatewayWebhookRecord = {
  deliveryId: string;
  eventId: string;
  eventType: string;
  twitchRedemptionId: string | null;
  twitchMessageId: string | null;
  rawPayload: GatewayWebhookPayload;
  processingStatus: 'observed' | 'received';
};

export type GatewayWebhookStoreResult = { inserted: true } | { inserted: false; status?: string };

export type GatewayWebhookStore = {
  insertEvent(record: GatewayWebhookRecord): Promise<GatewayWebhookStoreResult>;
};

export type GatewayWebhookHandleResult =
  | { ok: true; statusCode: 202; duplicate: false; observeOnly: boolean }
  | { ok: true; statusCode: 200; duplicate: true; status: string }
  | { ok: false; statusCode: 400; message: string };

export function timingSafeStringEqual(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const receivedBytes = Buffer.from(received, 'utf8');
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

export function signGatewayWebhook(input: { secret: string; deliveryId: string; timestamp: string; rawBody: Buffer }): string {
  return `sha256=${createHmac('sha256', input.secret)
    .update(input.deliveryId)
    .update(input.timestamp)
    .update(input.rawBody)
    .digest('hex')}`;
}

export function verifyGatewaySignature(input: {
  secret: string;
  deliveryId: string;
  timestamp: string;
  rawBody: Buffer;
  signature: string;
}): boolean {
  return timingSafeStringEqual(signGatewayWebhook(input), input.signature);
}

export function isFreshTimestamp(timestamp: string, maxAgeSeconds: number, nowMs = Date.now()): boolean {
  const timestampMs = Date.parse(timestamp);
  if (Number.isNaN(timestampMs)) return false;
  const ageMs = Math.abs(nowMs - timestampMs);
  return ageMs <= maxAgeSeconds * 1000;
}

function extractString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function extractNestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const nested = (value as Record<string, unknown>)[key];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return null;
  return nested as Record<string, unknown>;
}

export function extractTwitchRedemptionId(payload: GatewayWebhookPayload): string | null {
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? (payload.data as Record<string, unknown>)
    : null;
  const redemption = payload.redemption ?? payload.twitch?.redemption ?? extractNestedRecord(data, 'redemption');
  return extractString(redemption?.id) ?? extractString(data?.redemption_id);
}

export function extractTwitchMessageId(payload: GatewayWebhookPayload): string | null {
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? (payload.data as Record<string, unknown>)
    : null;
  return extractString(payload.twitch?.message_id) ?? extractString(payload.message?.id) ?? extractString(data?.message_id);
}

export async function handleErwinGatewayWebhook(input: {
  secret: string;
  deliveryId: string | null;
  headerEventId: string | null;
  timestamp: string | null;
  signature: string | null;
  rawBody: Buffer | undefined;
  maxAgeSeconds: number;
  observeOnly: boolean;
  store: GatewayWebhookStore;
  nowMs?: number;
}): Promise<GatewayWebhookHandleResult> {
  if (!input.deliveryId || !input.timestamp || !input.signature || !input.rawBody) {
    return { ok: false, statusCode: 400, message: 'Missing erwin-gateway webhook signature headers' };
  }

  if (!isFreshTimestamp(input.timestamp, input.maxAgeSeconds, input.nowMs)) {
    return { ok: false, statusCode: 400, message: 'Stale erwin-gateway webhook timestamp' };
  }

  if (!verifyGatewaySignature({
    secret: input.secret,
    deliveryId: input.deliveryId,
    timestamp: input.timestamp,
    rawBody: input.rawBody,
    signature: input.signature
  })) {
    return { ok: false, statusCode: 400, message: 'Invalid erwin-gateway webhook signature' };
  }

  let payload: GatewayWebhookPayload;
  try {
    payload = JSON.parse(input.rawBody.toString('utf8')) as GatewayWebhookPayload;
  } catch {
    return { ok: false, statusCode: 400, message: 'Invalid erwin-gateway webhook JSON' };
  }

  const eventId = extractString(payload.event_id) ?? input.headerEventId;
  const eventType = extractString(payload.type) ?? extractString(payload.event_type);
  if (!eventId || !eventType) {
    return { ok: false, statusCode: 400, message: 'Missing erwin-gateway event id or type' };
  }

  const stored = await input.store.insertEvent({
    deliveryId: input.deliveryId,
    eventId,
    eventType,
    twitchRedemptionId: extractTwitchRedemptionId(payload),
    twitchMessageId: extractTwitchMessageId(payload),
    rawPayload: { ...payload, delivery_id: input.deliveryId },
    processingStatus: input.observeOnly ? 'observed' : 'received'
  });

  if (!stored.inserted) {
    return { ok: true, statusCode: 200, duplicate: true, status: stored.status ?? 'duplicate' };
  }

  return { ok: true, statusCode: 202, duplicate: false, observeOnly: input.observeOnly };
}

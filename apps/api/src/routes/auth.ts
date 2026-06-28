import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { roles, sessions, twitchPlayerTokens, users } from '../db/schema.js';
import { getSessionIdentity, isAdminRole } from './session-auth.js';
import { config, getOAuthRedirectUri, isProduction } from '../config.js';

const SESSION_COOKIE_NAME = 'eh_session';
const ONE_DAY_SECONDS = 60 * 60 * 24;
const SESSION_TTL_DAYS = 30;
const PLAYER_OAUTH_SCOPES = ['user:read:email', 'user:read:subscriptions'] as const;
const SUBSCRIPTION_SCOPE = 'user:read:subscriptions';

type TwitchUser = {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
};

type TwitchTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string[];
};

type TwitchSubscriptionUserResponse = {
  data?: Array<{
    broadcaster_id: string;
    broadcaster_login: string;
    broadcaster_name: string;
    tier: string;
    is_gift: boolean;
    gifter_id?: string;
    gifter_login?: string;
    gifter_name?: string;
  }>;
};

function parseCookie(request: FastifyRequest, name: string): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  const entry = raw.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.split('=').slice(1).join('=')) : null;
}

function scopeStringToSet(scope: string): Set<string> {
  return new Set(scope.split(/\s+/).filter(Boolean));
}

async function refreshPlayerToken(userId: string, refreshToken: string, currentScope: string): Promise<string | null> {
  const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.TWITCH_CLIENT_ID,
      client_secret: config.TWITCH_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  if (!tokenResponse.ok) return null;
  const tokenJson = (await tokenResponse.json()) as TwitchTokenResponse;
  if (!tokenJson.access_token || !tokenJson.refresh_token || !tokenJson.expires_in) return null;

  await db
    .update(twitchPlayerTokens)
    .set({
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      scope: (tokenJson.scope ?? Array.from(scopeStringToSet(currentScope))).join(' '),
      expiresAt: new Date(Date.now() + tokenJson.expires_in * 1000),
      updatedAt: new Date()
    })
    .where(eq(twitchPlayerTokens.userId, userId));

  return tokenJson.access_token;
}

async function getPlayerAccessToken(userId: string): Promise<{ accessToken: string | null; requiresReauth: boolean }> {
  const [tokenRow] = await db
    .select({
      accessToken: twitchPlayerTokens.accessToken,
      refreshToken: twitchPlayerTokens.refreshToken,
      scope: twitchPlayerTokens.scope,
      expiresAt: twitchPlayerTokens.expiresAt
    })
    .from(twitchPlayerTokens)
    .where(eq(twitchPlayerTokens.userId, userId))
    .limit(1);

  if (!tokenRow || !scopeStringToSet(tokenRow.scope).has(SUBSCRIPTION_SCOPE)) {
    return { accessToken: null, requiresReauth: true };
  }

  if (tokenRow.expiresAt.getTime() > Date.now() + 60_000) {
    return { accessToken: tokenRow.accessToken, requiresReauth: false };
  }

  const refreshed = await refreshPlayerToken(userId, tokenRow.refreshToken, tokenRow.scope);
  return { accessToken: refreshed, requiresReauth: !refreshed };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/twitch/login', async (_request, reply) => {
    const state = randomBytes(24).toString('hex');
    const oauthStateCookie = `eh_oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${isProduction ? '; Secure' : ''}`;
    reply.header('Set-Cookie', oauthStateCookie);

    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.set('client_id', config.TWITCH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', getOAuthRedirectUri());
    authUrl.searchParams.set('response_type', 'code');
    // Player login uses identity plus user-authorized subscription status checks.
    // Broadcaster transport scopes for redemptions, subscription events, and Bits
    // are owned by erwin-gateway.
    authUrl.searchParams.set('scope', PLAYER_OAUTH_SCOPES.join(' '));
    authUrl.searchParams.set('state', state);
    return reply.redirect(authUrl.toString());
  });

  app.get('/api/auth/twitch/callback', async (request, reply) => {
    const code = (request.query as { code?: string }).code;
    const state = (request.query as { state?: string }).state;
    const cookieState = parseCookie(request, 'eh_oauth_state');

    if (!code || !state || !cookieState || !timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) {
      return reply.code(400).send({ message: 'Invalid OAuth state' });
    }

    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.TWITCH_CLIENT_ID,
        client_secret: config.TWITCH_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: getOAuthRedirectUri()
      })
    });

    if (!tokenResponse.ok) {
      request.log.error({ statusCode: tokenResponse.status }, 'oauth token exchange failed');
      return reply.code(502).send({ message: 'OAuth exchange failed' });
    }

    const tokenJson = (await tokenResponse.json()) as TwitchTokenResponse;
    if (!tokenJson.access_token || !tokenJson.refresh_token || !tokenJson.expires_in) {
      request.log.error('oauth token exchange returned incomplete token payload');
      return reply.code(502).send({ message: 'OAuth exchange failed' });
    }
    const meResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        'Client-Id': config.TWITCH_CLIENT_ID
      }
    });
    const meJson = (await meResponse.json()) as { data: TwitchUser[] };
    const twitchUser = meJson.data?.[0];

    if (!twitchUser) return reply.code(502).send({ message: 'Could not load Twitch profile' });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * ONE_DAY_SECONDS * 1000);
    const playerTokenExpiresAt = new Date(now.getTime() + tokenJson.expires_in * 1000);
    const playerTokenScope = (tokenJson.scope ?? PLAYER_OAUTH_SCOPES).join(' ');

    const user = await db.transaction(async (tx) => {
      const existing = await tx.select().from(users).where(eq(users.twitchUserId, twitchUser.id)).limit(1);
      const existingUser = existing[0];

      let currentUser;
      if (existingUser) {
        const updatedRows = await tx
          .update(users)
          .set({ twitchLogin: twitchUser.login, displayName: twitchUser.display_name, avatarUrl: twitchUser.profile_image_url, lastLoginAt: now, updatedAt: now, isProvisional: false })
          .where(eq(users.id, existingUser.id))
          .returning();
        currentUser = updatedRows[0];
      } else {
        const insertedRows = await tx
          .insert(users)
          .values([{ twitchUserId: twitchUser.id, twitchLogin: twitchUser.login, displayName: twitchUser.display_name, avatarUrl: twitchUser.profile_image_url, isProvisional: false, lastLoginAt: now }])
          .returning();
        currentUser = insertedRows[0];
      }

      if (!currentUser) {
        throw new Error('Failed to persist Twitch user during OAuth callback');
      }

      const ownerRole = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.userId, currentUser.id), eq(roles.role, 'owner')))
        .limit(1);

      if (twitchUser.id === config.TWITCH_BROADCASTER_ID && ownerRole.length === 0) {
        await tx.insert(roles).values({ userId: currentUser.id, role: 'owner', createdByUserId: currentUser.id });
      }

      await tx
        .insert(twitchPlayerTokens)
        .values({
          userId: currentUser.id,
          accessToken: tokenJson.access_token,
          refreshToken: tokenJson.refresh_token,
          scope: playerTokenScope,
          expiresAt: playerTokenExpiresAt,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: [twitchPlayerTokens.userId],
          set: {
            accessToken: tokenJson.access_token,
            refreshToken: tokenJson.refresh_token,
            scope: playerTokenScope,
            expiresAt: playerTokenExpiresAt,
            updatedAt: now
          }
        });

      return currentUser;
    });

    if (!user) {
      request.log.error('OAuth callback transaction completed without user row');
      return reply.code(500).send({ message: 'Authentication failed' });
    }

    const sessionToken = randomBytes(32).toString('hex');
    await db.insert(sessions).values({ userId: user.id, sessionTokenHash: createHash('sha256').update(`${sessionToken}:${config.SESSION_SECRET}`).digest('hex'), expiresAt });

    reply.header('Set-Cookie', [
      `${SESSION_COOKIE_NAME}=${sessionToken}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_DAYS * ONE_DAY_SECONDS}; SameSite=Lax${isProduction ? '; Secure' : ''}`,
      `eh_oauth_state=deleted; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${isProduction ? '; Secure' : ''}`
    ]);

    return reply.redirect('/');
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = parseCookie(request, SESSION_COOKIE_NAME);
    if (token) {
      const hashed = createHash('sha256').update(`${token}:${config.SESSION_SECRET}`).digest('hex');
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.sessionTokenHash, hashed));
    }
    reply.header('Set-Cookie', `${SESSION_COOKIE_NAME}=deleted; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${isProduction ? '; Secure' : ''}`);
    return reply.code(204).send();
  });


  app.get('/api/me/subscription', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return reply.code(401).send({ authenticated: false, isSubscriber: null, requiresReauth: true });

    const token = await getPlayerAccessToken(identity.userId);
    if (!token.accessToken) {
      return {
        authenticated: true,
        isSubscriber: null,
        requiresReauth: token.requiresReauth,
        source: 'twitch_user_oauth'
      };
    }

    const query = new URLSearchParams({
      broadcaster_id: config.TWITCH_BROADCASTER_ID,
      user_id: identity.twitchUserId
    });
    const subscriptionResponse = await fetch(`https://api.twitch.tv/helix/subscriptions/user?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Client-Id': config.TWITCH_CLIENT_ID
      }
    });

    if (subscriptionResponse.status === 404) {
      await db.update(users).set({ isSubscriber: false, subscriberEndsAt: null, updatedAt: new Date() }).where(eq(users.id, identity.userId));
      return { authenticated: true, isSubscriber: false, requiresReauth: false, source: 'twitch_user_oauth' };
    }

    if (subscriptionResponse.status === 401 || subscriptionResponse.status === 403) {
      request.log.warn({ statusCode: subscriptionResponse.status }, 'Twitch subscription status check requires player reauthorization');
      return { authenticated: true, isSubscriber: null, requiresReauth: true, source: 'twitch_user_oauth' };
    }

    if (!subscriptionResponse.ok) {
      request.log.warn({ statusCode: subscriptionResponse.status }, 'Twitch subscription status check failed');
      return reply.code(502).send({ message: 'Subscription status check failed' });
    }

    const payload = (await subscriptionResponse.json()) as TwitchSubscriptionUserResponse;
    const subscription = payload.data?.[0] ?? null;
    await db.update(users).set({ isSubscriber: Boolean(subscription), subscriberEndsAt: null, updatedAt: new Date() }).where(eq(users.id, identity.userId));

    return {
      authenticated: true,
      isSubscriber: Boolean(subscription),
      requiresReauth: false,
      source: 'twitch_user_oauth',
      subscription: subscription
        ? {
            tier: subscription.tier,
            isGift: subscription.is_gift,
            broadcasterId: subscription.broadcaster_id,
            broadcasterLogin: subscription.broadcaster_login,
            broadcasterName: subscription.broadcaster_name
          }
        : null
    };
  });

  app.get('/api/me', async (request) => {
    const identity = await getSessionIdentity(request);
    if (!identity) return { authenticated: false };

    const userRows = await db.select().from(users).where(eq(users.id, identity.userId)).limit(1);
    const currentUser = userRows[0];
    if (!currentUser) return { authenticated: false };

    return {
      authenticated: true,
      user: {
        twitchUserId: currentUser.twitchUserId,
        login: currentUser.twitchLogin,
        displayName: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl
      },
      roles: identity.roles,
      isAdmin: identity.roles.some(isAdminRole)
    };
  });
}

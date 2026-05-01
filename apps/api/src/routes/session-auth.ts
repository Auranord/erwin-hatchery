import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { roles, sessions, users } from '../db/schema.js';

const SESSION_COOKIE_NAME = 'eh_session';

function hashToken(token: string): string {
  return createHash('sha256').update(`${token}:${config.SESSION_SECRET}`).digest('hex');
}

function parseCookie(request: FastifyRequest, name: string): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  const entry = raw.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.split('=').slice(1).join('=')) : null;
}

export type SessionIdentity = {
  userId: string;
  twitchUserId: string;
  displayName: string | null;
  login: string | null;
  roles: string[];
};

export async function getSessionIdentity(request: FastifyRequest): Promise<SessionIdentity | null> {
  const token = parseCookie(request, SESSION_COOKIE_NAME);
  if (!token) return null;

  const activeSession = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.sessionTokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), isNull(sessions.revokedAt)))
    .limit(1);

  const session = activeSession[0];
  if (!session) return null;

  const userRows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const roleRows = await db.select({ role: roles.role }).from(roles).where(eq(roles.userId, session.userId));
  const user = userRows[0];
  if (!user) return null;

  return {
    userId: user.id,
    twitchUserId: user.twitchUserId,
    displayName: user.displayName,
    login: user.twitchLogin,
    roles: roleRows.map((x) => x.role)
  };
}

export function isAdminRole(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

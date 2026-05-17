import type { FastifyInstance } from 'fastify';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { userReports } from '../db/schema.js';
import { getSessionIdentity } from './session-auth.js';

const reportCategorySchema = z.enum(['bug', 'feedback']);

const clientContextSchema = z
  .object({
    userAgent: z.string().max(300).optional(),
    viewport: z
      .object({
        width: z.number().int().min(0).max(10000).optional(),
        height: z.number().int().min(0).max(10000).optional()
      })
      .optional(),
    currentPath: z.string().max(300).optional(),
    language: z.string().max(40).optional(),
    timestamp: z.string().max(80).optional()
  })
  .strict();

const userReportSchema = z.object({
  category: reportCategorySchema,
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(4000),
  currentPath: z.string().trim().max(300).optional(),
  clientContext: clientContextSchema.optional()
});

type ClientContextInput = z.infer<typeof clientContextSchema>;

type SafeClientContext = {
  userAgentSummary?: string;
  viewport?: { width?: number; height?: number };
  currentPath?: string;
  language?: string;
  clientTimestamp?: string;
};

const MIN_REPORT_INTERVAL_MS = 60 * 1000;
const MAX_REPORTS_PER_HOUR = 5;

function summarizeUserAgent(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 300);
}

function buildSafeClientContext(
  input: ClientContextInput | undefined,
  headerUserAgent: string | undefined,
  currentPath: string | undefined
): SafeClientContext {
  const safeContext: SafeClientContext = {};
  const userAgentSummary = summarizeUserAgent(input?.userAgent ?? headerUserAgent);
  if (userAgentSummary) safeContext.userAgentSummary = userAgentSummary;
  if (input?.viewport) safeContext.viewport = input.viewport;
  if (currentPath ?? input?.currentPath) {
    safeContext.currentPath = currentPath ?? input?.currentPath;
  }
  if (input?.language) safeContext.language = input.language;
  if (input?.timestamp) safeContext.clientTimestamp = input.timestamp;
  return safeContext;
}

async function enforceReportRateLimit(twitchUserId: string): Promise<boolean> {
  const now = Date.now();
  const recentCutoff = new Date(now - MIN_REPORT_INTERVAL_MS);
  const hourlyCutoff = new Date(now - 60 * 60 * 1000);

  const [recent] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userReports)
    .where(
      and(
        eq(userReports.reporterTwitchUserId, twitchUserId),
        gt(userReports.createdAt, recentCutoff)
      )
    );

  if ((recent?.count ?? 0) > 0) return false;

  const [hourly] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userReports)
    .where(
      and(
        eq(userReports.reporterTwitchUserId, twitchUserId),
        gt(userReports.createdAt, hourlyCutoff)
      )
    );

  return (hourly?.count ?? 0) < MAX_REPORTS_PER_HOUR;
}

export function registerUserReportRoutes(app: FastifyInstance) {
  app.post('/api/user-reports', async (request, reply) => {
    const identity = await getSessionIdentity(request);
    if (!identity) {
      return reply.code(401).send({
        ok: false,
        message: 'Bitte melde dich zuerst mit Twitch an.'
      });
    }

    const parsed = userReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        message: 'Bitte prüfe deine Eingaben und versuche es erneut.'
      });
    }

    const allowed = await enforceReportRateLimit(identity.twitchUserId);
    if (!allowed) {
      return reply.code(429).send({
        ok: false,
        message: 'Bitte warte kurz, bevor du eine weitere Meldung sendest.'
      });
    }

    const headerUserAgent =
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : undefined;
    const safeClientContext = buildSafeClientContext(
      parsed.data.clientContext,
      headerUserAgent,
      parsed.data.currentPath
    );

    await db.insert(userReports).values({
      reporterUserId: identity.userId,
      reporterTwitchUserId: identity.twitchUserId,
      reporterDisplayNameSnapshot: identity.displayName ?? identity.login,
      category: parsed.data.category,
      title: parsed.data.title,
      message: parsed.data.message,
      currentPath: parsed.data.currentPath,
      clientContext: safeClientContext
    });

    return reply.code(201).send({
      ok: true,
      message: 'Danke! Deine Meldung wurde gespeichert.'
    });
  });
}

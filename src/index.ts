import type { AuthContext, BetterAuthPlugin, Session, User } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, getIP, getSessionFromCtx } from "better-auth/api";
import { EVENT_MODEL, STEP_UP_FIELD } from "better-auth-shield";
import { z } from "zod";
import { can, READ, type Permission } from "./access.js";
import { ERROR_CODES } from "./error-codes.js";
import { listEvents, overview, userDetail, userList, USER_FILTERS } from "./queries.js";
import { page } from "./page.js";

export interface ConsoleOptions {
  /** Where the console is served, under Better Auth's base path. Defaults to `/console`. */
  path?: string;
  /**
   * Seconds a step-up (shield's `/shield/step-up`) keeps the console open.
   * Defaults to 1800. `false` skips step-up: anyone holding an admin's
   * session cookie then has the console.
   */
  stepUp?: { maxAge?: number } | false;
  /** Where to send someone who opens the console signed out. Gets `?callbackURL=`. */
  signInURL?: string;
}

const PERMISSIONS = {
  revoke: { session: ["revoke"] },
  ban: { user: ["ban"] },
  update: { user: ["update"] },
} satisfies Record<string, Permission>;

export { ERROR_CODES };

const noStore = { "Cache-Control": "no-store" };

type SessionData = { session: Session & Record<string, unknown>; user: User & Record<string, unknown> };

export function console(options: ConsoleOptions = {}) {
  const base = (options.path ?? "/console").replace(/\/+$/, "");
  if (!/^\/[a-z0-9/_-]*$/i.test(base)) throw new Error("better-auth-console: `path` must start with / and use only letters, digits, -, _ and /.");
  const stepUpMaxAge = options.stepUp === false ? null : (options.stepUp?.maxAge ?? 1800);
  if (stepUpMaxAge !== null && !(Number.isInteger(stepUpMaxAge) && stepUpMaxAge > 0)) {
    throw new Error("better-auth-console: `stepUp.maxAge` must be a positive whole number of seconds.");
  }

  /** When the session last proved it's the user: shield's step-up, or the sign-in. */
  const provenAt = (session: Record<string, unknown>) =>
    Math.max(new Date((session[STEP_UP_FIELD] as string | Date | null) ?? 0).getTime(), new Date(session.createdAt as Date).getTime());

  async function steppedUp(ctx: AuthContext, session: SessionData["session"]) {
    if (stepUpMaxAge === null) return true;
    const since = Date.now() - stepUpMaxAge * 1000;
    if (provenAt(session) >= since) return true;
    // A cookie cache can predate the step-up; the stored session has it.
    const stored = (await ctx.internalAdapter.findSession(session.token))?.session;
    return !!stored && provenAt(stored as never) >= since;
  }

  /** Signed in, allowed by the admin plugin, and (unless `fresh` is false) stepped up. */
  const gate = (permission: Permission, fresh = true) =>
    createAuthMiddleware(async (ctx) => {
      const data = (await getSessionFromCtx(ctx).catch(() => null)) as SessionData | null;
      if (!data) throw new APIError("UNAUTHORIZED");
      // 404, not 403: the console doesn't confirm it exists to non-admins.
      if (!can(ctx.context, data.user, permission)) throw new APIError("NOT_FOUND", ERROR_CODES.NOT_FOUND);
      if (fresh && !(await steppedUp(ctx.context, data.session))) {
        throw new APIError("FORBIDDEN", ERROR_CODES.STEP_UP_REQUIRED);
      }
      ctx.setHeader("Cache-Control", "no-store");
      return { console: data };
    });

  const shieldOf = (ctx: AuthContext) =>
    ctx.getPlugin("shield") as unknown as { endpoints: Record<string, (input: object) => Promise<unknown>> } | null;

  /** Records a console action in shield's event log, against the user it targeted. */
  async function audit(ctx: AuthContext, headers: Headers | undefined, actor: SessionData, type: string, userId: string, metadata: object = {}) {
    await ctx.adapter.create({
      model: EVENT_MODEL,
      data: {
        type: `console.${type}`,
        userId,
        identifierHash: null,
        ip: (headers && getIP(headers, ctx.options)) || null,
        userAgent: headers?.get("user-agent")?.slice(0, 512) ?? null,
        metadata: JSON.stringify({ actorId: actor.user.id, ...metadata }),
        createdAt: new Date(),
      },
    });
  }

  async function target(ctx: AuthContext, actor: SessionData, userId: string, self = false) {
    if (!self && userId === actor.user.id) throw new APIError("BAD_REQUEST", ERROR_CODES.CANNOT_TARGET_SELF);
    const user = await ctx.internalAdapter.findUserById(userId);
    if (!user) throw new APIError("NOT_FOUND", ERROR_CODES.NOT_FOUND);
    return user as User & Record<string, unknown>;
  }

  const userBody = z.object({ userId: z.string().min(1).max(255) });
  const action = { method: "POST" as const, metadata: { isAction: false, scope: "server" as const } };
  const read = { method: "GET" as const, metadata: { isAction: false, scope: "server" as const } };

  return {
    id: "console",
    init(ctx) {
      if (!ctx.hasPlugin("admin"))
        throw new Error("better-auth-console: add Better Auth's admin() plugin; the console uses its roles and ban fields.");
      if (!ctx.hasPlugin("shield")) throw new Error("better-auth-console: add shield() from better-auth-shield; the console reads its event log.");
      if (!ctx.tables[EVENT_MODEL]) throw new Error("better-auth-console: shield's securityEvent table is missing; update better-auth-shield.");
      if (stepUpMaxAge !== null && !ctx.tables.session?.fields[STEP_UP_FIELD]) {
        throw new Error(
          "better-auth-console: set shield({ stepUp: {} }) so admins confirm it's them before the console opens, or pass console({ stepUp: false }).",
        );
      }
    },
    endpoints: {
      consolePage: createAuthEndpoint(base, read, async (ctx) => {
        const data = (await getSessionFromCtx(ctx).catch(() => null)) as SessionData | null;
        const self = new URL(ctx.request?.url ?? `${ctx.context.baseURL}${base}`);
        if (!data) {
          if (options.signInURL) {
            const to = new URL(options.signInURL, self);
            to.searchParams.set("callbackURL", self.pathname);
            return new Response(null, { status: 302, headers: { Location: to.toString(), ...noStore } });
          }
          return new Response("Sign in as an admin, then open this page again.", {
            status: 401,
            headers: { "Content-Type": "text/plain; charset=utf-8", ...noStore },
          });
        }
        if (!can(ctx.context, data.user, READ))
          return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain", ...noStore } });
        return page(new URL(ctx.context.baseURL).pathname.replace(/\/+$/, ""), base);
      }),

      consoleMe: createAuthEndpoint(`${base}/api/me`, { ...read, use: [gate(READ, false)] }, async (ctx) => {
        const { session, user } = ctx.context.console;
        const fields = ctx.context.tables.user?.fields ?? {};
        return ctx.json({
          user: { id: user.id, name: user.name, email: user.email, role: user.role ?? null },
          steppedUp: await steppedUp(ctx.context, session),
          stepUp: stepUpMaxAge === null ? null : { maxAge: stepUpMaxAge, provenAt: new Date(provenAt(session)).toISOString() },
          can: Object.fromEntries(Object.entries(PERMISSIONS).map(([name, p]) => [name, can(ctx.context, user, p)])),
          features: {
            twoFactor: ctx.context.hasPlugin("two-factor"),
            twoFactorEnabled: user.twoFactorEnabled === true,
            username: "username" in fields,
            phoneNumber: "phoneNumber" in fields,
            passwordPolicy: "passwordChangeRequired" in fields,
            requiredTwoFactor: "twoFactorDueAt" in fields,
          },
          filters: USER_FILTERS.filter((f) => f.available(fields)).map((f) => f.id),
        });
      }),

      consoleOverview: createAuthEndpoint(`${base}/api/overview`, { ...read, use: [gate(READ)] }, async (ctx) =>
        ctx.json(await overview(ctx.context)),
      ),

      consoleUsers: createAuthEndpoint(
        `${base}/api/users`,
        {
          ...read,
          use: [gate(READ)],
          query: z.object({
            q: z.string().max(320).optional(),
            filter: z.string().max(64).optional(),
            offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
            limit: z.coerce.number().int().min(1).max(100).optional(),
          }),
        },
        async (ctx) => ctx.json(await userList(ctx.context, ctx.query)),
      ),

      consoleUser: createAuthEndpoint(`${base}/api/user`, { ...read, use: [gate(READ)], query: userBody }, async (ctx) => {
        const detail = await userDetail(ctx.context, ctx.query.userId, ctx.context.console.session.id);
        if (!detail) throw new APIError("NOT_FOUND", ERROR_CODES.NOT_FOUND);
        return ctx.json(detail);
      }),

      consoleEvents: createAuthEndpoint(
        `${base}/api/events`,
        {
          ...read,
          use: [gate(READ)],
          query: z.object({
            type: z.string().max(64).optional(),
            userId: z.string().max(255).optional(),
            ip: z.string().max(64).optional(),
            identifier: z.string().max(320).optional(),
            before: z.string().datetime().optional(),
            limit: z.coerce.number().int().min(1).max(200).optional(),
          }),
        },
        async (ctx) => ctx.json(await listEvents(ctx.context, ctx.query)),
      ),

      consoleRevokeSessions: createAuthEndpoint(
        `${base}/api/revoke-sessions`,
        { ...action, use: [gate(PERMISSIONS.revoke)], body: userBody.extend({ sessionId: z.string().min(1).max(255).optional() }) },
        async (ctx) => {
          const actor = ctx.context.console;
          const { userId, sessionId } = ctx.body;
          // Revoking your own other sessions is fine; your current one is what sign-out is for.
          await target(ctx.context, actor, userId, true);
          const sessions = await ctx.context.internalAdapter.listSessions(userId);
          const chosen = sessions.filter((s) => (sessionId ? s.id === sessionId : s.id !== actor.session.id));
          if (sessionId && !chosen.length) throw new APIError("NOT_FOUND", ERROR_CODES.NOT_FOUND);
          if (sessionId === actor.session.id) throw new APIError("BAD_REQUEST", ERROR_CODES.CANNOT_TARGET_SELF);
          if (chosen.length) await ctx.context.internalAdapter.deleteSessions(chosen.map((s) => s.token));
          await audit(ctx.context, ctx.headers, actor, "sessions_revoked", userId, { count: chosen.length, ...(sessionId ? { sessionId } : {}) });
          return ctx.json({ revoked: chosen.length });
        },
      ),

      consoleBan: createAuthEndpoint(
        `${base}/api/ban`,
        {
          ...action,
          use: [gate(PERMISSIONS.ban)],
          body: userBody.extend({
            reason: z.string().max(500).optional(),
            expiresIn: z
              .number()
              .int()
              .positive()
              .max(10 * 365 * 86400)
              .optional(),
          }),
        },
        async (ctx) => {
          const actor = ctx.context.console;
          const { userId, reason, expiresIn } = ctx.body;
          await target(ctx.context, actor, userId);
          const banExpires = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
          await ctx.context.internalAdapter.updateUser(userId, { banned: true, banReason: reason || null, banExpires });
          await ctx.context.internalAdapter.deleteUserSessions(userId);
          await audit(ctx.context, ctx.headers, actor, "banned", userId, { reason: reason || null, expires: banExpires?.toISOString() ?? null });
          return ctx.json({ success: true });
        },
      ),

      consoleUnban: createAuthEndpoint(`${base}/api/unban`, { ...action, use: [gate(PERMISSIONS.ban)], body: userBody }, async (ctx) => {
        const actor = ctx.context.console;
        await target(ctx.context, actor, ctx.body.userId);
        await ctx.context.internalAdapter.updateUser(ctx.body.userId, { banned: false, banReason: null, banExpires: null });
        await audit(ctx.context, ctx.headers, actor, "unbanned", ctx.body.userId);
        return ctx.json({ success: true });
      }),

      consoleUnlock: createAuthEndpoint(`${base}/api/unlock`, { ...action, use: [gate(PERMISSIONS.update)], body: userBody }, async (ctx) => {
        const actor = ctx.context.console;
        const user = await target(ctx.context, actor, ctx.body.userId, true);
        const shield = shieldOf(ctx.context)!;
        const identifiers = [user.email, user.username, user.phoneNumber].filter((v): v is string => typeof v === "string" && !!v);
        await shield.endpoints.shieldUnlock!({ ...ctx, body: { userId: user.id } });
        for (const identifier of identifiers) await shield.endpoints.shieldUnlock!({ ...ctx, body: { identifier } });
        // Better Auth's own lock on second-factor codes.
        const twoFactor = ctx.context.tables.twoFactor?.fields;
        if (twoFactor?.lockedUntil) {
          await ctx.context.adapter.updateMany({
            model: "twoFactor",
            where: [{ field: "userId", value: user.id }],
            update: { lockedUntil: null, ...(twoFactor.failedVerificationCount ? { failedVerificationCount: 0 } : {}) },
          });
        }
        await audit(ctx.context, ctx.headers, actor, "unlocked", user.id);
        return ctx.json({ success: true });
      }),

      consoleRequirePasswordChange: createAuthEndpoint(
        `${base}/api/require-password-change`,
        { ...action, use: [gate(PERMISSIONS.update)], body: userBody },
        async (ctx) => {
          const actor = ctx.context.console;
          if (!ctx.context.tables.user?.fields.passwordChangeRequired) {
            throw new APIError("BAD_REQUEST", ERROR_CODES.FEATURE_UNAVAILABLE);
          }
          await target(ctx.context, actor, ctx.body.userId);
          await shieldOf(ctx.context)!.endpoints.shieldRequirePasswordChange!({ ...ctx, body: { userId: ctx.body.userId } });
          await audit(ctx.context, ctx.headers, actor, "password_change_required", ctx.body.userId);
          return ctx.json({ success: true });
        },
      ),
    },
    $ERROR_CODES: ERROR_CODES,
  } satisfies BetterAuthPlugin;
}

export { console as betterAuthConsole };

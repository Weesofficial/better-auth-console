import type { AuthContext } from "better-auth";
import { APIError } from "better-auth/api";
import { EVENT_MODEL, hashIdentifier, normalizeIdentifier, STEP_UP_FIELD } from "better-auth-shield";
import { ERROR_CODES } from "./error-codes.js";

type Where = NonNullable<Parameters<AuthContext["adapter"]["findMany"]>[0]["where"]>;
type Fields = Record<string, unknown>;
type Row = Record<string, unknown>;

const DAY = 86_400_000;

/** User list filters; each needs the field it reads. */
export const USER_FILTERS: { id: string; available: (fields: Fields) => boolean; where: Where }[] = [
  { id: "banned", available: (f) => "banned" in f, where: [{ field: "banned", value: true }] },
  { id: "unverified", available: () => true, where: [{ field: "emailVerified", value: false }] },
  { id: "no2fa", available: (f) => "twoFactorEnabled" in f, where: [{ field: "twoFactorEnabled", value: false }] },
  { id: "passwordChangeRequired", available: (f) => "passwordChangeRequired" in f, where: [{ field: "passwordChangeRequired", value: true }] },
];

const USER_FIELDS = [
  "id",
  "name",
  "email",
  "emailVerified",
  "image",
  "createdAt",
  "updatedAt",
  "role",
  "banned",
  "banReason",
  "banExpires",
  "username",
  "displayUsername",
  "phoneNumber",
  "phoneNumberVerified",
  "twoFactorEnabled",
  "passwordChangeRequired",
  "twoFactorDueAt",
] as const;

/** Only the fields the console shows: never tokens, hashes or app-specific columns. */
const pick = (row: Row, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k] ?? null]));

const userFields = (ctx: AuthContext) => (ctx.tables.user?.fields ?? {}) as Fields;

export function eventOut(row: Row) {
  let metadata: unknown = null;
  try {
    metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? null);
  } catch {
    metadata = null;
  }
  return {
    id: row.id as string,
    type: row.type as string,
    userId: (row.userId as string | null) ?? null,
    identifierHash: (row.identifierHash as string | null) ?? null,
    ip: (row.ip as string | null) ?? null,
    userAgent: (row.userAgent as string | null) ?? null,
    metadata: metadata as Record<string, unknown> | null,
    createdAt: new Date(row.createdAt as Date).toISOString(),
  };
}

export type EventOut = ReturnType<typeof eventOut>;

const count = (ctx: AuthContext, model: string, where: Where = []) => ctx.adapter.count({ model, where });

/** Sessions only in secondary storage can't be counted. */
const sessionsInDatabase = (ctx: AuthContext) => !ctx.options.secondaryStorage || !!ctx.options.session?.storeSessionInDatabase;

export async function overview(ctx: AuthContext) {
  const now = Date.now();
  const fields = userFields(ctx);
  const today = Math.floor(now / DAY) * DAY;
  const days = Array.from({ length: 14 }, (_, i) => today - (13 - i) * DAY);
  const since = (ms: number) => ({ field: "createdAt", operator: "gte" as const, value: new Date(ms) });
  const perDay = (type: string) =>
    Promise.all(
      days.map((start) =>
        count(ctx, EVENT_MODEL, [{ field: "type", value: type }, since(start), { field: "createdAt", operator: "lt", value: new Date(start + DAY) }]),
      ),
    );

  const [users, newUsers, sessions, twoFactor, banned, success, failure, lockouts, sendLimited, recent] = await Promise.all([
    count(ctx, "user"),
    count(ctx, "user", [since(now - 7 * DAY)]),
    sessionsInDatabase(ctx) ? count(ctx, "session", [{ field: "expiresAt", operator: "gt", value: new Date(now) }]) : null,
    "twoFactorEnabled" in fields ? count(ctx, "user", [{ field: "twoFactorEnabled", value: true }]) : null,
    "banned" in fields ? count(ctx, "user", [{ field: "banned", value: true }]) : null,
    perDay("sign_in.success"),
    perDay("sign_in.failure"),
    count(ctx, EVENT_MODEL, [{ field: "type", value: "lockout" }, since(now - DAY)]),
    count(ctx, EVENT_MODEL, [{ field: "type", value: "send.limited" }, since(now - DAY)]),
    ctx.adapter.findMany<Row>({ model: EVENT_MODEL, sortBy: { field: "createdAt", direction: "desc" }, limit: 12 }),
  ]);

  return {
    users,
    newUsers,
    activeSessions: sessions,
    twoFactorUsers: twoFactor,
    bannedUsers: banned,
    signIns: days.map((start, i) => ({ day: new Date(start).toISOString().slice(0, 10), success: success[i]!, failure: failure[i]! })),
    lockouts24h: lockouts,
    sendLimited24h: sendLimited,
    recent: recent.map(eventOut),
  };
}

export async function userList(ctx: AuthContext, query: { q?: string; filter?: string; offset?: number; limit?: number }) {
  const fields = userFields(ctx);
  const where: Where = [];
  const q = query.q?.trim().toLowerCase();
  if (q) {
    // OR clauses first: adapters group them differently from ANDs, and this order reads the same in all.
    for (const field of ["email", "name", "username", "phoneNumber"]) {
      if (field in fields) where.push({ field, operator: "contains", value: q, mode: "insensitive", connector: "OR" });
    }
    where.push({ field: "id", value: query.q!.trim(), connector: "OR" });
  }
  if (query.filter) {
    const filter = USER_FILTERS.find((f) => f.id === query.filter && f.available(fields));
    // Ignoring it would show everyone under a filter's name.
    if (!filter) throw new APIError("BAD_REQUEST", ERROR_CODES.UNKNOWN_FILTER);
    where.push(...filter.where);
  }
  const limit = query.limit ?? 25;
  const [users, total] = await Promise.all([
    ctx.internalAdapter.listUsers(limit, query.offset ?? 0, { field: "createdAt", direction: "desc" }, where),
    ctx.internalAdapter.countTotalUsers(where),
  ]);
  return {
    users: users.map((u) =>
      pick(u as Row, [
        "id",
        "name",
        "email",
        "emailVerified",
        "image",
        "createdAt",
        "role",
        "banned",
        "username",
        "twoFactorEnabled",
        "passwordChangeRequired",
      ]),
    ),
    total,
  };
}

/** HMACs of every identifier the user signs in with, as shield keys its counters and events. */
async function identifierHashes(ctx: AuthContext, user: Row) {
  const forms = [
    normalizeIdentifier("email", user.email),
    normalizeIdentifier("username", user.username),
    normalizeIdentifier("phoneNumber", user.phoneNumber),
  ].filter((v): v is string => !!v);
  return Promise.all([...new Set(forms)].map((id) => hashIdentifier(ctx.secret, id)));
}

/** Events about a user: by id, or by an identifier they sign in with. */
const aboutUser = (userId: string, hashes: string[]): Where => [
  { field: "userId", value: userId, connector: "OR" },
  ...(hashes.length ? [{ field: "identifierHash", operator: "in" as const, value: hashes, connector: "OR" as const }] : []),
];

export interface Lock {
  scope: string;
  until: string;
  since: string;
}

/** Locks still in force: a lockout event not yet over, with no unlock after it. */
async function activeLocks(ctx: AuthContext, userId: string, hashes: string[]): Promise<Lock[]> {
  const now = Date.now();
  const about = aboutUser(userId, hashes);
  const [lockouts, unlocks] = await Promise.all([
    ctx.adapter.findMany<Row>({
      model: EVENT_MODEL,
      where: [...about, { field: "type", value: "lockout" }],
      sortBy: { field: "createdAt", direction: "desc" },
      limit: 100,
    }),
    ctx.adapter.findMany<Row>({
      model: EVENT_MODEL,
      where: [...about, { field: "type", value: "unlock" }],
      sortBy: { field: "createdAt", direction: "desc" },
      limit: 100,
    }),
  ]);
  const locks = new Map<string, Lock>();
  for (const row of lockouts.map(eventOut)) {
    const scope = String(row.metadata?.scope ?? "ip");
    const until = String(row.metadata?.until ?? "");
    if (!(new Date(until).getTime() > now)) continue;
    // Better Auth keeps its own two-factor lock; that row is the truth for it.
    if (scope === "two_factor") continue;
    const lifted = unlocks.some((u) => {
      const at = new Date(u.createdAt as Date).getTime();
      if (at < new Date(row.createdAt).getTime()) return false;
      return scope === "step_up" ? u.userId === userId : u.identifierHash === row.identifierHash;
    });
    if (lifted) continue;
    const key = `${scope}:${row.identifierHash ?? ""}`;
    if (!locks.has(key)) locks.set(key, { scope, until, since: row.createdAt });
  }
  if (ctx.tables.twoFactor?.fields.lockedUntil) {
    const row = await ctx.adapter.findOne<Row>({ model: "twoFactor", where: [{ field: "userId", value: userId }] });
    const until = row?.lockedUntil ? new Date(row.lockedUntil as Date) : null;
    if (until && until.getTime() > now) locks.set("two_factor", { scope: "two_factor", until: until.toISOString(), since: until.toISOString() });
  }
  return [...locks.values()];
}

export async function userDetail(ctx: AuthContext, userId: string, currentSessionId: string) {
  const user = (await ctx.internalAdapter.findUserById(userId)) as Row | null;
  if (!user) return null;
  const hashes = await identifierHashes(ctx, user);
  const [accounts, sessions, events, locks] = await Promise.all([
    ctx.internalAdapter.findAccounts(userId),
    ctx.internalAdapter.listSessions(userId),
    ctx.adapter.findMany<Row>({ model: EVENT_MODEL, where: aboutUser(userId, hashes), sortBy: { field: "createdAt", direction: "desc" }, limit: 50 }),
    activeLocks(ctx, userId, hashes),
  ]);

  const now = Date.now();
  const reasons: { code: string; detail?: string }[] = [];
  const banExpires = user.banExpires ? new Date(user.banExpires as Date).getTime() : null;
  if (user.banned === true && (banExpires === null || banExpires > now)) {
    reasons.push({ code: "banned", detail: (user.banReason as string | null) ?? undefined });
  }
  for (const lock of locks) reasons.push({ code: "locked", detail: `${lock.scope} until ${lock.until}` });
  if (ctx.options.emailAndPassword?.requireEmailVerification && user.emailVerified !== true) reasons.push({ code: "email_unverified" });
  if (user.passwordChangeRequired === true) reasons.push({ code: "password_change_required" });
  const dueAt = user.twoFactorDueAt ? new Date(user.twoFactorDueAt as Date).getTime() : null;
  if (dueAt !== null && dueAt <= now && user.twoFactorEnabled !== true) reasons.push({ code: "two_factor_overdue" });
  if (!accounts.length) reasons.push({ code: "no_login_method" });
  else if (!accounts.some((a) => a.providerId === "credential")) reasons.push({ code: "no_password" });

  return {
    user: pick(user, USER_FIELDS),
    accounts: accounts.map((a) => pick(a as Row, ["id", "providerId", "accountId", "createdAt"])),
    sessions: sessions
      .map((s) => ({
        ...pick(s as Row, ["id", "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent", "impersonatedBy", STEP_UP_FIELD]),
        current: s.id === currentSessionId,
      }))
      .sort((a, b) => new Date((b as Row).updatedAt as Date).getTime() - new Date((a as Row).updatedAt as Date).getTime()),
    events: events.map(eventOut),
    locks,
    reasons,
  };
}

export async function listEvents(
  ctx: AuthContext,
  query: { type?: string; userId?: string; ip?: string; identifier?: string; before?: string; limit?: number },
) {
  const where: Where = [];
  if (query.type) {
    // `sign_in.` matches every sign-in event.
    where.push(query.type.endsWith(".") ? { field: "type", operator: "starts_with", value: query.type } : { field: "type", value: query.type });
  }
  if (query.userId) where.push({ field: "userId", value: query.userId });
  if (query.ip) where.push({ field: "ip", value: query.ip });
  if (query.identifier) {
    const raw = query.identifier;
    const forms = new Set([normalizeIdentifier("email", raw), normalizeIdentifier("phoneNumber", raw)].filter((v): v is string => !!v));
    const hashes = await Promise.all([...forms].map((id) => hashIdentifier(ctx.secret, id)));
    where.push({ field: "identifierHash", operator: "in", value: hashes });
  }
  if (query.before) where.push({ field: "createdAt", operator: "lt", value: new Date(query.before) });
  const limit = query.limit ?? 50;
  const rows = await ctx.adapter.findMany<Row>({ model: EVENT_MODEL, where, sortBy: { field: "createdAt", direction: "desc" }, limit });
  const events = rows.map(eventOut);
  return { events, next: events.length === limit ? events.at(-1)!.createdAt : null };
}

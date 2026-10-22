import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { getMigrations } from "better-auth/db/migration";
import { admin, twoFactor, username } from "better-auth/plugins";
import { shield, type ShieldOptions } from "better-auth-shield";
import { DatabaseSync } from "node:sqlite";
import { console as betterAuthConsole, type ConsoleOptions } from "../src/index.js";

export const PASSWORD = "correct-horse-battery";
export const ADMIN = "root@example.com";
export const TARGET = "ada@example.com";
const ORIGIN = "http://localhost:3000";

export const DATABASES = ["memory", "sqlite"] as const;

/**
 * A real Better Auth app with username, admin, twoFactor, shield and the
 * console, over the memory adapter or a migrated in-memory SQLite database.
 */
export async function setup({
  database = "memory",
  console: consoleOptions = {},
  shield: shieldOptions = { stepUp: {}, password: {}, lockout: { maxAttempts: 2 } },
  plugins,
  auth: overrides = {},
}: {
  database?: (typeof DATABASES)[number];
  console?: ConsoleOptions;
  shield?: ShieldOptions;
  plugins?: BetterAuthPlugin[];
  auth?: Partial<BetterAuthOptions>;
} = {}) {
  const config = {
    secret: "test-secret-0123456789-abcdefghijklmnop",
    baseURL: ORIGIN,
    database:
      database === "sqlite"
        ? new DatabaseSync(":memory:")
        : memoryAdapter({
            user: [],
            session: [],
            account: [],
            verification: [],
            shieldCounter: [],
            securityEvent: [],
            twoFactor: [],
            passwordHistory: [],
          }),
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    logger: { disabled: true },
    plugins: plugins ?? [username(), admin(), twoFactor(), shield(shieldOptions), betterAuthConsole(consoleOptions)],
    ...overrides,
  } satisfies BetterAuthOptions;
  if (database === "sqlite") await (await getMigrations(config)).runMigrations();
  return betterAuth(config);
}

export type Auth = Awaited<ReturnType<typeof setup>>;

export function call(
  auth: Auth,
  path: string,
  { body, cookie, query, ip = "203.0.113.7" }: { body?: unknown; cookie?: string; query?: Record<string, string | number>; ip?: string } = {},
) {
  const url = new URL(`${ORIGIN}/api/auth${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
  return auth.handler(
    new Request(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: ORIGIN,
        "x-forwarded-for": ip,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/** GET or POST one of the console's JSON endpoints. */
export const consoleApi = (auth: Auth, name: string, init: Parameters<typeof call>[2] = {}) => call(auth, `/console/api/${name}`, init);

export async function signIn(auth: Auth, email: string, password = PASSWORD, ip?: string) {
  const res = await call(auth, "/sign-in/email", { body: { email, password }, ip });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { res, cookie };
}

export async function signUp(auth: Auth, email: string, name: string, role?: string) {
  const { user } = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name, username: name } as never });
  const ctx = await auth.$context;
  // Sign-up signs the user in; start each test with no sessions.
  await ctx.internalAdapter.deleteUserSessions(user.id);
  if (role) await ctx.internalAdapter.updateUser(user.id, { role, emailVerified: true });
  return user;
}

/** An admin and an ordinary user, the admin signed in. */
export async function world(options: Parameters<typeof setup>[0] = {}) {
  const auth = await setup(options);
  const root = await signUp(auth, ADMIN, "root", "admin");
  const ada = await signUp(auth, TARGET, "ada_l");
  const { cookie } = await signIn(auth, ADMIN);
  return { auth, root, ada, cookie };
}

export async function json<T = any>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}

export async function events(auth: Auth, type?: string) {
  const ctx = await auth.$context;
  const rows = await ctx.adapter.findMany<{ type: string; userId: string | null; metadata: string | null }>({
    model: "securityEvent",
    where: type ? [{ field: "type", value: type }] : [],
  });
  return rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
}

/**
 * A sample app for working on the console: Better Auth over the memory adapter
 * with admin, twoFactor, username and shield, seeded with users and events.
 *
 *   npm run build:ui && npm run dev
 *
 * Then open http://localhost:3141 and sign in as root@example.com /
 * correct-horse-battery. Run `npm run build:ui` again after editing the UI.
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { toNodeHandler } from "better-auth/node";
import { admin, twoFactor, username } from "better-auth/plugins";
import { hashIdentifier, normalizeIdentifier, shield } from "better-auth-shield";
import { createServer } from "node:http";
import { console as betterAuthConsole } from "../src/index.js";

const PORT = Number(process.env.PORT) || 3141;
const ORIGIN = `http://localhost:${PORT}`;
const PASSWORD = "correct-horse-battery";

const auth = betterAuth({
  secret: "dev-secret-not-for-production-0123456789",
  baseURL: ORIGIN,
  database: memoryAdapter({
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
  plugins: [username(), admin(), twoFactor(), shield({ stepUp: {}, password: { history: 3 } }), betterAuthConsole({ signInURL: "/" })],
});

const SIGN_IN = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Sign in</title>
<style>body{font:15px system-ui;max-width:22rem;margin:15vh auto;padding:0 1rem}input,button{display:block;width:100%;box-sizing:border-box;margin:.4rem 0;padding:.55rem;font:inherit}</style>
<h1>Sample app</h1><p>Sign in to open the console.</p>
<form id=f><input name=email value="root@example.com"><input name=password type=password value="${PASSWORD}"><button>Sign in</button></form><p id=e></p>
<script>f.onsubmit=async e=>{e.preventDefault();const r=await fetch("/api/auth/sign-in/email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(f)))});
if(r.ok)location.href=new URLSearchParams(location.search).get("callbackURL")||"/api/auth/console";else document.getElementById("e").textContent=(await r.json()).message}</script>`;

async function seed() {
  const ctx = await auth.$context;
  const make = async (email: string, name: string, extra: Record<string, unknown> = {}) => {
    const { user } = await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name, username: email.split("@")[0]!.replace(/\W/g, "_") } as never,
    });
    if (Object.keys(extra).length) await ctx.internalAdapter.updateUser(user.id, extra);
    return user;
  };
  await make("root@example.com", "Root Admin", { role: "admin", emailVerified: true });
  const people = [
    "Ada Lovelace",
    "Grace Hopper",
    "Alan Turing",
    "Katherine Johnson",
    "Linus Torvalds",
    "Margaret Hamilton",
    "Dennis Ritchie",
    "Barbara Liskov",
    "Ken Thompson",
    "Radia Perlman",
    "Donald Knuth",
    "Frances Allen",
  ];
  const users = [];
  for (const [i, name] of people.entries()) {
    const email = `${name.split(" ")[0]!.toLowerCase()}@example.com`;
    users.push(await make(email, name, { emailVerified: i % 3 !== 0, twoFactorEnabled: i % 4 === 0 }));
  }
  await ctx.internalAdapter.updateUser(users[4]!.id, { banned: true, banReason: "Chargeback fraud", banExpires: null });
  await ctx.internalAdapter.updateUser(users[6]!.id, { passwordChangeRequired: true });

  // Real traffic: a lockout on Grace from one IP, and a few successful sign-ins.
  const signIn = (email: string, password: string, ip: string) =>
    auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-forwarded-for": ip,
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15",
        },
        body: JSON.stringify({ email, password }),
      }),
    );
  for (let i = 0; i < 6; i++) await signIn("grace@example.com", "guess-" + i, "198.51.100.23");
  for (const email of ["alan@example.com", "katherine@example.com", "margaret@example.com"]) await signIn(email, PASSWORD, "203.0.113.5");

  // Backdated history so the chart has two weeks to show.
  const day = 86_400_000;
  for (let d = 13; d >= 1; d--) {
    const ok = 8 + ((d * 7) % 11);
    const bad = (d * 5) % 7;
    for (let i = 0; i < ok + bad; i++) {
      const user = users[i % users.length]!;
      const failed = i >= ok;
      await ctx.adapter.create({
        model: "securityEvent",
        data: {
          type: failed ? "sign_in.failure" : "sign_in.success",
          userId: failed ? null : user.id,
          identifierHash: await hashIdentifier(ctx.secret, normalizeIdentifier("email", user.email)!),
          ip: `192.0.2.${(i * 13) % 250}`,
          userAgent:
            i % 2
              ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36"
              : "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1",
          metadata: JSON.stringify(failed ? { path: "/sign-in/email" } : { method: "password" }),
          createdAt: new Date(Date.now() - d * day - i * 600_000),
        },
      });
    }
  }
}

await seed();
const handler = toNodeHandler(auth);
createServer((req, res) => {
  if (req.url?.startsWith("/api/auth")) return handler(req, res);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SIGN_IN);
}).listen(PORT, () => process.stdout.write(`Sample app on ${ORIGIN} (root@example.com / ${PASSWORD})\n`));

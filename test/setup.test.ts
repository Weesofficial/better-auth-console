import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { admin, username } from "better-auth/plugins";
import { shield } from "better-auth-shield";
import { console as betterAuthConsole } from "../src/index.js";
import { ADMIN, call, consoleApi, json, setup, signIn, signUp, TARGET, world } from "./helpers.js";

describe("setup", () => {
  it("refuses a bad path or step-up age", () => {
    assert.throws(() => betterAuthConsole({ path: "console" }), /must start with \//);
    assert.throws(() => betterAuthConsole({ path: "/a b" }), /must start with \//);
    assert.throws(() => betterAuthConsole({ stepUp: { maxAge: 0 } }), /positive whole number/);
  });

  it("needs admin(), shield() and shield's step-up", async () => {
    const without = async (plugins: NonNullable<Parameters<typeof setup>[0]>["plugins"]) => (await setup({ plugins })).$context;
    await assert.rejects(without([shield({ stepUp: {} }), betterAuthConsole()]), /admin\(\)/);
    await assert.rejects(without([admin(), betterAuthConsole()]), /shield\(\)/);
    await assert.rejects(without([admin(), shield(), betterAuthConsole()]), /stepUp: \{\}/);
    await assert.doesNotReject(without([admin(), shield(), betterAuthConsole({ stepUp: false })]));
  });
});

describe("page", () => {
  it("is a 401 for strangers, or a redirect to signInURL", async () => {
    const auth = await setup();
    const res = await call(auth, "/console");
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("cache-control"), "no-store");

    const redirecting = await setup({ console: { signInURL: "/login" } });
    const moved = await call(redirecting, "/console");
    assert.equal(moved.status, 302);
    assert.equal(moved.headers.get("location"), "http://localhost:3000/login?callbackURL=%2Fapi%2Fauth%2Fconsole");
  });

  it("is a 404 for users who aren't admins", async () => {
    const auth = await setup();
    await signUp(auth, TARGET, "ada_l");
    const { cookie } = await signIn(auth, TARGET);
    assert.equal((await call(auth, "/console", { cookie })).status, 404);
    assert.equal((await consoleApi(auth, "me", { cookie })).status, 404);
    assert.equal((await consoleApi(auth, "users", { cookie })).status, 404);
  });

  it("serves admins the app under a strict CSP", async () => {
    const { auth, cookie } = await world();
    const res = await call(auth, "/console", { cookie });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'sha256-[^']+'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const html = await res.text();
    assert.match(html, /<meta name="auth-base" content="\/api\/auth" \/>/);
    assert.match(html, /<meta name="console-base" content="\/api\/auth\/console" \/>/);
    assert.doesNotMatch(html, /__AUTH_BASE__|__CONSOLE_BASE__/);
  });

  it("can live at another path", async () => {
    const { auth, cookie } = await world({ console: { path: "/admin/" } });
    assert.equal((await call(auth, "/admin", { cookie })).status, 200);
    assert.equal((await call(auth, "/admin/api/me", { cookie })).status, 200);
    assert.equal((await call(auth, "/console", { cookie })).status, 404);
  });
});

describe("step-up", () => {
  it("lets a fresh sign-in in, then asks again once maxAge has passed", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const { auth, cookie } = await world({ console: { stepUp: { maxAge: 600 } } });
    const me = await json(consoleApi(auth, "me", { cookie }));
    assert.equal(me.steppedUp, true);
    assert.equal(me.stepUp.maxAge, 600);
    assert.equal((await consoleApi(auth, "overview", { cookie })).status, 200);

    t.mock.timers.tick(601_000);
    assert.equal((await json(consoleApi(auth, "me", { cookie }))).steppedUp, false);
    const refused = await consoleApi(auth, "overview", { cookie });
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).code, "STEP_UP_REQUIRED");
    const action = await consoleApi(auth, "unlock", { cookie, body: { userId: "x" } });
    assert.equal(action.status, 403);

    const stepped = await call(auth, "/shield/step-up", { cookie, body: { password: "correct-horse-battery" } });
    assert.equal(stepped.status, 200);
    assert.equal((await json(consoleApi(auth, "me", { cookie }))).steppedUp, true);
    assert.equal((await consoleApi(auth, "overview", { cookie })).status, 200);
  });

  it("doesn't ask with stepUp: false", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const { auth, cookie } = await world({ console: { stepUp: false }, shield: {} });
    t.mock.timers.tick(86_400_000 * 2);
    const me = await json(consoleApi(auth, "me", { cookie }));
    assert.equal(me.steppedUp, true);
    assert.equal(me.stepUp, null);
    assert.equal((await consoleApi(auth, "overview", { cookie })).status, 200);
  });

  it("reports what the app has set up", async () => {
    const { auth, cookie } = await world();
    const me = await json(consoleApi(auth, "me", { cookie }));
    assert.equal(me.user.email, ADMIN);
    assert.deepEqual(me.can, { revoke: true, ban: true, update: true });
    assert.equal(me.features.twoFactor, true);
    assert.equal(me.features.username, true);
    assert.equal(me.features.passwordPolicy, true);
    assert.deepEqual([...me.filters].sort(), ["banned", "no2fa", "passwordChangeRequired", "unverified"]);
  });

  it("drops filters for features that aren't there", async () => {
    const { auth, cookie } = await world({
      plugins: [username(), admin(), shield({ stepUp: {} }), betterAuthConsole()],
    });
    const me = await json(consoleApi(auth, "me", { cookie }));
    assert.equal(me.features.twoFactor, false);
    assert.equal(me.features.passwordPolicy, false);
    assert.deepEqual([...me.filters].sort(), ["banned", "unverified"]);
  });
});

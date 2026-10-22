import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { call, consoleApi, DATABASES, events, json, PASSWORD, signIn, signUp, TARGET, world } from "./helpers.js";

for (const database of DATABASES) {
  describe(`actions (${database})`, () => {
    it("revokes every session, or one", async () => {
      const { auth, ada, cookie } = await world({ database });
      const first = await signIn(auth, TARGET);
      await signIn(auth, TARGET);
      let detail = await json(consoleApi(auth, "user", { cookie, query: { userId: ada.id } }));
      assert.equal(detail.sessions.length, 2);
      assert.ok(detail.sessions.every((s: Record<string, unknown>) => !("token" in s) && s.current === false));

      const one = detail.sessions[0].id;
      assert.equal((await consoleApi(auth, "revoke-sessions", { cookie, body: { userId: ada.id, sessionId: one } })).status, 200);
      detail = await json(consoleApi(auth, "user", { cookie, query: { userId: ada.id } }));
      assert.equal(detail.sessions.length, 1);
      assert.notEqual(detail.sessions[0].id, one);

      const missing = await consoleApi(auth, "revoke-sessions", { cookie, body: { userId: ada.id, sessionId: one } });
      assert.equal(missing.status, 404);

      assert.equal((await consoleApi(auth, "revoke-sessions", { cookie, body: { userId: ada.id } })).status, 200);
      detail = await json(consoleApi(auth, "user", { cookie, query: { userId: ada.id } }));
      assert.equal(detail.sessions.length, 0);
      assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: first.cookie }) }), null);

      const audit = await events(auth, "console.sessions_revoked");
      assert.equal(audit.length, 2);
      assert.equal(audit[0]?.userId, ada.id);
      assert.ok(audit.every((e) => typeof e.metadata.actorId === "string"));
    });

    it("signs out an admin's other devices but never the one in use", async () => {
      const { auth, root, cookie } = await world({ database });
      await signIn(auth, "root@example.com");
      const detail = await json(consoleApi(auth, "user", { cookie, query: { userId: root.id } }));
      assert.equal(detail.sessions.length, 2);
      const current = detail.sessions.find((s: { current: boolean }) => s.current);
      assert.ok(current);

      const refused = await consoleApi(auth, "revoke-sessions", { cookie, body: { userId: root.id, sessionId: current.id } });
      assert.equal(refused.status, 400);
      assert.equal((await refused.json()).code, "CANNOT_TARGET_SELF");

      assert.equal((await consoleApi(auth, "revoke-sessions", { cookie, body: { userId: root.id } })).status, 200);
      const after = await json(consoleApi(auth, "user", { cookie, query: { userId: root.id } }));
      assert.deepEqual(
        after.sessions.map((s: { id: string }) => s.id),
        [current.id],
      );
      assert.equal((await consoleApi(auth, "me", { cookie })).status, 200);
    });

    it("bans and unbans, and won't ban yourself", async () => {
      const { auth, root, ada, cookie } = await world({ database });
      await signIn(auth, TARGET);
      const banned = await consoleApi(auth, "ban", { cookie, body: { userId: ada.id, reason: "spam", expiresIn: 3600 } });
      assert.equal(banned.status, 200);

      const detail = await json(consoleApi(auth, "user", { cookie, query: { userId: ada.id } }));
      assert.equal(detail.user.banned, true);
      assert.equal(detail.user.banReason, "spam");
      assert.ok(new Date(detail.user.banExpires).getTime() > Date.now());
      assert.equal(detail.sessions.length, 0);
      assert.deepEqual(detail.reasons[0], { code: "banned", detail: "spam" });
      assert.notEqual((await signIn(auth, TARGET)).res.status, 200);

      const list = await json(consoleApi(auth, "users", { cookie, query: { filter: "banned" } }));
      assert.deepEqual(
        list.users.map((u: { id: string }) => u.id),
        [ada.id],
      );

      assert.equal((await consoleApi(auth, "unban", { cookie, body: { userId: ada.id } })).status, 200);
      assert.equal((await signIn(auth, TARGET)).res.status, 200);

      const self = await consoleApi(auth, "ban", { cookie, body: { userId: root.id } });
      assert.equal(self.status, 400);
      assert.equal((await self.json()).code, "CANNOT_TARGET_SELF");
      assert.equal((await consoleApi(auth, "ban", { cookie, body: { userId: "nobody" } })).status, 404);

      assert.equal((await events(auth, "console.banned"))[0]?.metadata.reason, "spam");
      assert.equal((await events(auth, "console.unbanned")).length, 1);
    });

    it("unlocks a sign-in lockout and a two-factor lock", async () => {
      const { auth, ada, cookie } = await world({ database });
      for (let i = 0; i < 2; i++) await signIn(auth, TARGET, "wrong-password-123");
      assert.equal((await signIn(auth, TARGET)).res.status, 429);

      const ctx = await auth.$context;
      await ctx.adapter.create({
        model: "twoFactor",
        data: { userId: ada.id, secret: "s", backupCodes: "[]", lockedUntil: new Date(Date.now() + 3600_000), failedVerificationCount: 5 },
      });

      const before = await json(consoleApi(auth, "user", { cookie, query: { userId: ada.id } }));
      assert.deepEqual(before.locks.map((l: { scope: string }) => l.scope).sort(), ["ip", "two_factor"]);
      assert.ok(before.reasons.some((r: { code: string }) => r.code === "locked"));

      assert.equal((await consoleApi(auth, "unlock", { cookie, body: { userId: ada.id } })).status, 200);
      assert.equal((await signIn(auth, TARGET)).res.status, 200);
      const row = await ctx.adapter.findOne<{ lockedUntil: Date | null; failedVerificationCount: number }>({
        model: "twoFactor",
        where: [{ field: "userId", value: ada.id }],
      });
      assert.equal(row?.lockedUntil ?? null, null);
      assert.equal(row?.failedVerificationCount, 0);

      const after = await json(consoleApi(auth, "user", { cookie, query: { userId: ada.id } }));
      assert.deepEqual(after.locks, []);
      assert.equal((await events(auth, "console.unlocked")).length, 1);
    });

    it("lifts a step-up lock", async () => {
      const { auth, ada, cookie } = await world({ database });
      const user = await signIn(auth, TARGET);
      for (let i = 0; i < 6; i++) {
        await call(auth, "/shield/step-up", { cookie: user.cookie, body: { password: "wrong-password-123" } });
      }
      const locked = await json(consoleApi(auth, "user", { cookie, query: { userId: ada.id } }));
      assert.ok(locked.locks.some((l: { scope: string }) => l.scope === "step_up"));

      assert.equal((await consoleApi(auth, "unlock", { cookie, body: { userId: ada.id } })).status, 200);
      const ok = await call(auth, "/shield/step-up", { cookie: user.cookie, body: { password: PASSWORD } });
      assert.equal(ok.status, 200);
      const after = await json(consoleApi(auth, "user", { cookie, query: { userId: ada.id } }));
      assert.ok(!after.locks.some((l: { scope: string }) => l.scope === "step_up"));
    });

    it("requires a password change", async () => {
      const { auth, root, ada, cookie } = await world({ database });
      assert.equal((await consoleApi(auth, "require-password-change", { cookie, body: { userId: ada.id } })).status, 200);
      const detail = await json(consoleApi(auth, "user", { cookie, query: { userId: ada.id } }));
      assert.equal(detail.user.passwordChangeRequired, true);
      assert.ok(detail.reasons.some((r: { code: string }) => r.code === "password_change_required"));
      assert.equal((await events(auth, "console.password_change_required")).length, 1);

      const self = await consoleApi(auth, "require-password-change", { cookie, body: { userId: root.id } });
      assert.equal(self.status, 400);
    });

    it("says when a feature isn't set up", async () => {
      const { auth, ada, cookie } = await world({ database, shield: { stepUp: {} } });
      const res = await consoleApi(auth, "require-password-change", { cookie, body: { userId: ada.id } });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, "FEATURE_UNAVAILABLE");
    });

    it("keeps actions from admins without the permission", async () => {
      const { auth, ada } = await world({ database });
      await signUp(auth, "helper@example.com", "helper", "user");
      const { cookie } = await signIn(auth, "helper@example.com");
      assert.equal((await consoleApi(auth, "ban", { cookie, body: { userId: ada.id } })).status, 404);
    });
  });
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consoleApi, DATABASES, json, signIn, signUp, TARGET, world } from "./helpers.js";

for (const database of DATABASES) {
  describe(`reads (${database})`, () => {
    it("searches users by email, name, username or id, any case", async () => {
      const { auth, ada, cookie } = await world({ database });
      for (let i = 0; i < 5; i++) await signUp(auth, `user${i}@example.com`, `user_${i}`);
      const find = async (q: string) =>
        (await json(consoleApi(auth, "users", { cookie, query: { q } }))).users.map((u: { email: string }) => u.email);

      assert.deepEqual(await find("ADA@EXAMPLE"), [TARGET]);
      assert.deepEqual(await find("ada_l"), [TARGET]);
      assert.deepEqual(await find(ada.id), [TARGET]);
      assert.equal((await find("user")).length, 5);
      assert.deepEqual(await find("nobody-here"), []);

      const all = await json(consoleApi(auth, "users", { cookie }));
      assert.equal(all.total, 7);
      assert.ok(all.users.every((u: Record<string, unknown>) => !("password" in u) && !("banReason" in u)));
      const page = await json(consoleApi(auth, "users", { cookie, query: { limit: 3, offset: 6 } }));
      assert.equal(page.users.length, 1);
      assert.equal(page.total, 7);
    });

    it("filters users and refuses an unknown filter", async () => {
      const { auth, cookie } = await world({ database });
      const unverified = await json(consoleApi(auth, "users", { cookie, query: { filter: "unverified" } }));
      assert.equal(unverified.total, 1); // the admin is verified
      const no2fa = await json(consoleApi(auth, "users", { cookie, query: { filter: "no2fa" } }));
      assert.equal(no2fa.total, 2);
      assert.equal((await consoleApi(auth, "users", { cookie, query: { filter: "everything" } })).status, 400);
      assert.equal((await consoleApi(auth, "users", { cookie, query: { limit: 500 } })).status, 400);
    });

    it("explains why a user can't sign in", async () => {
      const { auth, ada, cookie } = await world({ database, auth: { emailAndPassword: { enabled: true, requireEmailVerification: true } } });
      const detail = await json(consoleApi(auth, "user", { cookie, query: { userId: ada.id } }));
      assert.deepEqual(
        detail.reasons.map((r: { code: string }) => r.code),
        ["email_unverified"],
      );
      assert.deepEqual(
        detail.accounts.map((a: { providerId: string }) => a.providerId),
        ["credential"],
      );
      assert.equal(detail.user.email, TARGET);
      assert.equal((await consoleApi(auth, "user", { cookie, query: { userId: "nobody" } })).status, 404);
    });

    it("finds a user's lockout events by their email", async () => {
      const { auth, ada, cookie } = await world({ database });
      for (let i = 0; i < 2; i++) await signIn(auth, TARGET, "wrong-password-123");
      const detail = await json(consoleApi(auth, "user", { cookie, query: { userId: ada.id } }));
      const types = detail.events.map((e: { type: string }) => e.type);
      assert.ok(types.includes("lockout"), types.join());
      assert.ok(types.includes("sign_in.failure"), types.join());

      const byEmail = await json(consoleApi(auth, "events", { cookie, query: { identifier: "ADA@example.com", type: "lockout" } }));
      assert.equal(byEmail.events.length, 1);
      assert.equal(byEmail.events[0].metadata.scope, "ip");
      assert.equal(typeof byEmail.events[0].createdAt, "string");
    });

    it("filters events by type prefix and IP, and pages with `next`", async () => {
      const { auth, cookie } = await world({ database });
      for (let i = 0; i < 5; i++) await signIn(auth, `ghost${i}@example.com`, "wrong-password-123", "198.51.100.9");

      const failures = await json(consoleApi(auth, "events", { cookie, query: { type: "sign_in.failure" } }));
      assert.equal(failures.events.length, 5);
      const signIns = await json(consoleApi(auth, "events", { cookie, query: { type: "sign_in." } }));
      assert.equal(signIns.events.length, 6); // the admin's own sign-in too
      const fromIp = await json(consoleApi(auth, "events", { cookie, query: { ip: "198.51.100.9" } }));
      assert.equal(fromIp.events.length, 5);

      const first = await json(consoleApi(auth, "events", { cookie, query: { type: "sign_in.", limit: 4 } }));
      assert.equal(first.events.length, 4);
      assert.ok(first.next);
      const second = await json(consoleApi(auth, "events", { cookie, query: { type: "sign_in.", limit: 4, before: first.next } }));
      assert.equal(second.events.length, 2);
      assert.equal(second.next, null);
      const ids = new Set([...first.events, ...second.events].map((e: { id: string }) => e.id));
      assert.equal(ids.size, 6);
    });

    it("sums up the last two weeks", async () => {
      const { auth, cookie } = await world({ database });
      await signIn(auth, TARGET);
      for (let i = 0; i < 3; i++) await signIn(auth, TARGET, "wrong-password-123", `192.0.2.${i}`);
      const data = await json(consoleApi(auth, "overview", { cookie }));
      assert.equal(data.users, 2);
      assert.equal(data.newUsers, 2);
      assert.equal(data.activeSessions, 2);
      assert.equal(data.twoFactorUsers, 0);
      assert.equal(data.bannedUsers, 0);
      assert.equal(data.signIns.length, 14);
      const today = data.signIns.at(-1);
      assert.equal(today.day, new Date().toISOString().slice(0, 10));
      assert.equal(today.success, 2);
      assert.equal(today.failure, 3);
      assert.ok(data.recent.length > 0);
    });
  });
}

# better-auth-console

An admin console for [Better Auth](https://better-auth.com) that runs inside your own app. It reads your own database through Better Auth, so no user data leaves your server and there is no extra service to host.

> **Pre-release.** Not on npm yet. The API may change before 0.1.

What an admin can do with it:

- **Overview**: user, session and two-factor counts, sign-ins over the last 14 days, and recent security events.
- **Users**: search by email, name, username or user ID, with filters for banned, unverified email, no two-factor and must change password.
- **One user**: a plain answer to "can they sign in?", with the reason when they can't (banned, locked out and until when, email not verified, password change required). Also their sessions, sign-in methods and security events.
- **Actions**: sign a user out of one device or every device, ban for a set time or until lifted, unban, lift every lockout, and require a new password.
- **Events**: the full feed from [better-auth-shield](https://github.com/Weesofficial/better-auth-shield), filtered by type, email or username, IP address or user.

Every action asks for confirmation and is written to the event feed with the admin who did it.

## Install

```sh
npm install better-auth-console better-auth-shield
```

The console needs Better Auth's `admin` plugin for roles and bans, and `better-auth-shield` for lockouts, step-up and the event feed.

```ts
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { shield } from "better-auth-shield";
import { betterAuthConsole } from "better-auth-console";

export const auth = betterAuth({
  // ...
  plugins: [
    admin(),
    shield({ stepUp: {}, password: {} }),
    betterAuthConsole({ signInURL: "/sign-in" }),
  ],
});
```

Run your usual migration (`npx @better-auth/cli migrate`, or `generate` for Prisma and Drizzle). The console adds no tables of its own; shield does.

Then open `/api/auth/console` (your Better Auth base path plus `/console`) while signed in as an admin.

The console works with whatever else you have installed. With `twoFactor` it shows two-factor status, a "no two-factor" filter and Better Auth's own code lockouts. With `username` or `phoneNumber` it can search by those. With shield's `password` option it can require a new password.

## Options

| Option | Default | |
| --- | --- | --- |
| `path` | `"/console"` | Where the console is served, under Better Auth's base path. |
| `signInURL` | none | Where to send someone who opens the console signed out. They come back through `?callbackURL=`. Without it, they see a plain "sign in first" page. |
| `stepUp` | `{ maxAge: 1800 }` | How many seconds the console stays open after the admin proves it's them. `false` turns step-up off (see below). |

## Who can use it

Access follows the `admin` plugin's roles, including custom roles made with `createAccessControl`:

| To | Needs |
| --- | --- |
| Open the console and read anything | `user: ["list", "get"]`, `session: ["list"]` |
| Sign a user out | `session: ["revoke"]` |
| Ban or unban | `user: ["ban"]` |
| Lift lockouts, require a new password | `user: ["update"]` |

The built-in `admin` role has all of these, as does any user in `adminUserIds`. Buttons for things an admin can't do are hidden, and the server checks every request again. Anyone else gets a 404, so the console doesn't confirm it exists. Admins can't ban themselves or force themselves to change password.

## Step-up

A stolen session cookie shouldn't be enough to ban users. Before it shows anything, the console asks the admin to confirm it's them: their password through shield's `/shield/step-up`, or an authenticator code if they use two-factor. That lasts `stepUp.maxAge` seconds, measured from the confirmation or from sign-in, whichever is later. After that, the next request asks again and the console picks up where it was.

Wrong guesses count toward shield's own step-up lockout, which another admin can lift from the console.

`stepUp: false` skips this. Only do that if your sessions are already short-lived or bound to a device.

## Security

- The page is one HTML file built into the package. It loads nothing from other origins and has no build step in your app.
- The page sends `Content-Security-Policy` with `default-src 'none'`. Scripts and styles are allowed only by hash, `connect-src` is `'self'` only, and `frame-ancestors` is `'none'`. It also sends `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin` and `Cache-Control: no-store`. JSON responses are `no-store` too.
- Shield stores a keyed hash of emails, usernames and phone numbers in events, never the value itself. The console finds events by hashing what you type, so the event table stays free of addresses.
- Actions are `POST` requests through Better Auth's own origin and CSRF checks.

## Error codes

`ERROR_CODES` is exported for client code that calls the console's endpoints directly: `STEP_UP_REQUIRED`, `NOT_FOUND`, `CANNOT_TARGET_SELF`, `FEATURE_UNAVAILABLE` and `UNKNOWN_FILTER`.

## Working on it

```sh
npm install
npm run build:ui && npm run dev   # sample app with seeded users on http://localhost:3141
npm test                          # memory and SQLite adapters
```

Sign in to the sample app as `root@example.com` with password `correct-horse-battery`. After editing `ui/`, run `npm run build:ui` again and restart `npm run dev`.

Design notes: [better-auth-shield/docs/design.md](https://github.com/Weesofficial/better-auth-shield/blob/main/docs/design.md)

MIT

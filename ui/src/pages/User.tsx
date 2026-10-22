import { ArrowLeft } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api, useLoad, type Me, type UserDetail } from "../api";
import { EventList } from "../EventList";
import { ago, date, dateTime, device, scopeLabel } from "../format";
import { href } from "../router";
import { Button, Card, Dialog, Empty, ErrorNote, Field, inputClass, Mono, PageTitle, Spinner, ToneIcon } from "../ui";
import { UserStatus } from "./Users";

type Action =
  | { kind: "revoke-all" }
  | { kind: "revoke-one"; sessionId: string }
  | { kind: "ban" }
  | { kind: "unban" }
  | { kind: "unlock" }
  | { kind: "require-password-change" };

const BAN_LENGTHS = [
  { value: "", label: "Until I lift it" },
  { value: String(3600), label: "1 hour" },
  { value: String(86400), label: "1 day" },
  { value: String(7 * 86400), label: "7 days" },
  { value: String(30 * 86400), label: "30 days" },
];

/** Plain-language answers to "why can't they sign in?". */
function reasonText(reason: UserDetail["reasons"][number], detail: UserDetail): ReactNode {
  switch (reason.code) {
    case "banned": {
      const until = detail.user.banExpires ? ` until ${dateTime(detail.user.banExpires)}` : "";
      return `Banned${until}${reason.detail ? `: ${reason.detail}` : "."}`;
    }
    case "locked":
      return null; // Listed one by one under Locks.
    case "email_unverified":
      return "Email isn't verified, and your app requires it before signing in.";
    case "password_change_required":
      return "Must set a new password before anything else works.";
    case "two_factor_overdue":
      return "Two-factor setup is overdue, so sign-in stops at the setup step.";
    case "no_login_method":
      return "Has no linked account at all: no password and no social login.";
    case "no_password":
      return "Has no password; can only sign in through a linked provider.";
    default:
      return reason.code;
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

export function UserPage({ id, me }: { id: string; me: Me }) {
  const { data, error, loading, reload } = useLoad(() => api.get<UserDetail>("user", { userId: id }), id);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banLength, setBanLength] = useState("");

  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Spinner />;

  const { user, sessions, accounts, locks, reasons } = data;
  const self = user.id === me.user.id;
  const others = sessions.filter((s) => !s.current);

  const open = (next: Action) => {
    setActionError(null);
    setBanReason("");
    setBanLength("");
    setAction(next);
  };

  const run = async () => {
    if (!action) return;
    setBusy(true);
    setActionError(null);
    try {
      const userId = user.id;
      if (action.kind === "revoke-all") await api.post("revoke-sessions", { userId });
      else if (action.kind === "revoke-one") await api.post("revoke-sessions", { userId, sessionId: action.sessionId });
      else if (action.kind === "ban")
        await api.post("ban", { userId, reason: banReason.trim() || undefined, expiresIn: banLength ? Number(banLength) : undefined });
      else await api.post(action.kind, { userId });
      setNotice(DONE[action.kind]);
      setAction(null);
      reload();
    } catch (e) {
      setActionError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  const shown = reasons.map((r) => ({ code: r.code, text: reasonText(r, data) })).filter((r) => r.text);
  const actions = [
    me.can.revoke && (self ? others.length > 0 : sessions.length > 0) && (
      <Button key="revoke" onClick={() => open({ kind: "revoke-all" })}>
        {self ? "Sign out other devices" : "Sign out everywhere"}
      </Button>
    ),
    me.can.update && (locks.length > 0 || reasons.some((r) => r.code === "locked")) && (
      <Button key="unlock" onClick={() => open({ kind: "unlock" })}>
        Unlock
      </Button>
    ),
    !self && me.can.update && me.features.passwordPolicy && !user.passwordChangeRequired && accounts.some((a) => a.providerId === "credential") && (
      <Button key="pwd" onClick={() => open({ kind: "require-password-change" })}>
        Require new password
      </Button>
    ),
    !self &&
      me.can.ban &&
      (user.banned ? (
        <Button key="unban" onClick={() => open({ kind: "unban" })}>
          Lift ban
        </Button>
      ) : (
        <Button key="ban" variant="danger" onClick={() => open({ kind: "ban" })}>
          Ban
        </Button>
      )),
  ].filter(Boolean);

  return (
    <>
      <a href={href("/users")} className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Users
      </a>
      <PageTitle
        sub={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{user.email}</span>
            {user.username && <span>@{user.displayUsername || user.username}</span>}
            <UserStatus user={user} />
          </span>
        }
        action={actions.length ? <div className="flex flex-wrap gap-2">{actions}</div> : undefined}
      >
        {user.name || user.email}
        {self && <span className="ml-2 text-sm font-normal text-faint">(you)</span>}
      </PageTitle>

      {notice && (
        <p role="status" className="mb-4 flex items-center gap-2 text-sm text-good">
          <ToneIcon tone="good" /> {notice}
        </p>
      )}

      <div className={loading ? "opacity-60" : undefined}>
        <Card title="Can they sign in?" className="mb-4">
          {!shown.length && !locks.length ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm">
              <ToneIcon tone="good" /> Nothing on our side is stopping them.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((r) => (
                <li key={r.code} className="flex gap-2 px-4 py-2.5 text-sm">
                  <ToneIcon tone={r.code === "banned" ? "bad" : "warn"} className="mt-0.5" /> <span>{r.text}</span>
                </li>
              ))}
              {locks.map((lock) => (
                <li key={lock.scope + lock.until} className="flex gap-2 px-4 py-2.5 text-sm">
                  <ToneIcon tone="bad" className="mt-0.5" />
                  <span>
                    Locked out of {scopeLabel(lock.scope)} until {dateTime(lock.until)}
                    <span className="text-faint"> · since {ago(lock.since)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title={`Sessions · ${sessions.length}`}>
              {!sessions.length ? (
                <Empty>Not signed in anywhere.</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {sessions.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-medium">
                          {device(s.userAgent)}
                          {s.current && <span className="ml-2 text-xs font-normal text-accent">This session</span>}
                          {s.impersonatedBy && <span className="ml-2 text-xs font-normal text-warn">Impersonated</span>}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                          {s.ipAddress && <Mono>{s.ipAddress}</Mono>}
                          <span title={dateTime(s.updatedAt)}>active {ago(s.updatedAt)}</span>
                          <span>signed in {date(s.createdAt)}</span>
                          <span>expires {date(s.expiresAt)}</span>
                        </div>
                      </div>
                      {me.can.revoke && !s.current && (
                        <Button variant="ghost" onClick={() => open({ kind: "revoke-one", sessionId: s.id })}>
                          Sign out
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card
              title="Security events"
              action={
                <a className="text-xs text-accent hover:underline" href={href("/events", { userId: user.id })}>
                  All
                </a>
              }
            >
              <EventList events={data.events} showUser={false} empty="Nothing recorded for this user yet." />
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Details">
              <dl className="divide-y divide-line">
                <Row label="User ID">
                  <Mono>{user.id}</Mono>
                </Row>
                <Row label="Joined">{dateTime(user.createdAt)}</Row>
                <Row label="Email">{user.emailVerified ? "Verified" : "Not verified"}</Row>
                {user.phoneNumber && (
                  <Row label="Phone">
                    {user.phoneNumber}
                    {user.phoneNumberVerified ? "" : " (not verified)"}
                  </Row>
                )}
                {me.features.twoFactor && <Row label="Two-factor">{user.twoFactorEnabled ? "On" : "Off"}</Row>}
                {user.twoFactorDueAt && !user.twoFactorEnabled && <Row label="Two-factor due">{date(user.twoFactorDueAt)}</Row>}
                <Row label="Role">{user.role || "user"}</Row>
              </dl>
            </Card>
            <Card title="Sign-in methods">
              {!accounts.length ? (
                <Empty>None.</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {accounts.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3 px-4 py-2 text-sm">
                      <span>{a.providerId === "credential" ? "Password" : a.providerId}</span>
                      <span className="text-xs text-muted">added {date(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>

      <Dialog
        open={action !== null}
        onClose={() => !busy && setAction(null)}
        title={action ? TITLES[action.kind] : ""}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button variant={action?.kind === "ban" ? "danger" : "primary"} busy={busy} onClick={run}>
              {action ? CONFIRM[action.kind] : "OK"}
            </Button>
          </>
        }
      >
        {action && (
          <div className="space-y-3">
            <p>{describe(action, user.name || user.email, self)}</p>
            {action.kind === "ban" && (
              <>
                <Field label="Reason" hint="Kept with the ban and shown here; your app decides whether the user sees it.">
                  <input className={inputClass} value={banReason} maxLength={500} onChange={(e) => setBanReason(e.target.value)} />
                </Field>
                <Field label="How long">
                  <select className={inputClass} value={banLength} onChange={(e) => setBanLength(e.target.value)}>
                    {BAN_LENGTHS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {actionError && <ErrorNote error={actionError} />}
          </div>
        )}
      </Dialog>
    </>
  );
}

const TITLES: Record<Action["kind"], string> = {
  "revoke-all": "Sign out everywhere?",
  "revoke-one": "Sign out this session?",
  ban: "Ban this user?",
  unban: "Lift the ban?",
  unlock: "Unlock this user?",
  "require-password-change": "Require a new password?",
};

const CONFIRM: Record<Action["kind"], string> = {
  "revoke-all": "Sign out",
  "revoke-one": "Sign out",
  ban: "Ban",
  unban: "Lift ban",
  unlock: "Unlock",
  "require-password-change": "Require it",
};

const DONE: Record<Action["kind"], string> = {
  "revoke-all": "Signed out.",
  "revoke-one": "Session signed out.",
  ban: "Banned and signed out everywhere.",
  unban: "Ban lifted.",
  unlock: "Unlocked.",
  "require-password-change": "They'll be asked for a new password next time.",
};

function describe(action: Action, name: string, self: boolean) {
  switch (action.kind) {
    case "revoke-all":
      return self
        ? "Every other device you're signed in on is signed out. This one stays."
        : `${name} is signed out on every device and has to sign in again.`;
    case "revoke-one":
      return "That device is signed out and has to sign in again.";
    case "ban":
      return `${name} is signed out everywhere and can't sign in until the ban ends.`;
    case "unban":
      return `${name} can sign in again.`;
    case "unlock":
      return `Clears every lockout on ${name}: sign-in, second-factor codes and step-up. Failed attempts so far are forgotten.`;
    case "require-password-change":
      return `${name} keeps their sessions, but is held at the change-password step until they set a new one.`;
  }
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const df = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export function ago(value: string | Date | null | undefined) {
  if (!value) return "—";
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return Math.abs(seconds) < 30 ? "just now" : rtf.format(Math.round(seconds), "second");
}

export const dateTime = (value: string | Date | null | undefined) => (value ? dtf.format(new Date(value)) : "—");
export const date = (value: string | Date | null | undefined) => (value ? df.format(new Date(value)) : "—");
export const number = (n: number) => n.toLocaleString();

/** "Chrome on macOS", good enough to tell a user's devices apart. */
export function device(ua: string | null | undefined) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl|node|undici|python|okhttp|axios/i.test(ua)
              ? "Script"
              : "Browser";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return os ? `${browser} on ${os}` : browser;
}

export type Tone = "good" | "bad" | "warn" | "neutral";

const EVENTS: Record<string, [label: string, tone: Tone]> = {
  "sign_in.success": ["Signed in", "good"],
  "sign_in.failure": ["Sign-in failed", "bad"],
  lockout: ["Locked out", "bad"],
  unlock: ["Unlocked", "good"],
  "two_factor.success": ["Second factor passed", "good"],
  "two_factor.failure": ["Wrong second-factor code", "bad"],
  "two_factor.setup_required": ["Two-factor deadline set", "warn"],
  "step_up.success": ["Confirmed it's them", "good"],
  "step_up.failure": ["Failed to confirm it's them", "bad"],
  "send.limited": ["Send limit reached", "warn"],
  "password.changed": ["Password changed", "neutral"],
  "password.reuse_blocked": ["Old password refused", "warn"],
  "password.change_required": ["Password change required", "warn"],
  "console.sessions_revoked": ["Sessions revoked by an admin", "warn"],
  "console.banned": ["Banned by an admin", "bad"],
  "console.unbanned": ["Unbanned by an admin", "good"],
  "console.unlocked": ["Unlocked by an admin", "good"],
  "console.password_change_required": ["Password change required by an admin", "warn"],
};

export const eventLabel = (type: string) => EVENTS[type]?.[0] ?? type;
export const eventTone = (type: string): Tone => EVENTS[type]?.[1] ?? "neutral";

export const EVENT_GROUPS = [
  { value: "", label: "All events" },
  { value: "sign_in.", label: "Sign-ins" },
  { value: "sign_in.failure", label: "Failed sign-ins" },
  { value: "lockout", label: "Lockouts" },
  { value: "unlock", label: "Unlocks" },
  { value: "two_factor.", label: "Two-factor" },
  { value: "step_up.", label: "Step-up" },
  { value: "send.limited", label: "Send limits" },
  { value: "password.", label: "Passwords" },
  { value: "console.", label: "Admin actions" },
];

const SCOPES: Record<string, string> = {
  ip: "sign-in from one IP",
  global: "sign-in from every IP",
  two_factor: "second-factor codes",
  step_up: "step-up checks",
};
export const scopeLabel = (scope: string) => SCOPES[scope] ?? scope;

/** One line of context for an event, from its metadata. */
export function eventDetail(event: { type: string; metadata: Record<string, unknown> | null }) {
  const m = event.metadata ?? {};
  const parts: string[] = [];
  if (typeof m.path === "string") parts.push(m.path);
  if (typeof m.method === "string") parts.push(`by ${m.method.replace("_", " ")}`);
  if (event.type === "unlock") parts.push(typeof m.scope === "string" ? `lifts the lock on ${scopeLabel(m.scope)}` : "lifts sign-in locks");
  else if (typeof m.scope === "string") parts.push(`locks ${scopeLabel(m.scope)}`);
  if (typeof m.until === "string") parts.push(`until ${dateTime(m.until)}`);
  if (typeof m.reason === "string") parts.push(m.reason === "max_age" ? "password too old" : m.reason);
  if (typeof m.dueAt === "string") parts.push(`due ${date(m.dueAt)}`);
  if (typeof m.count === "number") parts.push(`${m.count} session${m.count === 1 ? "" : "s"}`);
  if (typeof m.expires === "string") parts.push(`until ${dateTime(m.expires)}`);
  if (m.twoFactorPending === true) parts.push("password right, waiting for second factor");
  if (typeof m.code === "string") parts.push(m.code);
  return parts.join(" · ");
}

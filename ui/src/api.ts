import { useCallback, useEffect, useState } from "react";

const meta = (name: string) => document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? "";

/** Better Auth's base path, e.g. `/api/auth`. */
export const AUTH_BASE = meta("auth-base");
const API = `${meta("console-base")}/api`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/** Fired when the server says the step-up has run out; the app asks again. */
export const STEP_UP_EVENT = "console:step-up";

export async function request<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  if (!res.ok) {
    const error = new ApiError(res.status, data?.code, data?.message || res.statusText || `Request failed (${res.status})`);
    if (error.code === "STEP_UP_REQUIRED") window.dispatchEvent(new Event(STEP_UP_EVENT));
    return Promise.reject(error);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, params: Record<string, string | number | undefined> = {}) => {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") query.set(k, String(v));
    const qs = query.toString();
    return request<T>(`${API}/${path}${qs ? `?${qs}` : ""}`);
  },
  post: <T>(path: string, body: unknown) => request<T>(`${API}/${path}`, body),
};

/** Loads on mount and whenever `key` changes; `reload` fetches again in place. */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data?: T; error?: ApiError | Error; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ data: s.data, loading: true }));
    load().then(
      (data) => live && setState({ data, loading: false }),
      (error: Error) => live && setState({ error, loading: false }),
    );
    return () => {
      live = false;
    };
    // `load` is a fresh closure each render; `key` says when its inputs changed.
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export interface Me {
  user: { id: string; name: string; email: string; role: string | null };
  steppedUp: boolean;
  stepUp: { maxAge: number; provenAt: string } | null;
  can: { revoke: boolean; ban: boolean; update: boolean };
  features: {
    twoFactor: boolean;
    twoFactorEnabled: boolean;
    username: boolean;
    phoneNumber: boolean;
    passwordPolicy: boolean;
    requiredTwoFactor: boolean;
  };
  filters: string[];
}

export interface SecurityEvent {
  id: string;
  type: string;
  userId: string | null;
  identifierHash: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Overview {
  users: number;
  newUsers: number;
  activeSessions: number | null;
  twoFactorUsers: number | null;
  bannedUsers: number | null;
  signIns: { day: string; success: number; failure: number }[];
  lockouts24h: number;
  sendLimited24h: number;
  recent: SecurityEvent[];
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: string;
  role?: string | null;
  banned?: boolean | null;
  username?: string | null;
  twoFactorEnabled?: boolean | null;
  passwordChangeRequired?: boolean | null;
}

export interface UserDetail {
  user: UserRow & {
    updatedAt: string;
    banReason?: string | null;
    banExpires?: string | null;
    displayUsername?: string | null;
    phoneNumber?: string | null;
    phoneNumberVerified?: boolean | null;
    twoFactorDueAt?: string | null;
  };
  accounts: { id: string; providerId: string; accountId: string; createdAt: string }[];
  sessions: {
    id: string;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    impersonatedBy?: string | null;
    stepUpAt?: string | null;
    current: boolean;
  }[];
  events: SecurityEvent[];
  locks: { scope: string; until: string; since: string }[];
  reasons: { code: string; detail?: string }[];
}

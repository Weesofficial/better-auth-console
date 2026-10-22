import { useEffect, useRef, useState } from "react";
import { api, useLoad, type Overview as Data } from "../api";
import { EventList } from "../EventList";
import { number } from "../format";
import { href } from "../router";
import { Card, ErrorNote, PageTitle, Spinner } from "../ui";

function Stat({ label, value, sub, to }: { label: string; value: string; sub?: string; to?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </>
  );
  const className = "block rounded-lg border border-line bg-panel px-4 py-3";
  return to ? (
    <a href={to} className={`${className} hover:border-faint`}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

const H = 200;

/** The element's content width, kept current, so the chart draws at real pixel size. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
const PAD = { top: 12, right: 8, bottom: 24, left: 36 };

/** Successful and failed sign-ins per day, side by side. */
function SignInChart({ days }: { days: Data["signIns"] }) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const W = Math.max(280, measured);
  const max = Math.max(4, ...days.flatMap((d) => [d.success, d.failure]));
  // A round top value so the gridlines land on whole numbers.
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / days.length;
  const bar = Math.min(14, (slot - 6) / 2);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top];
  // Label every day when there's room, else every other or every third.
  const every = slot >= 44 ? 1 : slot >= 22 ? 2 : 3;
  const label = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const totals = days.reduce((a, d) => ({ success: a.success + d.success, failure: a.failure + d.failure }), { success: 0, failure: 0 });

  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 pt-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-accent" aria-hidden /> Successful · {number(totals.success)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-bad" aria-hidden /> Failed · {number(totals.failure)}
        </span>
      </div>
      <div ref={ref}>
        {measured > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Sign-ins per day for the last 14 days">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-faint text-[10px] tabular-nums">
                  {number(t)}
                </text>
              </g>
            ))}
            {days.map((d, i) => {
              const x = PAD.left + i * slot + slot / 2;
              const day = label.format(new Date(`${d.day}T00:00:00Z`));
              return (
                <g key={d.day}>
                  <title>{`${day}: ${d.success} successful, ${d.failure} failed`}</title>
                  <rect x={x - slot / 2} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                  <rect x={x - bar - 1} y={y(d.success)} width={bar} height={Math.max(0, y(0) - y(d.success))} rx={2} className="fill-accent" />
                  <rect x={x + 1} y={y(d.failure)} width={bar} height={Math.max(0, y(0) - y(d.failure))} rx={2} className="fill-bad" />
                  {(days.length - 1 - i) % every === 0 && (
                    <text x={x} y={H - 6} textAnchor="middle" className="fill-faint text-[10px]">
                      {day}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

export function Overview() {
  const { data, error, reload } = useLoad(() => api.get<Data>("overview"), "overview");
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Spinner />;

  const pct = (n: number | null) => (n === null || !data.users ? null : `${Math.round((n / data.users) * 100)}%`);
  return (
    <>
      <PageTitle sub="Last 14 days, from your own database.">Overview</PageTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Users" value={number(data.users)} sub={`${number(data.newUsers)} new this week`} to={href("/users")} />
        <Stat
          label="Active sessions"
          value={data.activeSessions === null ? "—" : number(data.activeSessions)}
          sub={data.activeSessions === null ? "Kept in secondary storage" : "Not yet expired"}
        />
        <Stat
          label="Two-factor on"
          value={pct(data.twoFactorUsers) ?? "—"}
          sub={data.twoFactorUsers === null ? "twoFactor plugin not set up" : `${number(data.twoFactorUsers)} users`}
          to={data.twoFactorUsers === null ? undefined : href("/users", { filter: "no2fa" })}
        />
        <Stat
          label="Lockouts, 24 h"
          value={number(data.lockouts24h)}
          sub={`${number(data.sendLimited24h)} send limits hit`}
          to={href("/events", { type: "lockout" })}
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card
          title="Sign-ins"
          className="lg:col-span-3"
          action={
            <a className="text-xs text-accent hover:underline" href={href("/events", { type: "sign_in." })}>
              All sign-ins
            </a>
          }
        >
          <SignInChart days={data.signIns} />
        </Card>
        <Card
          title="Recent events"
          className="lg:col-span-2"
          action={
            <a className="text-xs text-accent hover:underline" href={href("/events")}>
              All events
            </a>
          }
        >
          <EventList events={data.recent} />
        </Card>
      </div>
    </>
  );
}

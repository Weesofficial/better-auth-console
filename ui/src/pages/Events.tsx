import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, useLoad, type SecurityEvent } from "../api";
import { EventList } from "../EventList";
import { EVENT_GROUPS } from "../format";
import { href, navigate } from "../router";
import { Button, Card, cx, ErrorNote, Field, inputClass, PageTitle, Spinner } from "../ui";

type Page = { events: SecurityEvent[]; next: string | null };
const FILTERS = ["type", "identifier", "ip", "userId"] as const;

export function Events({ params }: { params: URLSearchParams }) {
  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ""])) as Record<(typeof FILTERS)[number], string>;
  const key = FILTERS.map((k) => filters[k]).join("|");
  const [identifier, setIdentifier] = useState(filters.identifier);
  const [ip, setIp] = useState(filters.ip);
  useEffect(() => {
    setIdentifier(filters.identifier);
    setIp(filters.ip);
  }, [filters.identifier, filters.ip]);

  const { data, error, loading, reload } = useLoad(() => api.get<Page>("events", { ...filters, limit: 50 }), key);
  // Older pages, appended by "Load more"; cleared whenever the filters change.
  const [more, setMore] = useState<Page | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<Error | null>(null);
  useEffect(() => setMore(null), [key, data]);

  const go = (next: Partial<typeof filters>) => navigate("/events", { ...filters, ...next });
  const events = data ? [...data.events, ...(more?.events ?? [])] : [];
  const cursor = more ? more.next : data?.next;

  const loadMore = async () => {
    if (!cursor) return;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const page = await api.get<Page>("events", { ...filters, before: cursor, limit: 50 });
      setMore((m) => ({ events: [...(m?.events ?? []), ...page.events], next: page.next }));
    } catch (e) {
      setMoreError(e as Error);
    } finally {
      setMoreBusy(false);
    }
  };

  return (
    <>
      <PageTitle sub="Newest first. Emails and phone numbers are matched by their hash; shield never stores them in events.">Events</PageTitle>
      <form
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          go({ identifier: identifier.trim(), ip: ip.trim() });
        }}
      >
        <Field label="Type">
          <select className={inputClass} value={filters.type} onChange={(e) => go({ type: e.target.value })}>
            {EVENT_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Email, username or phone">
          <input className={inputClass} type="search" value={identifier} maxLength={320} onChange={(e) => setIdentifier(e.target.value)} />
        </Field>
        <Field label="IP address">
          <input className={cx(inputClass, "font-mono")} type="search" value={ip} maxLength={64} onChange={(e) => setIp(e.target.value)} />
        </Field>
        <Button type="submit" className="h-9">
          Filter
        </Button>
      </form>
      {filters.userId && (
        <p className="mb-3 flex items-center gap-2 text-xs text-muted">
          Showing one user:{" "}
          <a className="text-accent hover:underline" href={href(`/users/${encodeURIComponent(filters.userId)}`)}>
            open profile
          </a>
          <button
            type="button"
            onClick={() => go({ userId: "" })}
            className="inline-flex items-center gap-0.5 hover:text-ink"
            aria-label="Show all users"
          >
            <X className="size-3.5" aria-hidden /> clear
          </button>
        </p>
      )}

      {error && !data ? (
        <ErrorNote error={error} onRetry={reload} />
      ) : !data ? (
        <Spinner />
      ) : (
        <Card className={cx(loading && "opacity-60")}>
          <EventList events={events} empty={key.replace(/\|/g, "") ? "No events match these filters." : "No events yet."} />
          {(cursor || moreError) && (
            <footer className="flex items-center justify-center gap-3 border-t border-line px-4 py-2">
              {moreError && <ErrorNote error={moreError} />}
              {cursor && (
                <Button variant="ghost" busy={moreBusy} onClick={loadMore}>
                  Load older events
                </Button>
              )}
            </footer>
          )}
        </Card>
      )}
    </>
  );
}

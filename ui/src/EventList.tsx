import type { SecurityEvent } from "./api";
import { ago, dateTime, device, eventDetail, eventLabel, eventTone } from "./format";
import { href } from "./router";
import { Empty, ToneIcon } from "./ui";

export function EventList({ events, showUser = true, empty = "No events yet." }: { events: SecurityEvent[]; showUser?: boolean; empty?: string }) {
  if (!events.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-line">
      {events.map((event) => {
        const detail = eventDetail(event);
        const actor = typeof event.metadata?.actorId === "string" ? event.metadata.actorId : null;
        return (
          <li key={event.id} className="flex gap-3 px-4 py-2.5">
            <ToneIcon tone={eventTone(event.type)} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium">{eventLabel(event.type)}</span>
                <time className="text-xs text-faint" dateTime={event.createdAt} title={dateTime(event.createdAt)}>
                  {ago(event.createdAt)}
                </time>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                {detail && <span>{detail}</span>}
                {event.ip && (
                  <a className="font-mono hover:text-ink hover:underline" href={href("/events", { ip: event.ip })}>
                    {event.ip}
                  </a>
                )}
                {event.userAgent && <span>{device(event.userAgent)}</span>}
                {showUser && event.userId && (
                  <a className="hover:text-ink hover:underline" href={href(`/users/${encodeURIComponent(event.userId)}`)}>
                    View user
                  </a>
                )}
                {actor && (
                  <a className="hover:text-ink hover:underline" href={href(`/users/${encodeURIComponent(actor)}`)}>
                    By admin
                  </a>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

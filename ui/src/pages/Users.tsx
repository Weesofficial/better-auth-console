import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api, useLoad, type Me, type UserRow } from "../api";
import { ago, dateTime, number } from "../format";
import { href, navigate } from "../router";
import { Button, Card, cx, Empty, ErrorNote, inputClass, PageTitle, Spinner, Status } from "../ui";

const PAGE = 25;

const FILTER_LABELS: Record<string, string> = {
  banned: "Banned",
  unverified: "Email not verified",
  no2fa: "No two-factor",
  passwordChangeRequired: "Must change password",
};

export function UserStatus({ user }: { user: Partial<UserRow> }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {user.banned && <Status tone="bad">Banned</Status>}
      {user.passwordChangeRequired && <Status tone="warn">Must change password</Status>}
      {user.emailVerified === false && <Status tone="neutral">Unverified</Status>}
      {user.twoFactorEnabled && <Status tone="good">Two-factor</Status>}
      {user.role && user.role !== "user" && <Status tone="neutral">{user.role}</Status>}
    </span>
  );
}

export function Users({ me, params }: { me: Me; params: URLSearchParams }) {
  const q = params.get("q") ?? "";
  const filter = params.get("filter") ?? "";
  const page = Math.max(0, Number(params.get("page")) || 0);
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const { data, error, loading, reload } = useLoad(
    () => api.get<{ users: UserRow[]; total: number }>("users", { q, filter, offset: page * PAGE, limit: PAGE }),
    `${q}|${filter}|${page}`,
  );
  const go = (next: { q?: string; filter?: string; page?: number }) =>
    navigate("/users", { q: next.q ?? q, filter: next.filter ?? filter, page: next.page || undefined });

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const searchHint = ["email", "name", me.features.username && "username", me.features.phoneNumber && "phone", "user ID"].filter(Boolean).join(", ");

  return (
    <>
      <PageTitle sub={data ? `${number(data.total)} ${q || filter ? "matching" : "in total"}` : undefined}>Users</PageTitle>
      <form
        className="mb-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: draft.trim(), page: 0 });
        }}
        role="search"
      >
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Search by ${searchHint}`}
            aria-label="Search users"
            className={cx(inputClass, "pl-9")}
          />
        </div>
        <Button type="submit">Search</Button>
      </form>
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter">
        {["", ...me.filters].map((id) => (
          <button
            key={id || "all"}
            type="button"
            aria-pressed={filter === id}
            onClick={() => go({ filter: id, page: 0 })}
            className={cx(
              "h-7 rounded-full border px-3 text-xs font-medium",
              filter === id ? "border-ink bg-ink text-page" : "border-line bg-panel text-muted hover:text-ink",
            )}
          >
            {id ? (FILTER_LABELS[id] ?? id) : "All"}
          </button>
        ))}
      </div>

      {error && !data ? (
        <ErrorNote error={error} onRetry={reload} />
      ) : !data ? (
        <Spinner />
      ) : (
        <Card className={cx(loading && "opacity-60")}>
          {!data.users.length ? (
            <Empty>{q ? `No users match “${q}”.` : "No users here."}</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium whitespace-nowrap">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.users.map((u) => (
                    <tr key={u.id} className="hover:bg-sunken">
                      <td className="max-w-0 px-4 py-2.5 sm:w-1/2">
                        <a href={href(`/users/${encodeURIComponent(u.id)}`)} className="block min-w-48">
                          <span className="block truncate font-medium hover:underline">{u.name || u.email}</span>
                          <span className="block truncate text-xs text-muted">
                            {u.email}
                            {u.username ? ` · @${u.username}` : ""}
                          </span>
                        </a>
                      </td>
                      <td className="px-4 py-2.5">
                        <UserStatus user={u} />
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap text-muted" title={dateTime(u.createdAt)}>
                        {ago(u.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <footer className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
              <span>
                Page {page + 1} of {number(pages)}
              </span>
              <span className="flex gap-1">
                <Button variant="ghost" disabled={page === 0} onClick={() => go({ page: page - 1 })} aria-label="Previous page">
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <Button variant="ghost" disabled={page + 1 >= pages} onClick={() => go({ page: page + 1 })} aria-label="Next page">
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </span>
            </footer>
          )}
        </Card>
      )}
    </>
  );
}

import { useEffect, useState } from "react";

/** Hash routes (`#/users/abc?tab=x`), so the server serves one page at one path. */
function parse() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path = "/", query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const update = () => setRoute(parse());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

export function href(path: string, params: Record<string, string | number | undefined> = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") query.set(k, String(v));
  const qs = query.toString();
  return `#${path}${qs ? `?${qs}` : ""}`;
}

export const navigate = (path: string, params?: Record<string, string | number | undefined>) => {
  window.location.hash = href(path, params).slice(1);
};

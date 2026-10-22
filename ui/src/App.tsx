import { Activity, LayoutDashboard, Moon, Shield, Sun, Users as UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api, STEP_UP_EVENT, useLoad, type Me } from "./api";
import { Events } from "./pages/Events";
import { Overview } from "./pages/Overview";
import { UserPage } from "./pages/User";
import { Users } from "./pages/Users";
import { href, useRoute } from "./router";
import { StepUp } from "./StepUp";
import { cx, ErrorNote, Spinner } from "./ui";

type Theme = "light" | "dark";

function storedTheme(): Theme {
  try {
    const saved = localStorage.getItem("console-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage can be blocked; fall back to the system setting.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  // Remember only a choice the admin made, so the system setting keeps applying until then.
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("console-theme", next);
    } catch {
      // Not remembered; fine.
    }
  };
  return [theme, toggle] as const;
}

const NAV = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/users", label: "Users", icon: UsersIcon },
  { path: "/events", label: "Events", icon: Activity },
];

export function App() {
  const me = useLoad(() => api.get<Me>("me"), "me");
  const [theme, toggleTheme] = useTheme();
  const [needStepUp, setNeedStepUp] = useState(false);
  const route = useRoute();

  useEffect(() => {
    const ask = () => setNeedStepUp(true);
    window.addEventListener(STEP_UP_EVENT, ask);
    return () => window.removeEventListener(STEP_UP_EVENT, ask);
  }, []);

  if (me.loading && !me.data) return <Spinner />;
  if (!me.data) {
    return (
      <div className="mx-auto mt-[12vh] max-w-md px-4">
        <ErrorNote error={me.error ?? new Error("Couldn't load the console.")} onRetry={me.reload} />
      </div>
    );
  }

  if (!me.data.steppedUp || needStepUp) {
    return (
      <StepUp
        me={me.data}
        onDone={() => {
          setNeedStepUp(false);
          me.reload();
        }}
      />
    );
  }

  const section = "/" + (route.path.split("/")[1] ?? "");
  const userId = route.path.startsWith("/users/") ? decodeURIComponent(route.path.slice("/users/".length)) : null;

  return (
    <div className="min-h-screen md:flex">
      <aside className="flex items-center gap-1 border-b border-line bg-panel px-3 py-2 md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-4">
        <a href="#/" className="mr-2 flex items-center gap-2 px-2 font-semibold md:mr-0 md:mb-5">
          <Shield className="size-5 text-accent" aria-hidden />
          <span className="hidden sm:inline">Console</span>
        </a>
        <nav className="flex gap-1 md:flex-col" aria-label="Sections">
          {NAV.map(({ path, label, icon: Icon }) => {
            const active = section === path;
            return (
              <a
                key={path}
                href={href(path)}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex h-8 items-center gap-2 rounded-md px-2 text-sm",
                  active ? "bg-sunken font-medium text-ink" : "text-muted hover:bg-sunken hover:text-ink",
                )}
              >
                <Icon className={cx("size-4", active ? "text-accent" : "text-faint")} aria-hidden />
                {label}
              </a>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:mt-auto md:ml-0 md:flex-col md:items-stretch md:gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted hover:bg-sunken hover:text-ink"
            aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
          >
            {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
            <span className="hidden md:inline">{theme === "dark" ? "Light" : "Dark"} theme</span>
          </button>
          <div className="hidden min-w-0 px-2 text-xs md:block">
            <div className="truncate text-ink">{me.data.user.name || me.data.user.email}</div>
            <div className="truncate text-faint">{me.data.user.email}</div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl">
          {userId ? (
            <UserPage key={userId} id={userId} me={me.data} />
          ) : section === "/users" ? (
            <Users me={me.data} params={route.params} />
          ) : section === "/events" ? (
            <Events params={route.params} />
          ) : (
            <Overview />
          )}
        </div>
      </main>
    </div>
  );
}

import { ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, AUTH_BASE, request, type Me } from "./api";
import { Button, Field, inputClass } from "./ui";

/** Asks the admin to prove it's them: password, or an authenticator code if they have two-factor. */
export function StepUp({ me, onDone }: { me: Me; onDone: () => void }) {
  const [method, setMethod] = useState<"password" | "totp">("password");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (method === "password") await request(`${AUTH_BASE}/shield/step-up`, { password: value });
      else await request(`${AUTH_BASE}/two-factor/verify-totp`, { code: value.replace(/\s/g, "") });
      setValue("");
      onDone();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(
        code === "ACCOUNT_LOCKED"
          ? "Too many wrong tries. Wait a while, or ask another admin to unlock you."
          : code === "NO_PASSWORD"
            ? "Your account has no password. Use an authenticator code instead."
            : method === "password"
              ? "That password isn't right."
              : "That code isn't right.",
      );
    } finally {
      setBusy(false);
    }
  }

  const minutes = me.stepUp ? Math.round(me.stepUp.maxAge / 60) : 0;
  return (
    <div className="mx-auto mt-[12vh] w-full max-w-sm px-4">
      <ShieldCheck className="size-8 text-accent" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Confirm it's you</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as <span className="text-ink">{me.user.email}</span>. The console stays open for {minutes} minutes after you confirm.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {method === "password" ? (
          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={inputClass}
            />
          </Field>
        ) : (
          <Field label="Authenticator code">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              pattern="[0-9 ]{6,8}"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}
        {error && (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" busy={busy} className="w-full">
          Continue
        </Button>
      </form>
      {me.features.twoFactorEnabled && (
        <button
          type="button"
          className="mt-4 text-sm text-accent hover:underline"
          onClick={() => {
            setMethod(method === "password" ? "totp" : "password");
            setValue("");
            setError(null);
          }}
        >
          {method === "password" ? "Use an authenticator code" : "Use your password"}
        </button>
      )}
    </div>
  );
}

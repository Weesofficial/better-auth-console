import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Tone } from "./format";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const BUTTONS = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  danger: "bg-bad text-white hover:opacity-90 dark:text-black",
  plain: "border border-line bg-panel text-ink hover:bg-sunken",
  ghost: "text-muted hover:text-ink hover:bg-sunken",
};

export function Button({
  variant = "plain",
  busy,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTONS; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50",
        BUTTONS[variant],
        className,
      )}
    >
      {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const TONES: Record<Tone, string> = {
  good: "text-good",
  bad: "text-bad",
  warn: "text-warn",
  neutral: "text-muted",
};

export const toneText = (tone: Tone) => TONES[tone];

/** A status word with a coloured dot, no filled pill. */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium", TONES[tone])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

export function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  const Icon = tone === "good" ? CheckCircle2 : tone === "bad" ? XCircle : tone === "warn" ? AlertTriangle : Circle;
  return <Icon className={cx("size-4 shrink-0", TONES[tone], className)} aria-hidden />;
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-line bg-panel", className)}>
      {(title || action) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageTitle({ children, sub, action }: { children: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{children}</h1>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-muted">{children}</p>;
}

export function ErrorNote({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 text-sm" role="alert">
      <XCircle className="size-4 text-bad" aria-hidden />
      <span className="min-w-0 flex-1">{error.message}</span>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-xs break-all", className)}>{children}</span>;
}

/** A modal on the native <dialog>: focus trap, Escape and backdrop for free. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-panel p-0 text-ink shadow-xl"
    >
      {open && (
        <div className="p-5">
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="mt-3 text-sm text-muted">{children}</div>
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-9 w-full rounded-md border border-line bg-panel px-3 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none";

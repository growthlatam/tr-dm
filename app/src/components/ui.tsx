"use client";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Loader2, X } from "lucide-react";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};
export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...p }: BtnProps) {
  const v = {
    primary: "bg-accent text-on-accent hover:opacity-90",
    secondary: "bg-surface-raised text-text border border-border-input hover:bg-surface",
    ghost: "text-text hover:bg-surface",
    danger: "bg-danger text-white hover:opacity-90",
  }[variant];
  const s = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" }[size];
  return (
    <button
      {...p}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed",
        v,
        s,
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Badge({ tone = "muted", children }: { tone?: "muted" | "success" | "warning" | "info" | "danger"; children: ReactNode }) {
  const t = {
    muted: "bg-surface text-text-muted border-border",
    success: "bg-success-soft text-success border-transparent",
    warning: "bg-warning-soft text-warning border-transparent",
    info: "bg-info-soft text-info border-transparent",
    danger: "bg-danger-soft text-danger border-transparent",
  }[tone];
  return <span className={cx("inline-flex items-center rounded-pill border px-2 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-fast disabled:opacity-50",
          checked ? "bg-accent" : "bg-border-input",
        )}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-pill bg-white transition-all duration-fast", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </label>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const inputBase =
  "w-full rounded-md border border-border-input bg-bg px-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-accent disabled:opacity-60";
export function Input({ invalid, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...p} aria-invalid={invalid || undefined} className={cx(inputBase, "h-10", invalid && "border-danger", className)} />;
}
export function Textarea({ invalid, className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea {...p} aria-invalid={invalid || undefined} className={cx(inputBase, "py-2 leading-5", invalid && "border-danger", className)} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-lg border border-border bg-surface-raised shadow-card", className)}>{children}</div>;
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div aria-hidden className="grid h-14 w-14 place-items-center rounded-pill bg-accent-soft text-accent text-2xl font-bold">
        ·
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-text-muted">{text}</p>
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, closeLabel }: { open: boolean; onClose: () => void; title: string; children: ReactNode; closeLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-bg shadow-pop outline-none">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          <button onClick={onClose} aria-label={closeLabel} className="grid h-8 w-8 place-items-center rounded-md hover:bg-surface">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; dot?: boolean }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={cx(
            "relative h-8 rounded-sm px-3 text-sm font-medium transition-colors duration-fast",
            value === i.value ? "bg-bg shadow-card text-text" : "text-text-muted hover:text-text",
          )}
        >
          {i.label}
          {i.dot && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-pill bg-warning" />}
        </button>
      ))}
    </div>
  );
}

export function timeAgo(t: number, tr: (k: "common.now" | "common.minutes", v?: Record<string, number>) => string, lang: string) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return tr("common.now");
  if (m < 60) return tr("common.minutes", { n: m });
  return new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(t);
}

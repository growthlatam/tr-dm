"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Account, Portfolio } from "@/lib/store";
import { cx } from "./ui";

/** Round profile picture of an account. Falls back to the first letter while it loads or if Meta has none. */
export function Avatar({ account, size = 28 }: { account: Pick<Account, "id" | "username">; size?: number }) {
  const [bad, setBad] = useState(false);
  return (
    <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft text-xs font-semibold uppercase text-accent" style={{ width: size, height: size }} aria-hidden>
      {account.username.slice(0, 1)}
      {!bad && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/channels/${account.id}/avatar`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} className="absolute inset-0 h-full w-full object-cover" />
      )}
    </span>
  );
}

/** A listbox that shows each account with its picture (the browser's own select cannot show images). Keyboard: arrows, Enter, Escape. */
export function AccountPicker({ accounts, portfolios, value, onChange, label }: { accounts: Account[]; portfolios: Portfolio[]; value: string | null; onChange: (id: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  // options in the order they are shown: grouped by connection
  const groups = [...portfolios.map((p) => ({ key: p.id, name: p.name })), { key: "", name: "—" }]
    .map((g) => ({ ...g, list: accounts.filter((a) => (a.portfolioId ?? "") === g.key) }))
    .filter((g) => g.list.length);
  const flat = groups.flatMap((g) => g.list);
  const cur = accounts.find((a) => a.id === value) ?? flat[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function pick(a: Account) {
    onChange(a.id);
    setOpen(false);
  }
  function onKey(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setActive(Math.max(0, flat.findIndex((a) => a.id === cur?.id)));
      setOpen(true);
    } else if (open) {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowDown") (e.preventDefault(), setActive((i) => Math.min(flat.length - 1, i + 1)));
      else if (e.key === "ArrowUp") (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
      else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), flat[active] && pick(flat[active]));
    }
  }
  if (!cur) return null;
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={label}
        onClick={() => (setActive(Math.max(0, flat.findIndex((a) => a.id === cur.id))), setOpen(!open))}
        onKeyDown={onKey}
        className="flex h-11 w-full items-center gap-2 rounded-md border border-border-input bg-bg px-2 text-left text-sm"
      >
        <Avatar account={cur} />
        <span className="min-w-0 flex-1 truncate">@{cur.username}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
      </button>
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label={label} className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-bg py-1 shadow-pop">
          {groups.map((g) => (
            <li key={g.key || "none"} role="presentation">
              <div className="px-3 pb-1 pt-2 text-xs font-medium text-text-muted">{g.name}</div>
              <ul role="group" aria-label={g.name}>
                {g.list.map((a) => {
                  const i = flat.indexOf(a);
                  return (
                    <li
                      key={a.id}
                      role="option"
                      aria-selected={a.id === cur.id}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(a)}
                      className={cx("flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm", i === active && "bg-surface")}
                    >
                      <Avatar account={a} />
                      <span className="min-w-0 flex-1 truncate">@{a.username}</span>
                      {a.id === cur.id && <Check className="h-4 w-4 text-accent" aria-hidden />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

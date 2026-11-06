"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Home, Users, Workflow, Inbox, Settings, Menu, X, LogOut, Shield } from "lucide-react";
import { LANGS, useI18n, type Key } from "@/lib/i18n";
import { dismissNotice, selectAccount, selectOrg, useHydrated, useNotice, useStore } from "@/lib/store";
import { useSyncFailed } from "@/lib/remote";
import { remoteEnabled, supabase } from "@/lib/supabase/client";
import { Button, Modal, cx } from "./ui";

const BARE = ["/login", "/auth", "/privacy", "/data-deletion"];

const NAV: { href: string; key: Key; icon: typeof Home }[] = [
  { href: "/", key: "nav.home", icon: Home },
  { href: "/contacts", key: "nav.contacts", icon: Users },
  { href: "/automations", key: "nav.automations", icon: Workflow },
  { href: "/inbox", key: "nav.inbox", icon: Inbox },
  { href: "/settings", key: "nav.settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const { conversations, workspaces, accounts, portfolios, activeOrg, activeAccount } = useStore();
  const ready = useHydrated();
  const syncFailed = useSyncFailed();
  const notice = useNotice();
  const unread = conversations.reduce((n, c) => n + (c.state === "open" ? c.unread : 0), 0);
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!remoteEnabled) return;
    supabase().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    fetch("/api/admin?me=1").then((r) => setIsAdmin(r.ok)).catch(() => {});
  }, []);
  if (BARE.some((p) => path === p || path.startsWith(p + "/"))) return <>{children}</>;

  const nav = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1 p-3">
      {NAV.map(({ href, key, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-fast",
              active ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface hover:text-text",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span className="flex-1">{t(key)}</span>
            {href === "/inbox" && unread > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-pill bg-signature px-1.5 text-xs font-semibold text-on-signature" aria-label={`${unread} unread`}>
                {unread}
              </span>
            )}
          </Link>
        );
      })}
      {isAdmin && (
        <Link
          href="/admin"
          onClick={() => setOpen(false)}
          aria-current={path.startsWith("/admin") ? "page" : undefined}
          className={cx("flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-fast", path.startsWith("/admin") ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface hover:text-text")}
        >
          <Shield className="h-5 w-5" aria-hidden />
          <span className="flex-1">{t("nav.admin")}</span>
        </Link>
      )}
    </nav>
  );

  const side = (
    <>
      <div className="flex h-header items-center gap-2 border-b border-border px-4">
        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-md bg-accent text-sm font-bold text-on-accent">
          DM
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold">{t("app.name")}</div>
          <div className="text-xs text-text-muted">{t("app.org")}</div>
        </div>
      </div>
      {remoteEnabled && ready && (
        <div className="space-y-2 border-b border-border p-3">
          {workspaces.length > 1 && (
            <div>
              <label htmlFor="ws-sel" className="mb-1 block text-xs font-medium text-text-muted">
                {t("switch.ws")}
              </label>
              <select id="ws-sel" value={activeOrg ?? ""} onChange={(e) => selectOrg(e.target.value)} className="h-9 w-full rounded-md border border-border-input bg-bg px-2 text-sm">
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="acct-sel" className="mb-1 block text-xs font-medium text-text-muted">
              {t("switch.acct")}
            </label>
            {accounts.length === 0 ? (
              <p className="text-xs text-text-muted">{t("switch.none")}</p>
            ) : (
              <select id="acct-sel" value={activeAccount ?? ""} onChange={(e) => selectAccount(e.target.value)} className="h-9 w-full rounded-md border border-border-input bg-bg px-2 text-sm">
                {[...portfolios, { id: "", name: "—", orgId: "" }].map((p) => {
                  const list = accounts.filter((a) => (a.portfolioId ?? "") === p.id);
                  if (!list.length) return null;
                  return (
                    <optgroup key={p.id || "none"} label={p.name}>
                      {list.map((a) => (
                        <option key={a.id} value={a.id}>
                          @{a.username}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            )}
          </div>
        </div>
      )}
      {nav}
      <div className="border-t border-border p-3">
        {remoteEnabled && email && (
          <form action="/auth/signout" method="post" className="mb-3 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-text-muted" title={email}>
              {email}
            </span>
            <button type="submit" aria-label={t("auth.signout")} title={t("auth.signout")} className="grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-surface">
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </form>
        )}
        <label htmlFor="ui-lang" className="mb-1 block text-xs font-medium text-text-muted">
          {t("lang.label")}
        </label>
        <select
          id="ui-lang"
          value={lang}
          onChange={(e) => setLang(e.target.value as typeof lang)}
          className="h-9 w-full rounded-md border border-border-input bg-bg px-2 text-sm"
        >
          {LANGS.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-canvas text-text">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-bg focus:px-3 focus:py-2">
        {t("nav.skip")}
      </a>
      <aside className="sticky top-0 hidden h-screen w-sidebar shrink-0 flex-col border-r border-border bg-bg lg:flex">{side}</aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-header items-center gap-3 border-b border-border bg-bg px-4 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label={t("nav.menu")} className="grid h-10 w-10 place-items-center rounded-md hover:bg-surface">
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <span className="text-sm font-semibold">{t("app.name")}</span>
        </header>
        {syncFailed && (
          <p role="alert" className="bg-danger-soft px-4 py-2 text-sm text-danger">
            {t("sync.error")}
          </p>
        )}
        <main id="main" className="min-w-0 flex-1">
          {!ready ? (
            <p role="status" className="p-8 text-sm text-text-muted">{t("sync.setup")}</p>
          ) : remoteEnabled && workspaces.length === 0 && !path.startsWith("/admin") ? (
            <div className="mx-auto max-w-lg p-8">
              <h1 className="mb-2 text-xl font-semibold">{t("ws.none.t")}</h1>
              <p className="text-sm text-text-muted">{t("ws.none.d")}</p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      <Modal open={!!notice} onClose={dismissNotice} title={notice?.ok ? t("pub.ok.t") : t("pub.fail.t")} closeLabel={t("common.close")}>
        <p role="status" className="mb-5 text-sm">
          {notice?.ok ? t("pub.ok.d", { name: notice.name, account: notice.account ? t("pub.on", { account: notice.account }) : "" }) : t("pub.fail.d")}
        </p>
        <div className="flex justify-end">
          <Button onClick={dismissNotice}>{t("pub.ok")}</Button>
        </div>
      </Modal>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-bg shadow-pop">
            <button onClick={() => setOpen(false)} aria-label={t("common.close")} className="absolute right-2 top-3 grid h-8 w-8 place-items-center rounded-md hover:bg-surface">
              <X className="h-4 w-4" aria-hidden />
            </button>
            {side}
          </div>
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4 pt-6 sm:px-8">
      <h1 className="text-xl font-bold">{title}</h1>
      {actions}
    </div>
  );
}

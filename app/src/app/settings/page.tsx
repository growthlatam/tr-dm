"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n, type Key } from "@/lib/i18n";
import { reloadStore, useHydrated, useStore } from "@/lib/store";
import { Badge, Button, Card } from "@/components/ui";
import { PageHeader } from "@/components/shell";
import { remoteEnabled, supabase } from "@/lib/supabase/client";
import { Input } from "@/components/ui";

const ROLES = ["owner", "admin", "editor", "agent", "viewer"] as const;

export default function SettingsPage() {
  const { t } = useI18n();
  const { team } = useStore();
  const [role, setRole] = useState<(typeof ROLES)[number]>("editor");
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-content pb-12">
      <PageHeader title={t("settings.title")} />
      <div className="space-y-8 px-4 sm:px-8">
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">{t("settings.demo")}</p>

        {remoteEnabled ? (
          <Suspense>
            <ChannelsSection />
          </Suspense>
        ) : (
          <section aria-labelledby="channels">
          <h2 id="channels" className="mb-3 text-lg font-semibold">
            {t("settings.channels")}
          </h2>
          <Card className="divide-y divide-border">
            {(["settings.channel.ig", "settings.channel.msgr"] as Key[]).map((k, i) => (
              <div key={k} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="font-medium">{t(k)}</span>
                <span className="flex items-center gap-2 text-sm text-text-muted">
                  {i === 0 ? <Badge tone="success">{t("settings.channel.status")}</Badge> : <Badge>{t("settings.channel.todo")}</Badge>}
                </span>
              </div>
            ))}
          </Card>
        </section>
        )}

        <section aria-labelledby="team">
          <h2 id="team" className="mb-3 text-lg font-semibold">
            {t("settings.team")}
          </h2>
          <Card className="mb-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <tbody>
                {team.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{m.name}</td>
                    <td className="px-4 py-3 text-text-muted">{m.email}</td>
                    <td className="px-4 py-3">
                      <Badge tone="info">{t(`settings.role.${m.role}` as Key)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="max-w-xl space-y-3 p-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 font-semibold">{t("settings.invite")}</legend>
              {ROLES.filter((r) => r !== "owner").map((r) => (
                <label key={r} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
                  <span>
                    <span className="font-medium">{t(`settings.role.${r}` as Key)}</span>
                    <span className="block text-xs text-text-muted">{t(`settings.role.${r}.d` as Key)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Button onClick={() => setLink(`https://app.example.com/invite/${role}-${Math.random().toString(36).slice(2, 8)}`)}>{t("settings.invite.link")}</Button>
            {link && (
              <p role="status" className="break-all text-sm">
                <span className="text-success">{t("settings.invite.copied")}: </span>
                <span className="font-mono">{link}</span>
              </p>
            )}
          </Card>
        </section>

        {remoteEnabled && <AccountSection />}
      </div>
    </div>
  );
}

function AccountSection() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [mine, setMine] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  useEffect(() => {
    supabase().auth.getUser().then(({ data }) => setMine(data.user?.email ?? ""));
  }, []);
  async function del() {
    setBusy(true);
    setErr(false);
    const r = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    if (r.ok) {
      window.location.href = "/login";
      return;
    }
    setBusy(false);
    setErr(true);
  }
  return (
    <section aria-labelledby="account">
      <h2 id="account" className="mb-3 text-lg font-semibold">
        {t("auth.account")}
      </h2>
      <Card className="max-w-xl space-y-3 p-4">
        <p className="text-sm text-text-muted">{t("auth.delete.d")}</p>
        <label className="block text-sm font-medium" htmlFor="del-email">
          {t("auth.delete.confirm")}
        </label>
        <Input id="del-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={mine} />
        {err && (
          <p role="alert" className="text-sm text-danger">
            {t("auth.delete.err")}
          </p>
        )}
        <Button variant="danger" disabled={!mine || email.trim().toLowerCase() !== mine.toLowerCase()} loading={busy} onClick={del}>
          {t("auth.delete.go")}
        </Button>
      </Card>
    </section>
  );
}

function ChannelsSection() {
  const { t } = useI18n();
  const q = useSearchParams();
  const { accounts, portfolios, workspaces, activeOrg } = useStore();
  const ready = useHydrated();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const err = q.get("connect_error");
  const mayConnect = ["owner", "admin", "editor"].includes(workspaces.find((w) => w.id === activeOrg)?.role ?? "");
  async function disconnect(id: string) {
    if (!window.confirm(t("settings.ch.confirm"))) return;
    setBusy(id);
    await fetch(`/api/channels/${id}/disconnect`, { method: "POST" });
    setBusy(null);
    reloadStore();
  }
  const base = `/api/channels/instagram/start?org=${activeOrg ?? ""}`;
  const loose = accounts.filter((a) => !a.portfolioId);
  const row = (c: (typeof accounts)[number]) => (
    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
      <div className="min-w-0 truncate font-medium">Instagram · @{c.username}</div>
      <div className="flex items-center gap-2">
        <Badge tone={c.status === "connected" ? "success" : "warning"}>{t(`settings.ch.status.${c.status}` as Key)}</Badge>
        {mayConnect && (
          <Button variant="ghost" size="sm" loading={busy === c.id} onClick={() => disconnect(c.id)}>
            {t("settings.ch.disconnect")}
          </Button>
        )}
      </div>
    </div>
  );
  return (
    <section aria-labelledby="channels">
      <h2 id="channels" className="mb-3 text-lg font-semibold">
        {t("settings.channels")}
      </h2>
      {q.get("connected") && (
        <p role="status" className="mb-3 rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          {t("settings.ch.ok")}
        </p>
      )}
      {err && (
        <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {t(`settings.ch.err.${["denied", "state", "forbidden", "other_workspace", "not_configured", "name"].includes(err) ? err : "failed"}` as Key)}
        </p>
      )}
      <div className="space-y-4">
        {!ready && <p className="text-sm text-text-muted">{t("common.loading")}</p>}
        {ready && portfolios.length === 0 && loose.length === 0 && <p className="text-sm text-text-muted">{t("settings.ch.none")}</p>}
        {portfolios.map((p) => {
          const list = accounts.filter((a) => a.portfolioId === p.id);
          return (
            <Card key={p.id} className="divide-y divide-border">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <h3 className="font-semibold">{p.name}</h3>
                {mayConnect && (
                  <a href={`${base}&connection=${p.id}`}>
                    <Button variant="secondary" size="sm">
                      {t("settings.ch.pf.add")}
                    </Button>
                  </a>
                )}
              </div>
              {list.length === 0 && <p className="px-4 py-2 text-sm text-text-muted">{t("settings.ch.pf.empty")}</p>}
              {list.map(row)}
            </Card>
          );
        })}
        {loose.length > 0 && <Card className="divide-y divide-border">{loose.map(row)}</Card>}
        {mayConnect && (
          <Card className="space-y-3 p-4">
            <p className="text-sm font-medium">{t("settings.ch.pf.new")}</p>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) window.location.href = `${base}&name=${encodeURIComponent(name.trim())}`;
              }}
            >
              <div className="min-w-[14rem] flex-1">
                <label htmlFor="pf-name" className="mb-1 block text-xs font-medium text-text-muted">
                  {t("settings.ch.pf.name")}
                </label>
                <Input id="pf-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("settings.ch.pf.ph")} />
              </div>
              <Button type="submit" disabled={!name.trim()}>
                {t("settings.ch.pf.go")}
              </Button>
            </form>
            <p className="text-xs text-text-muted">{t("settings.ch.pf.how")}</p>
          </Card>
        )}
      </div>
    </section>
  );
}

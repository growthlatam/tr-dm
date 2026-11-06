"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n, type Key } from "@/lib/i18n";
import { useStore } from "@/lib/store";
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

type Chan = { id: string; channel: string; display_name: string; status: string; token_expires_at: string | null };

function ChannelsSection() {
  const { t } = useI18n();
  const q = useSearchParams();
  const [list, setList] = useState<Chan[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => supabase().from("channel_accounts").select("id,channel,display_name,status,token_expires_at").neq("status", "disconnected").order("created_at").then(({ data }) => setList((data as Chan[]) ?? []));
  useEffect(() => {
    load();
  }, []);
  const err = q.get("connect_error");
  async function disconnect(id: string) {
    if (!window.confirm(t("settings.ch.confirm"))) return;
    setBusy(id);
    await fetch(`/api/channels/${id}/disconnect`, { method: "POST" });
    setBusy(null);
    load();
  }
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
          {t(`settings.ch.err.${["denied", "state", "forbidden", "other_workspace", "not_configured"].includes(err) ? err : "failed"}` as Key)}
        </p>
      )}
      <Card className="divide-y divide-border">
        {list === null && <p className="px-4 py-3 text-sm text-text-muted">{t("common.loading")}</p>}
        {list?.length === 0 && <p className="px-4 py-3 text-sm text-text-muted">{t("settings.ch.none")}</p>}
        {list?.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate font-medium">
                {c.channel === "instagram" ? "Instagram" : "Messenger"} · @{c.display_name}
              </div>
              {c.token_expires_at && <div className="text-xs text-text-muted">{t("settings.ch.valid", { date: new Date(c.token_expires_at).toLocaleDateString() })}</div>}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={c.status === "connected" ? "success" : "warning"}>{t(`settings.ch.status.${c.status}` as Key)}</Badge>
              <Button variant="ghost" size="sm" loading={busy === c.id} onClick={() => disconnect(c.id)}>
                {t("settings.ch.disconnect")}
              </Button>
            </div>
          </div>
        ))}
        <div className="px-4 py-3">
          <p className="mb-2 text-sm font-medium">{t("settings.ch.connect")}</p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/channels/instagram/start?mode=portfolio">
              <Button variant="secondary">{t("settings.ch.connect.portfolio")}</Button>
            </a>
            <a href="/api/channels/instagram/start?mode=instagram">
              <Button variant="secondary">{t("settings.ch.connect.instagram")}</Button>
            </a>
          </div>
          <p className="mt-2 text-xs text-text-muted">{t("settings.ch.connect.hint")}</p>
        </div>
      </Card>
    </section>
  );
}

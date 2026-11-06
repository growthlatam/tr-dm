"use client";
import { useCallback, useEffect, useState } from "react";
import { useI18n, type Key } from "@/lib/i18n";
import { Badge, Button, Card, Input } from "@/components/ui";
import { PageHeader } from "@/components/shell";

const ROLES = ["owner", "admin", "editor", "agent", "viewer"] as const;
type Role = (typeof ROLES)[number];
type Data = {
  me: string;
  workspaces: { id: string; name: string }[];
  people: { email: string; note: string | null; user_id: string | null; last_sign_in: string | null; is_admin: boolean; memberships: { org_id: string; role: string }[] }[];
};

export default function AdminPage() {
  const { t } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [wsName, setWsName] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [em, setEm] = useState("");
  const [note, setNote] = useState("");
  const [org, setOrg] = useState("");
  const [role, setRole] = useState<Role>("editor");

  const load = useCallback(async () => {
    const r = await fetch("/api/admin");
    if (r.status === 401 || r.status === 403) return setDenied(true);
    if (!r.ok) return setMsg({ ok: false, text: t("adm.err") });
    const d = (await r.json()) as Data;
    setData(d);
    setNames(Object.fromEntries(d.workspaces.map((w) => [w.id, w.name])));
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: object): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: t("adm.err") });
      return false;
    }
    setMsg({ ok: true, text: t("adm.saved") });
    await load();
    return true;
  }

  if (denied)
    return (
      <div className="mx-auto max-w-content px-4 py-8 sm:px-8">
        <p role="alert" className="text-sm text-danger">{t("adm.denied")}</p>
      </div>
    );

  return (
    <div className="mx-auto max-w-content pb-12">
      <PageHeader title={t("adm.title")} />
      <div className="space-y-8 px-4 sm:px-8">
        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "rounded-md bg-success-soft px-3 py-2 text-sm text-success" : "rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"}>
            {msg.text}
          </p>
        )}
        {!data && !denied && <p className="text-sm text-text-muted">{t("common.loading")}</p>}

        {data && (
          <>
            <section aria-labelledby="adm-ws">
              <h2 id="adm-ws" className="mb-3 text-lg font-semibold">{t("adm.ws")}</h2>
              <Card className="divide-y divide-border">
                {data.workspaces.map((w) => (
                  <form
                    key={w.id}
                    className="flex flex-wrap items-center gap-2 px-4 py-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act({ action: "rename_workspace", org_id: w.id, name: names[w.id] ?? w.name });
                    }}
                  >
                    <Input aria-label={t("adm.ws.name")} value={names[w.id] ?? w.name} maxLength={120} onChange={(e) => setNames({ ...names, [w.id]: e.target.value })} className="min-w-[14rem] flex-1" />
                    <Button type="submit" variant="secondary" size="sm" disabled={busy || !(names[w.id] ?? "").trim() || names[w.id] === w.name}>
                      {t("adm.ws.save")}
                    </Button>
                  </form>
                ))}
                <form
                  className="flex flex-wrap items-end gap-2 px-4 py-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await act({ action: "create_workspace", name: wsName.trim() })) setWsName("");
                  }}
                >
                  <div className="min-w-[14rem] flex-1">
                    <label htmlFor="ws-new" className="mb-1 block text-xs font-medium text-text-muted">{t("adm.ws.new")}</label>
                    <Input id="ws-new" value={wsName} maxLength={120} onChange={(e) => setWsName(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={busy || !wsName.trim()}>{t("adm.ws.create")}</Button>
                </form>
              </Card>
            </section>

            <section aria-labelledby="adm-add">
              <h2 id="adm-add" className="mb-3 text-lg font-semibold">{t("adm.add")}</h2>
              <Card className="p-4">
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const ok = await act({ action: "add_user", email: em.trim().toLowerCase(), note: note.trim() || undefined, org_id: org || undefined, role: org ? role : undefined });
                    if (ok) {
                      setEm("");
                      setNote("");
                    }
                  }}
                >
                  <div>
                    <label htmlFor="adm-em" className="mb-1 block text-xs font-medium text-text-muted">{t("adm.email")}</label>
                    <Input id="adm-em" type="email" value={em} onChange={(e) => setEm(e.target.value)} autoComplete="off" />
                  </div>
                  <div>
                    <label htmlFor="adm-note" className="mb-1 block text-xs font-medium text-text-muted">{t("adm.note")}</label>
                    <Input id="adm-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="adm-org" className="mb-1 block text-xs font-medium text-text-muted">{t("adm.ws.pick")}</label>
                    <select id="adm-org" value={org} onChange={(e) => setOrg(e.target.value)} className="h-10 w-full rounded-md border border-border-input bg-bg px-2 text-sm">
                      <option value="">{t("adm.none")}</option>
                      {data.workspaces.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="adm-role" className="mb-1 block text-xs font-medium text-text-muted">{t("adm.role")}</label>
                    <select id="adm-role" value={role} disabled={!org} onChange={(e) => setRole(e.target.value as Role)} className="h-10 w-full rounded-md border border-border-input bg-bg px-2 text-sm disabled:opacity-50">
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{t(`role.${r}` as Key)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <Button type="submit" disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em.trim())}>{t("adm.add.go")}</Button>
                  </div>
                </form>
              </Card>
            </section>

            <section aria-labelledby="adm-users">
              <h2 id="adm-users" className="mb-3 text-lg font-semibold">{t("adm.users")}</h2>
              <div className="space-y-3">
                {data.people.map((p) => (
                  <Card key={p.email} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.email}</div>
                        <div className="text-xs text-text-muted">
                          {p.last_sign_in ? `${t("adm.col.last")}: ${new Date(p.last_sign_in).toLocaleString()}` : t("adm.never")}
                          {p.note ? ` · ${p.note}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.is_admin && <Badge tone="info">{t("adm.admin")}</Badge>}
                        {!p.is_admin && p.email !== data.me && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(t("adm.remove.confirm", { email: p.email }))) void act({ action: "remove_user", email: p.email });
                            }}
                          >
                            {t("adm.remove")}
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {data.workspaces.map((w) => {
                        const cur = p.memberships.find((m) => m.org_id === w.id)?.role ?? "";
                        return (
                          <label key={w.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate">{w.name}</span>
                            <select
                              aria-label={`${p.email} · ${w.name}`}
                              value={cur}
                              disabled={busy || !p.user_id}
                              onChange={(e) => p.user_id && void act({ action: "set_membership", user_id: p.user_id, org_id: w.id, role: e.target.value === "" ? null : (e.target.value as Role) })}
                              className="h-9 rounded-md border border-border-input bg-bg px-2 text-sm disabled:opacity-50"
                            >
                              <option value="">{t("adm.none")}</option>
                              {ROLES.map((r) => (
                                <option key={r} value={r}>{t(`role.${r}` as Key)}</option>
                              ))}
                            </select>
                          </label>
                        );
                      })}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

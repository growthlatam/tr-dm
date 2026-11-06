"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { copyAutomationTo, useStore } from "@/lib/store";
import { remoteEnabled } from "@/lib/supabase/client";
import { Badge, Button, Card, EmptyState, Input, timeAgo } from "@/components/ui";
import { PageHeader } from "@/components/shell";

export default function AutomationsPage() {
  const { t, lang } = useI18n();
  const { automations, accounts, activeAccount } = useStore();
  const [q, setQ] = useState("");
  const [copying, setCopying] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const others = accounts.filter((a) => a.id !== activeAccount && a.status === "connected");
  async function copy(id: string, to: string) {
    const nid = to ? await copyAutomationTo(id, to) : null;
    setCopying(null);
    setNote(nid ? t("auto.copy.done") : t("auto.copy.err"));
  }
  const list = automations.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));
  const tone = { live: "success", paused: "warning", draft: "muted" } as const;
  const newBtn = (
    <Link href="/automations/new">
      <Button>
        <Plus className="h-4 w-4" aria-hidden />
        {t("auto.new")}
      </Button>
    </Link>
  );
  return (
    <div className="mx-auto max-w-content pb-12">
      <PageHeader title={t("auto.title")} actions={newBtn} />
      <div className="px-4 sm:px-8">
        {note && (
          <p role="status" className="mb-3 rounded-md bg-surface px-3 py-2 text-sm">
            {note}
          </p>
        )}
        {automations.length === 0 ? (
          <Card>
            <EmptyState title={t("auto.empty.t")} text={t("auto.empty.d")} action={newBtn} />
          </Card>
        ) : (
          <>
            <div className="relative mb-4 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-text-muted" aria-hidden />
              <Input aria-label={t("auto.search")} placeholder={t("auto.search")} value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-border text-xs text-text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      {t("auto.col.name")}
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      {t("auto.col.runs")}
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      {t("auto.col.ctr")}
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      {t("auto.col.modified")}
                    </th>
                    {remoteEnabled && <th scope="col" className="px-4 py-3"><span className="sr-only">{t("auto.copy")}</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface">
                      <td className="px-4 py-3">
                        <Link href={`/automations/${a.id}`} className="flex items-center gap-3 font-semibold">
                          <Badge tone={tone[a.status]}>{t(`auto.status.${a.status}` as "auto.status.live")}</Badge>
                          <span className="break-words">{a.name}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">{a.stats.runs}</td>
                      <td className="px-4 py-3">{a.stats.sent ? `${Math.round((a.stats.clicked / a.stats.sent) * 100)}%` : "–"}</td>
                      <td className="px-4 py-3 text-text-muted">{timeAgo(a.modified, t, lang)}</td>
                      {remoteEnabled && (
                        <td className="px-4 py-3 text-right">
                          {copying === a.id ? (
                            <select aria-label={t("auto.copy.to")} autoFocus defaultValue="" onChange={(e) => void copy(a.id, e.target.value)} onBlur={() => setCopying(null)} className="h-9 rounded-md border border-border-input bg-bg px-2 text-sm">
                              <option value="" disabled>
                                {t("auto.copy.to")}…
                              </option>
                              {others.map((o) => (
                                <option key={o.id} value={o.id}>
                                  @{o.username}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Button variant="ghost" size="sm" disabled={others.length === 0} title={others.length === 0 ? t("auto.copy.none") : undefined} onClick={() => setCopying(a.id)}>
                              {t("auto.copy")}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {list.length === 0 && (
                    <tr>
                      <td colSpan={remoteEnabled ? 5 : 4} className="px-4 py-8 text-center text-text-muted">
                        {t("auto.noresults")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

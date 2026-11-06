"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LANGS, useI18n, type Key } from "@/lib/i18n";
import { remoteEnabled } from "@/lib/supabase/client";
import { reloadStore } from "@/lib/store";
import { Button, Card, Field, Input } from "@/components/ui";

/** One field. The e-mail must have been added to the allowlist in advance; no password, no e-mail is sent. */
export default function LoginPage() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Key | null>(null);

  if (!remoteEnabled) return <p className="p-8 text-sm text-text-muted">Demo mode: no Supabase keys, so there is no sign-in. See .env.example.</p>;

  async function go(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      if (r.ok) {
        reloadStore();
        router.replace("/");
        router.refresh();
        return;
      }
      setErr(r.status === 403 ? "auth.err.notallowed" : r.status === 429 ? "auth.err.many" : "auth.err.generic");
    } catch {
      setErr("auth.err.generic");
    }
    setBusy(false);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-text">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-md bg-accent text-sm font-bold text-on-accent">
            DM
          </span>
          <h1 className="text-lg font-bold">{t("auth.title.signin")}</h1>
        </div>
        <form onSubmit={go} className="space-y-3">
          <Field label={t("auth.email")} htmlFor="a-email" hint={t("auth.hint.allowed")}>
            <Input id="a-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {err && (
            <p role="alert" className="text-sm text-danger">
              {t(err)}
            </p>
          )}
          <Button type="submit" className="w-full" loading={busy}>
            {t("auth.continue")}
          </Button>
        </form>
        <label className="block text-xs text-text-muted">
          {t("lang.label")}
          <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} className="mt-1 h-9 w-full rounded-md border border-border-input bg-bg px-2 text-sm text-text">
            {LANGS.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </Card>
    </main>
  );
}

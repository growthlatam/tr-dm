"use client";
import Link from "next/link";
import { Check, FileText, MessageCircle, Megaphone } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { Card, cx } from "@/components/ui";
import { PageHeader } from "@/components/shell";

export default function HomePage() {
  const { t } = useI18n();
  const { automations, conversations } = useStore();
  const hasLive = automations.some((a) => a.status === "live");
  const answered = conversations.some((c) => c.messages.some((m) => m.sender === "agent" && m.kind === "text"));
  const steps = [
    { done: true, label: t("home.step1"), href: "/settings" },
    { done: hasLive, label: t("home.step2"), href: "/automations/new" },
    { done: answered, label: t("home.step3"), href: "/inbox" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const tpls = [
    { icon: FileText, t: t("home.tpl1.t"), d: t("home.tpl1.d"), href: "/automations/new" as string | null },
    { icon: MessageCircle, t: t("home.tpl2.t"), d: t("home.tpl2.d"), href: null },
    { icon: Megaphone, t: t("home.tpl3.t"), d: t("home.tpl3.d"), href: null },
  ];
  return (
    <div className="mx-auto max-w-content pb-12">
      <PageHeader title={t("home.title")} />
      <p className="px-4 text-sm text-text-muted sm:px-8">{t("home.channels", { n: 1 })} · Instagram</p>

      <section aria-labelledby="start" className="px-4 pt-8 sm:px-8">
        <h2 id="start" className="mb-3 text-lg font-semibold">
          {t("home.start")}
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {tpls.map((x) => {
            const inner = (
              <Card className={cx("h-full p-4", x.href ? "hover:shadow-pop transition-shadow duration-base" : "opacity-60")}>
                <x.icon className="mb-3 h-5 w-5 text-accent" aria-hidden />
                <div className="font-semibold">{x.t}</div>
                <p className="mt-1 text-sm text-text-muted">{x.d}</p>
              </Card>
            );
            return <li key={x.t}>{x.href ? <Link href={x.href}>{inner}</Link> : inner}</li>;
          })}
        </ul>
      </section>

      <section aria-labelledby="next" className="px-4 pt-8 sm:px-8">
        <h2 id="next" className="mb-3 text-lg font-semibold">
          {t("home.next")}
        </h2>
        <Card className="max-w-xl p-4">
          <div className="mb-3 h-2 overflow-hidden rounded-pill bg-surface" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={doneCount}>
            <div className="h-full bg-accent transition-all duration-base" style={{ width: `${(doneCount / 3) * 100}%` }} />
          </div>
          <ul className="space-y-2">
            {steps.map((s) => (
              <li key={s.label}>
                <Link href={s.href} className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm hover:bg-surface">
                  <span className={cx("grid h-5 w-5 place-items-center rounded-pill border", s.done ? "border-success bg-success text-white" : "border-border-input")}>
                    {s.done && <Check className="h-3 w-3" aria-hidden />}
                  </span>
                  <span className={s.done ? "text-text-muted line-through" : ""}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}

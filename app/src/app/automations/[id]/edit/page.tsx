"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Wizard } from "@/components/wizard";
import { Button } from "@/components/ui";
import { useHydrated, useStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

export default function EditAutomationPage() {
  const { id } = useParams<{ id: string }>();
  const { automations } = useStore();
  const { t } = useI18n();
  const ready = useHydrated();
  const a = automations.find((x) => x.id === id);
  if (!ready) return <p role="status" className="p-8 text-sm text-text-muted">{t("common.loading")}</p>;
  if (!a) return <p className="p-8 text-sm text-text-muted">{t("flow.notfound")}</p>;
  if (a.custom || a.draftGraph)
    return (
      <div className="mx-auto max-w-xl space-y-4 p-8">
        <p className="text-sm">{t("ed.quick.warn")}</p>
        <Link href={`/automations/${a.id}`}>
          <Button>{t("flow.edit")}</Button>
        </Link>
      </div>
    );
  return <Wizard existing={a} key={a.id} />;
}

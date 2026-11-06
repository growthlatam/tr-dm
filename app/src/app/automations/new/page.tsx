"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { useHydrated, useStore } from "@/lib/store";
import { remoteEnabled } from "@/lib/supabase/client";
import { Button, Card } from "@/components/ui";
import { Wizard } from "@/components/wizard";

export default function NewAutomationPage() {
  const { t } = useI18n();
  const { activeAccount } = useStore();
  const ready = useHydrated();
  // an automation always belongs to one Instagram account, so there must be a selected one
  if (remoteEnabled && ready && !activeAccount)
    return (
      <div className="mx-auto max-w-content px-4 py-8 sm:px-8">
        <Card className="space-y-3 p-6">
          <p className="text-sm">{t("auto.noacct")}</p>
          <Link href="/settings">
            <Button>{t("nav.settings")}</Button>
          </Link>
        </Card>
      </div>
    );
  return <Wizard />;
}

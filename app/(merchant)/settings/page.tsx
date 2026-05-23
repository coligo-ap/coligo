import { redirect } from "next/navigation";
import { Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PrintSettingsForm } from "@/components/merchant/print-settings-form";
import {
  DEFAULT_PRINT_SETTINGS,
  type PrintSettings,
  type PrintWidth,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: merchant } = await supabase
    .from("merchants")
    .select("name, auto_accept_orders, auto_print, print_copies, print_width")
    .eq("user_id", user.id)
    .maybeSingle();

  const settings: PrintSettings = merchant
    ? {
        auto_accept_orders: merchant.auto_accept_orders,
        auto_print: merchant.auto_print,
        print_copies: merchant.print_copies,
        print_width: merchant.print_width as PrintWidth,
      }
    : DEFAULT_PRINT_SETTINGS;

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          Paramètres
        </h1>
        <p className="text-muted mt-1 text-sm">
          Réglages de votre boutique et de votre imprimante.
        </p>
      </header>

      <section className="border-border bg-surface rounded-[16px] border p-5 lg:p-6">
        <header className="border-border mb-5 flex items-center gap-3 border-b pb-4">
          <div className="bg-primary-50 text-primary-700 flex size-9 items-center justify-center rounded-[10px]">
            <Printer className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Impression du ticket</h2>
            <p className="text-muted text-xs">
              Acceptation automatique des commandes et configuration de
              l&apos;imprimante thermique.
            </p>
          </div>
        </header>

        <PrintSettingsForm
          initial={settings}
          merchantName={merchant?.name ?? "Coligo"}
        />
      </section>
    </div>
  );
}

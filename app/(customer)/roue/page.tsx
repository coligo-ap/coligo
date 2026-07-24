import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Dices } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/auth/merchant";
import { getFeatureFlag } from "@/lib/data/feature-flags";
import {
  WheelView,
  type WheelPrize,
  type WheelState,
} from "@/components/customer/wheel/wheel-view";

export const dynamic = "force-dynamic";

// =============================================================================
// « Roue Coligo » — un tour par jour, lots crédités sur Coligo Pay (mig 0407).
// Le TIRAGE est serveur (RPC wheel_spin) — la roue ne fait qu'animer vers le
// résultat déjà tranché.
// =============================================================================
export default async function WheelPage() {
  const t = await getTranslations("wheel");
  const user = await getAuthUser();
  if (!user) redirect("/se-connecter?next=/roue");

  const [merchant, flag] = await Promise.all([
    getCurrentMerchant(),
    getFeatureFlag("wheel"),
  ]);
  if (merchant) redirect("/dashboard");
  if (flag.status === "hidden") redirect("/compte");

  const supabase = await createClient();
  // RPC + table hors types générés → bind/cast locaux.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string
  ) => Promise<{ data: WheelState | null }>;
  const from = supabase.from.bind(supabase) as unknown as (t: string) => {
    select: (c: string) => {
      order: (
        col: string,
        o: { ascending: boolean }
      ) => Promise<{ data: WheelPrize[] | null }>;
    };
  };
  const [{ data: state }, { data: prizes }] = await Promise.all([
    rpc("my_wheel_state"),
    from("wheel_prizes")
      .select("id, kind, amount_da, label_fr, label_ar")
      .order("position", { ascending: true }),
  ]);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-lg px-4 py-4 pb-24 lg:px-6 lg:py-8">
        <Link
          href="/compte"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
          {t("back")}
        </Link>

        <h1 className="text-foreground mb-1 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <Dices className="text-primary-600 size-6" />
          {t("title")}
        </h1>
        <p className="text-muted mb-5 text-sm">{t("subtitle")}</p>

        <WheelView state={state} prizes={prizes ?? []} />
      </div>
    </CustomerShell>
  );
}

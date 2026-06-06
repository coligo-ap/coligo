import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Heart } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { getFavoriteMerchants } from "@/lib/data/favorites";
import { MerchantCard } from "@/components/customer/merchant-card";

export const dynamic = "force-dynamic";

// =============================================================================
// « Mes favoris » — page dédiée listant les commerces mis en favori (cœur).
// Nécessite d'être connecté (le favori est rattaché au compte). Vide → encart
// d'invitation, jamais de bloc vide trompeur.
// =============================================================================

export default async function CustomerFavoritesPage() {
  const t = await getTranslations("account");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter?next=/favoris");

  const merchants = await getFavoriteMerchants();

  return (
    <CustomerShell>
      <div className="mx-auto max-w-[1400px] px-4 py-4 pb-24 lg:px-6 lg:py-8">
        <Link
          href="/"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
          {t("home")}
        </Link>

        <h1 className="text-foreground mb-4 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <Heart className="fill-coral-500 text-coral-500 size-6" />
          {t("myFavorites")}
        </h1>

        {merchants.length === 0 ? (
          <div className="border-border bg-surface text-muted rounded-[18px] border px-6 py-14 text-center">
            <Heart className="text-subtle mx-auto mb-3 size-8" />
            <p className="text-foreground font-semibold">
              {t("noFavoritesYet")}
            </p>
            <p className="mt-1 text-sm">{t("noFavoritesHint")}</p>
            <Link
              href="/"
              className="bg-primary-600 hover:bg-primary-700 mt-5 inline-flex items-center rounded-full px-5 py-2.5 text-sm font-semibold text-white"
            >
              {t("discoverMerchants")}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {merchants.map((m) => (
              <MerchantCard
                key={m.id}
                merchant={m}
                initialFavorite
                isAuth
                refreshOnToggle
              />
            ))}
          </div>
        )}
      </div>
    </CustomerShell>
  );
}

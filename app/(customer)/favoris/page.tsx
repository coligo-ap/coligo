import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Heart } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { getCurrentCustomer } from "@/lib/auth/customer";
import { FavoritesLoader } from "@/components/customer/favorites-loader";

export const dynamic = "force-dynamic";

// =============================================================================
// « Mes favoris » — page dédiée listant les commerces mis en favori (cœur).
// Nécessite d'être connecté (le favori est rattaché au compte). La liste est
// chargée par TanStack Query (cache persistant + refetch en fond) ; retirer un
// favori invalide la requête → la carte disparaît sans recharger la route.
// =============================================================================

export default async function CustomerFavoritesPage() {
  const t = await getTranslations("account");
  // Session mémoïsée (partagée avec CustomerShell → pas de double auth).
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/se-connecter?next=/favoris");

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

        <FavoritesLoader customerId={customer.id} />
      </div>
    </CustomerShell>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { listMerchantProducts } from "@/lib/data/customer-catalog";
import { MerchantCatalog } from "@/components/customer/merchant-catalog";
import { SharedCartAddProvider } from "@/components/customer/shared-cart/shared-cart-add-provider";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ajouter des produits — Coligo",
  robots: { index: false },
};

/**
 * Catalogue du commerçant en MODE PANIER PARTAGÉ (invités sans compte).
 * Réutilise le catalogue existant tel quel — seul le provider d'ajout change :
 * chaque ajout part vers le panier partagé serveur (RPC token-validée).
 * Prix affichés = prix catalogue (les promos éventuelles s'appliquent au
 * paiement, jamais en défaveur du client).
 */
export default async function SharedCartCataloguePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("sharedCart");

  const supabase = await createClient();
  // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{
    data: {
      cart: { status: string };
      merchant: {
        id: string;
        slug: string;
        name: string;
        logo_url: string | null;
      } | null;
    } | null;
  }>;
  const { data: view } = await rpc("shared_cart_by_token", { p_token: token });
  if (!view?.merchant) notFound();
  // Panier fermé/verrouillé/commandé → retour room (elle explique l'état).
  if (view.cart.status !== "open") redirect(`/p/${token}`);

  // `isCaptain` : la RLS ne rend le panier par table qu'à son capitaine.
  const fromCast = supabase.from.bind(supabase) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (
        col: string,
        v: string
      ) => { maybeSingle: () => Promise<{ data: { id: string } | null }> };
    };
  };
  const [{ data: mine }, user] = await Promise.all([
    fromCast("shared_carts")
      .select("id")
      .eq("share_token", token)
      .maybeSingle(),
    getAuthUser(),
  ]);
  // CLIENT connecté : coque habituelle (nav basse) — invités : plein écran.
  const showChrome = !!user;

  const { categories, products } = await listMerchantProducts(view.merchant.id);

  return (
    <SharedCartAddProvider token={token} isCaptain={!!mine}>
      <div className="bg-surface-2 min-h-dvh pb-24">
        <header className="border-border bg-surface sticky top-0 z-40 border-b px-4 pt-[calc(env(safe-area-inset-top)+0.6rem)] pb-2.5">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <Link
              href={`/p/${token}`}
              aria-label={t("backToCart")}
              className="bg-surface-2 text-foreground grid size-9 shrink-0 place-items-center rounded-full"
            >
              <ArrowLeft className="size-4.5 rtl:-scale-x-100" />
            </Link>
            <div className="min-w-0">
              <p className="text-foreground truncate text-[15px] font-extrabold">
                {view.merchant.name}
              </p>
              <p className="text-muted text-[11px] font-semibold">
                {t("catalogueSubtitle")}
              </p>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-2xl px-4 pt-3">
          <MerchantCatalog
            merchant={view.merchant}
            products={products}
            categories={categories}
            promoPriceById={{}}
            quantityOfferByProduct={{}}
            promoCarousels={[]}
          />
        </main>

        {/* Retour permanent vers la room — au-dessus de la nav client si coque. */}
        <div
          className={
            showChrome
              ? "fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.9rem)] z-40 px-4 lg:bottom-0 lg:pb-[calc(env(safe-area-inset-bottom)+0.9rem)]"
              : "fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(env(safe-area-inset-bottom)+0.9rem)]"
          }
        >
          <div className="mx-auto max-w-2xl">
            <Link
              href={`/p/${token}`}
              className="bg-primary-600 hover:bg-primary-700 block rounded-[14px] px-4 py-3.5 text-center text-sm font-extrabold text-white shadow-lg transition active:scale-[0.98]"
            >
              {t("backToCart")}
            </Link>
          </div>
        </div>
        {showChrome && <CustomerBottomNav />}
      </div>
    </SharedCartAddProvider>
  );
}

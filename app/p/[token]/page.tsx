import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { selfHealSharedCart } from "@/lib/shared-cart/selfheal";
import { CartRoom } from "@/components/customer/shared-cart/cart-room";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Panier partagé — Coligo",
  robots: { index: false },
};

/**
 * Room PUBLIQUE du panier partagé — coligo.app/p/{token} (gabarit /t/{token}).
 * Une seule room pour le capitaine ET les invités sans compte : le RSC ne
 * détermine que `isCaptain` (la RLS mig 0405 ne rend le panier par table
 * qu'à son capitaine) ; tout le contenu passe par la RPC anon token-validée.
 */
export default async function SharedCartPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Reprise de main immédiate si la commande liée a été annulée sans paiement
  // (même règle que le cron quotidien, scopée à CE panier).
  await selfHealSharedCart(token);

  const supabase = await createClient();
  // Table hors types générés → cast local du builder.
  const from = supabase.from.bind(supabase) as unknown as (t: string) => {
    select: (c: string) => {
      eq: (
        col: string,
        v: string
      ) => { maybeSingle: () => Promise<{ data: { id: string } | null }> };
    };
  };
  const [{ data: mine }, user] = await Promise.all([
    from("shared_carts").select("id").eq("share_token", token).maybeSingle(),
    getAuthUser(),
  ]);

  // CLIENT connecté (capitaine ou pas) : on garde la coque habituelle —
  // nav du bas + bouton retour. Les invités sans compte restent plein écran.
  const showChrome = !!user;

  return (
    <>
      <CartRoom
        token={token}
        isCaptain={!!mine}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "https://coligo.app"}
        showChrome={showChrome}
      />
      {showChrome && <CustomerBottomNav />}
    </>
  );
}

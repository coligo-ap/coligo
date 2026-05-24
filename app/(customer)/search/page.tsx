import { redirect } from "next/navigation";

// =============================================================================
// /search → 301 vers la home /, où la recherche est désormais intégrée
// (composant MarketplaceView). On préserve les params usuels (q, category,
// sort, open_now) pour compatibilité avec les URLs partagées.
// =============================================================================
export const dynamic = "force-dynamic";

type SP = {
  q?: string;
  category?: string;
  sort?: string;
  open_now?: string;
};

export default async function SearchRedirect({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = (await searchParams) ?? {};
  const usp = new URLSearchParams();
  if (sp.q) usp.set("q", sp.q);
  if (sp.category) usp.set("category", sp.category);
  if (sp.sort === "min_order") usp.set("sort", "min_order");
  if (sp.open_now === "1") usp.set("open_now", "1");
  const qs = usp.toString();
  redirect(qs ? `/?${qs}` : "/");
}

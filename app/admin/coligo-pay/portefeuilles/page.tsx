import { WalletsSearch } from "@/components/admin/coligo-pay/wallets-search";
import { searchWallets } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Onglet « Portefeuilles » du hub Coligo Pay & Finances : recherche UNIFIÉE
 * (clients, livreurs, chauffeurs, commerçants, agents Coligo Pay) → fiche
 * portefeuille (soldes, écritures, ajustements motivés). RPC
 * admin_search_wallets (0346), gardée admin_can('finances').
 */
export default async function AdminWalletsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const hits = q.trim().length >= 2 ? await searchWallets(q) : [];

  return (
    <div>
      <p className="text-muted mb-4 text-sm">
        Cherche un portefeuille par nom, téléphone ou handle — client (Coligo
        Pay + cashback), livreur, chauffeur, commerçant ou Agent Coligo Pay.
      </p>
      <WalletsSearch initialQ={q} hits={hits} />
    </div>
  );
}

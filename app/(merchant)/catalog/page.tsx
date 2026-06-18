import { CatalogLoader } from "@/components/merchant/catalog-loader";
import { getCurrentMerchantId } from "@/lib/auth/merchant";
import { APP_CONFIG } from "@/lib/config/app-config";

export const dynamic = "force-dynamic";

// La liste est chargée par TanStack Query (CatalogLoader) : cache persistant
// entre sections (provider dans MerchantShell), refetch en fond, et mise à jour
// immédiate après chaque mutation via invalidation (onMutated). La page ne fait
// plus de fetch bloquant — juste résoudre l'id commerçant pour la clé de cache.
export default async function CatalogPage() {
  const merchantId = await getCurrentMerchantId();
  return (
    <CatalogLoader
      merchantId={merchantId ?? ""}
      lowStockThreshold={APP_CONFIG.catalog.lowStockThreshold}
    />
  );
}

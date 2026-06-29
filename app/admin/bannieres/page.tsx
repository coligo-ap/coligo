import { BannersView } from "@/components/admin/bannieres/banners-view";

export const dynamic = "force-dynamic";

// Route transverse conservée (super-admin + MFA via app/admin/layout.tsx).
// Même vue que l'onglet Bannières du hub Marketing (/admin/marketing).
export default function AdminBannersPage() {
  return <BannersView />;
}

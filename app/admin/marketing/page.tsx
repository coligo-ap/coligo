import { BannersView } from "@/components/admin/bannieres/banners-view";

export const dynamic = "force-dynamic";

// Onglet « Bannières » du hub Marketing (vue partagée avec /admin/bannieres).
export default function MarketingBannersTab() {
  return <BannersView />;
}

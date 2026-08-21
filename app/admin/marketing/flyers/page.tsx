import { FlyersConsole } from "@/components/admin/marketing/flyers-console";

export const dynamic = "force-dynamic";

// Onglet « Flyers » du hub Marketing : génération du flyer publicitaire
// Coligo recto/verso aux dimensions choisies (cm). Gate domaine dans le
// layout du hub (requireAdminDomain("marketing")).
export default function MarketingFlyersTab() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-5 lg:px-6">
      <FlyersConsole />
    </div>
  );
}

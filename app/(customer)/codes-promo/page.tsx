import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Ticket } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/auth/merchant";
import {
  getMyPlatformCodes,
  getMyVouchers,
} from "@/lib/customer/platform-promos";
import { PlatformPromosView } from "@/components/customer/platform-promos-view";

export const dynamic = "force-dynamic";

// =============================================================================
// « Codes promo & bons » — le client saisit un code plateforme, consulte les
// codes disponibles + les bons d'achat reçus (crédités sur Coligo Pay).
// =============================================================================
export default async function CustomerPromosPage() {
  const t = await getTranslations("promosPage");
  const user = await getAuthUser();
  if (!user) redirect("/se-connecter?next=/codes-promo");

  const merchant = await getCurrentMerchant();
  if (merchant) redirect("/dashboard");

  const [codes, vouchers] = await Promise.all([
    getMyPlatformCodes(),
    getMyVouchers(),
  ]);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl px-4 py-4 pb-24 lg:px-6 lg:py-8">
        <Link
          href="/compte"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
          {t("back")}
        </Link>

        <h1 className="text-foreground mb-1 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <Ticket className="text-primary-600 size-6" />
          {t("title")}
        </h1>
        <p className="text-muted mb-5 text-sm">{t("subtitle")}</p>

        <PlatformPromosView codes={codes} vouchers={vouchers} />
      </div>
    </CustomerShell>
  );
}

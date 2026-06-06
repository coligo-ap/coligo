import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { AccountInfoForm } from "@/components/customer/account-info-form";

export const dynamic = "force-dynamic";

// =============================================================================
// /compte/infos — sous-page dédiée « Informations personnelles ».
// =============================================================================
// Le formulaire nom / téléphone / email a été SORTI de la page Compte (épurée)
// pour vivre ici, avec une barre « Enregistrer les modifications » fixe en bas.
// Page autonome (pas de bottom-nav) → focus sur l'édition, retour explicite.
// =============================================================================
export default async function CustomerAccountInfoPage() {
  const t = await getTranslations("account");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter?next=/compte/infos");

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchant) redirect("/dashboard");

  const { data: customer } = await supabase
    .from("customers")
    .select("full_name, phone, email")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="bg-surface-2 min-h-screen">
      {/* En-tête simple : retour + titre. */}
      <header className="border-border sticky top-0 z-20 flex items-center gap-3 border-b bg-white px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
        <Link
          href="/compte"
          aria-label={t("back")}
          className="bg-surface-2 grid size-9 place-items-center rounded-full transition-transform active:scale-90"
        >
          <ChevronLeft className="size-[18px] rtl:-scale-x-100" />
        </Link>
        <h1 className="text-[19px] font-black tracking-tight">
          {t("personalInfo")}
        </h1>
      </header>

      <main className="mx-auto max-w-2xl">
        <AccountInfoForm
          initialName={customer?.full_name ?? ""}
          initialPhone={customer?.phone ?? ""}
          initialEmail={user.email ?? customer?.email ?? ""}
        />
      </main>
    </div>
  );
}

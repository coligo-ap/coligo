"use client";

import { useFormStatus } from "react-dom";
import { useLocale } from "next-intl";
import { LogOut } from "lucide-react";
import { PartnerLogoutRow, BRAND_RED } from "@/components/shared/partner-ui";
import { driverLogout } from "@/app/(driver)/actions";
import { setDriverOnline } from "@/lib/driver/online-store";
import { getActiveCourse } from "@/lib/driver/active-course-store";
import { chauffeurLogout } from "@/app/(chauffeur)/actions";
import { setChauffeurOnlineLocal } from "@/lib/chauffeur/online-store";
import { logout as merchantLogout } from "@/app/(merchant)/actions";

export type IdvLogoutProfile = "driver" | "chauffeur" | "merchant";

/**
 * Échappatoire « Se déconnecter » sur l'écran bloquant IDV (`IdvRequiredScreen`)
 * — un compte qui ne veut/peut pas vérifier maintenant ne doit jamais rester
 * coincé sans issue. Réutilise les mêmes actions et le même composant que les
 * pages Compte (`PartnerLogoutRow`, déjà en rouge) plutôt que de dupliquer la
 * logique de déconnexion.
 */
export function IdvLogoutRow({ profile }: { profile: IdvLogoutProfile }) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  if (profile === "driver") {
    return (
      <PartnerLogoutRow
        label={tr("Se déconnecter", "تسجيل الخروج")}
        pendingLabel={tr("Déconnexion en cours…", "جارٍ تسجيل الخروج…")}
        onLogout={async () => {
          if (getActiveCourse()) {
            return tr(
              "Terminez votre course en cours avant de vous déconnecter.",
              "أنهِ توصيلتك الجارية قبل تسجيل الخروج."
            );
          }
          setDriverOnline(false);
          const res = await driverLogout();
          return res?.error ?? null;
        }}
      />
    );
  }

  if (profile === "chauffeur") {
    return (
      <PartnerLogoutRow
        label={tr("Se déconnecter", "تسجيل الخروج")}
        pendingLabel={tr("Déconnexion en cours…", "جارٍ تسجيل الخروج…")}
        onLogout={async () => {
          const res = await chauffeurLogout();
          if (res?.error) return res.error;
          setChauffeurOnlineLocal(false);
          return null;
        }}
      />
    );
  }

  return <MerchantIdvLogout />;
}

/**
 * Commerçant : pas de `PartnerLogoutRow` partagé pour cet espace. `logout()`
 * redirige toujours en interne (pas de retour d'erreur) — on la déclenche donc
 * en `<form action>` natif (jamais un `await` manuel + `.catch`, qui avalerait
 * le throw spécial de `redirect()` et casserait la navigation). `useFormStatus`
 * donne le `pending` immédiat sans dupliquer d'état.
 */
function MerchantIdvLogout() {
  return (
    <form action={merchantLogout}>
      <MerchantIdvLogoutButton />
    </form>
  );
}

function MerchantIdvLogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-body mt-3 flex w-full items-center gap-3 rounded-lg border px-3.5 py-3.5 text-start font-semibold disabled:opacity-70"
      style={{ borderColor: "var(--idv-line)", color: BRAND_RED }}
    >
      <LogOut className="size-4" style={{ color: BRAND_RED }} />
      {pending ? "Déconnexion en cours…" : "Se déconnecter"}
    </button>
  );
}

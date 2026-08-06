"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Retour de la roue = D'OÙ L'ON VIENT, jamais une cible en dur.
 *
 * Bug vécu (06/08) : le lien pointait `/compte` — en ouvrant la roue depuis
 * l'ACCUEIL (entrée animée / bulle), « retour » éjectait le client sur son
 * compte au lieu de la marketplace. `router.back()` réutilise le Router Cache
 * (retour instantané, état/scroll préservés — règle nav CLAUDE.md) ; en accès
 * direct sans historique (poussée, lien externe), repli sur l'accueil.
 */
export function WheelBackLink() {
  const router = useRouter();
  const t = useTranslations("wheel");
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
      }}
      className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
    >
      <ArrowLeft className="size-4 rtl:-scale-x-100" />
      {t("back")}
    </button>
  );
}

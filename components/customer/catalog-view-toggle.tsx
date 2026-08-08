"use client";

import { useTranslations } from "next-intl";
import { LayoutGrid, Rows3 } from "lucide-react";
import {
  setCatalogDisplay,
  useCatalogDisplay,
} from "@/lib/customer/catalog-display-store";

// =============================================================================
// CatalogViewToggle — UN SEUL bouton-carte façon Bolt Market (leur gros bouton
// gris « Categories » : icône au-dessus du libellé, carte grise arrondie sans
// bordure). Il affiche la vue vers laquelle il BASCULE : en liste → « Catégories »,
// en catégories → « Liste ». Posé sur la ligne du toggle Retrait/Livraison ;
// masqué s'il n'y a qu'un seul groupe (rien à basculer).
// =============================================================================

export function CatalogViewToggle({
  merchantId,
  defaultDisplay,
}: {
  merchantId: string;
  defaultDisplay: "list" | "categories";
}) {
  const t = useTranslations("merchant");
  const { display: stored, groupsCount } = useCatalogDisplay();
  if (groupsCount <= 1) return null;
  const display = stored ?? defaultDisplay;
  const next = display === "list" ? "categories" : "list";

  function toggle() {
    setCatalogDisplay(next);
    try {
      window.localStorage.setItem(`coligo:catalog-display:${merchantId}`, next);
    } catch {
      /* préférence non mémorisée, sans gravité */
    }
    // Descend DIRECTEMENT à la section concernée (grille de catégories ou
    // liste de produits) : sans ça, la bascule se joue sous le pli (carrousels
    // au-dessus) et l'utilisateur ne voit pas le changement. Double rAF :
    // on défile APRÈS le re-render de la nouvelle vue.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .getElementById("catalog-sections")
          ?.scrollIntoView({ behavior: "smooth", block: "start" })
      )
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t("viewToggleAria")}
      className="bg-surface-2 hover:bg-surface-3 flex shrink-0 flex-col items-center justify-center gap-0.5 self-stretch rounded-lg px-4 transition-colors active:scale-[0.97]"
    >
      {next === "categories" ? (
        <LayoutGrid className="text-foreground size-[18px]" />
      ) : (
        <Rows3 className="text-foreground size-[18px]" />
      )}
      <span className="text-foreground text-caption-lg leading-none font-bold whitespace-nowrap">
        {next === "categories" ? t("catButtonCats") : t("catButtonList")}
      </span>
    </button>
  );
}

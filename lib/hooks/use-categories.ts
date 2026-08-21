"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MERCHANT_CATEGORIES } from "@/lib/config/categories";

/**
 * Catégories pilotées en BASE (merchant_categories, mig 0311) côté CLIENT :
 * lecture anon (RLS publique), cache module (1 fetch par onglet), REPLI sur
 * la config statique tant que la DB n'a pas répondu. Consommé par le select
 * d'inscription, les réglages boutique et le strip de filtres marketplace.
 * Mig 0336 : visibilité par surface (showMarketplace / showSignup) + position
 * (ordre éditorial du strip).
 */

export type ClientCategory = {
  code: string;
  label: string;
  labelAr: string;
  emoji: string;
  imageUrl: string | null;
  status: "active" | "hidden" | "coming_soon";
  /** type = proposé à l'inscription ; filter = filtre éditorial marketplace. */
  kind: "type" | "filter";
  /** Ordre éditorial (reclassement admin). */
  position: number;
  /** Affichée dans le strip de filtres du marketplace. */
  showMarketplace: boolean;
  /** Proposée à l'inscription / réglages commerçant. */
  showSignup: boolean;
  /** Famille parente (mig 0463) — pilote la rangée de pilules du marketplace. */
  parentCode: string | null;
};

const FALLBACK: ClientCategory[] = MERCHANT_CATEGORIES.map((c, i) => ({
  code: c.code,
  label: c.label,
  labelAr: c.labelAr,
  emoji: c.emoji,
  imageUrl: null,
  status: "active" as const,
  kind: "type" as const,
  position: (i + 1) * 10,
  showMarketplace: true,
  showSignup: true,
  parentCode: null,
}));

let cache: ClientCategory[] | null = null;

/**
 * Libellé d'une catégorie depuis la LISTE PILOTÉE EN BASE (renommages admin
 * inclus), repli statique puis code brut. À utiliser avec useCategories() :
 * `categoryLabelFrom(useCategories(), code, locale)` — remplace l'ancien
 * getCategoryLabel statique dans les écrans client (indépendance du code dur).
 */
export function categoryLabelFrom(
  list: ClientCategory[],
  code: string,
  locale: string = "fr"
): string {
  const db = list.find((c) => c.code === code);
  if (db) return locale === "ar" ? db.labelAr : db.label;
  const fallback = MERCHANT_CATEGORIES.find((c) => c.code === code);
  if (fallback) return locale === "ar" ? fallback.labelAr : fallback.label;
  return code;
}

export function useCategories(): ClientCategory[] {
  const [rows, setRows] = useState<ClientCategory[]>(cache ?? FALLBACK);
  useEffect(() => {
    if (cache) return;
    const supabase = createClient();
    void supabase
      .from("merchant_categories" as never)
      .select(
        "code, label, label_ar, emoji, image_url, status, position, kind, show_marketplace, show_signup, parent_code"
      )
      .order("position", { ascending: true })
      .then(({ data }) => {
        const list = (data ?? []) as unknown as {
          code: string;
          label: string;
          label_ar: string;
          emoji: string;
          image_url: string | null;
          status: string;
          position: number;
          kind: string;
          show_marketplace: boolean;
          show_signup: boolean;
          parent_code: string | null;
        }[];
        if (list.length === 0) return; // repli statique conservé
        cache = list.map((r) => ({
          code: r.code,
          label: r.label,
          labelAr: r.label_ar,
          emoji: r.emoji,
          imageUrl: r.image_url,
          status:
            r.status === "hidden" || r.status === "coming_soon"
              ? r.status
              : "active",
          kind: r.kind === "filter" ? ("filter" as const) : ("type" as const),
          position: Number(r.position ?? 0),
          showMarketplace: r.show_marketplace !== false,
          showSignup: r.show_signup !== false,
          parentCode: r.parent_code ?? null,
        }));
        setRows(cache);
      });
  }, []);
  return rows;
}

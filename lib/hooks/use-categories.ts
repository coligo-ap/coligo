"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MERCHANT_CATEGORIES } from "@/lib/config/categories";

/**
 * Catégories pilotées en BASE (merchant_categories, mig 0311) côté CLIENT :
 * lecture anon (RLS publique), cache module (1 fetch par onglet), REPLI sur
 * la config statique tant que la DB n'a pas répondu. Consommé par le select
 * d'inscription, les réglages boutique et le strip de filtres marketplace.
 */

export type ClientCategory = {
  code: string;
  label: string;
  labelAr: string;
  emoji: string;
  imageUrl: string | null;
  status: "active" | "hidden" | "coming_soon";
};

const FALLBACK: ClientCategory[] = MERCHANT_CATEGORIES.map((c) => ({
  code: c.code,
  label: c.label,
  labelAr: c.labelAr,
  emoji: c.emoji,
  imageUrl: null,
  status: "active" as const,
}));

let cache: ClientCategory[] | null = null;

export function useCategories(): ClientCategory[] {
  const [rows, setRows] = useState<ClientCategory[]>(cache ?? FALLBACK);
  useEffect(() => {
    if (cache) return;
    const supabase = createClient();
    void supabase
      .from("merchant_categories" as never)
      .select("code, label, label_ar, emoji, image_url, status, position")
      .order("position", { ascending: true })
      .then(({ data }) => {
        const list = (data ?? []) as unknown as {
          code: string;
          label: string;
          label_ar: string;
          emoji: string;
          image_url: string | null;
          status: string;
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
        }));
        setRows(cache);
      });
  }, []);
  return rows;
}

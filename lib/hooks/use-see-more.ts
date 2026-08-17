"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * « Voir plus » générique pour les historiques PAGINÉS (règle produit : on ne
 * télécharge JAMAIS tout l'historique d'un coup — 20 lignes par page).
 *
 * La PAGE 0 vit dans TanStack Query (cache persistant → réaffichage instantané
 * au retour) ; les pages suivantes s'empilent ici en état local et repartent de
 * zéro quand la cible change (`resetKey`) ou quand la page 0 est revalidée.
 */
export function useSeeMore<T>(
  fetchPage: (page: number) => Promise<T[]>,
  pageSize = 20,
  resetKey: unknown = null
) {
  const [extra, setExtra] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [end, setEnd] = useState(false);
  const pageRef = useRef(1);

  useEffect(() => {
    setExtra([]);
    setEnd(false);
    pageRef.current = 1;
  }, [resetKey]);

  const loadMore = useCallback(async () => {
    if (loading || end) return;
    setLoading(true);
    try {
      const rows = await fetchPage(pageRef.current);
      pageRef.current += 1;
      setExtra((prev) => [...prev, ...rows]);
      if (rows.length < pageSize) setEnd(true);
    } catch {
      /* réseau : le bouton reste re-cliquable, rien de cassé */
    } finally {
      setLoading(false);
    }
  }, [fetchPage, loading, end, pageSize]);

  return { extra, loading, end, loadMore };
}

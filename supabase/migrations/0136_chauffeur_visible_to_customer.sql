-- =============================================================================
-- 0136 — VTC : le client voit le chauffeur (offres + course attribuée)
-- =============================================================================
-- RLS : par défaut un chauffeur ne lit que SA fiche. Pour afficher au CLIENT le
-- nom/véhicule du chauffeur qui a FAIT UNE OFFRE sur sa course, ou qui lui est
-- ATTRIBUÉ, on ajoute une policy SELECT ciblée (permissive, OR avec la self).
-- =============================================================================

DROP POLICY IF EXISTS chauffeurs_visible_to_customer ON public.chauffeurs;
CREATE POLICY chauffeurs_visible_to_customer ON public.chauffeurs
  FOR SELECT USING (
    id IN (
      SELECT r.chauffeur_id FROM public.rides r
       WHERE r.customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
         AND r.chauffeur_id IS NOT NULL
      UNION
      SELECT o.chauffeur_id FROM public.ride_offers o
        JOIN public.rides r2 ON r2.id = o.ride_id
       WHERE r2.customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())
    )
  );

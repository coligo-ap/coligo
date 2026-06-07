-- =============================================================================
-- 0093 — Zones de forte demande (carte livreur)
-- =============================================================================
-- Détecte EN TEMPS RÉEL les zones où il y a beaucoup de commandes de livraison,
-- pour guider le livreur (style « hot zones » Uber). Principe :
--   • On regarde les commandes de livraison créées sur une fenêtre glissante
--     récente (45 min par défaut), non annulées.
--   • On les agrège par cellule géographique (~1,3 km) à partir de la position
--     du COMMERÇANT (point de récupération = là où le livreur doit se trouver).
--   • Une cellule ne devient une « zone » qu'à partir d'un seuil (≥ 3) : en
--     activité NORMALE, aucune zone n'est renvoyée (liste vide).
--   • Trois niveaux d'intensité : moyenne (3-4) / forte (5-7) / très forte (8+).
--
-- Robustesse / anti-erreur :
--   • Paramètres bornés (fenêtre 5..240 min, cellule 0.004..0.05°) → pas de
--     requête aberrante.
--   • Coordonnées NULL ignorées, commandes annulées exclues.
--   • Agrégat SANS aucune donnée personnelle (seulement lat/lng de cellule +
--     compte) → exposable à tout livreur via SECURITY DEFINER sans fuite.
--   • Résultat plafonné (40 zones) pour rester léger.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.delivery_demand_zones(
  p_window_min INTEGER DEFAULT 45,
  p_cell NUMERIC DEFAULT 0.012
) RETURNS TABLE(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  cnt INTEGER,
  level TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      GREATEST(5, LEAST(COALESCE(p_window_min, 45), 240)) AS win,
      GREATEST(0.004, LEAST(COALESCE(p_cell, 0.012), 0.05)) AS cell
  ),
  cells AS (
    SELECT
      round(m.latitude / p.cell) * p.cell  AS clat,
      round(m.longitude / p.cell) * p.cell AS clng,
      count(*)                              AS c
    FROM public.orders o
    JOIN public.merchants m ON m.id = o.merchant_id
    CROSS JOIN params p
    WHERE o.fulfillment_type = 'delivery'
      AND o.status <> 'cancelled'
      AND o.created_at > now() - make_interval(mins => p.win)
      AND m.latitude IS NOT NULL
      AND m.longitude IS NOT NULL
    GROUP BY 1, 2
  )
  SELECT
    (cells.clat + (SELECT cell FROM params) / 2)::double precision AS lat,
    (cells.clng + (SELECT cell FROM params) / 2)::double precision AS lng,
    cells.c::integer AS cnt,
    CASE
      WHEN cells.c >= 8 THEN 'very_high'
      WHEN cells.c >= 5 THEN 'high'
      ELSE 'medium'
    END AS level
  FROM cells
  WHERE cells.c >= 3
  ORDER BY cells.c DESC
  LIMIT 40;
$$;

GRANT EXECUTE ON FUNCTION public.delivery_demand_zones(INTEGER, NUMERIC) TO authenticated;

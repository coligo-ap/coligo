-- =============================================================================
-- 0428 — Recherche d'AGENTS Coligo Pay : beaucoup plus d'informations.
--
-- Avant, la recherche ne renvoyait que nom / adresse / téléphone / horaires.
-- Le partenaire qui cherche où recharger devait deviner le reste : agent
-- officiellement vérifié ou pas, dans quelle commune, depuis combien de temps
-- il opère. Résultat : des déplacements pour rien.
--
-- On ajoute donc, en une seule requête (aucun aller-retour supplémentaire) :
--   • is_verified  — l'agent a été VÉRIFIÉ par l'équipe Coligo (badge) ;
--   • wilaya / commune — situer sans lire toute l'adresse, et filtrer ;
--   • owner_name   — le nom du responsable, utile pour se présenter ;
--   • since        — depuis quand il opère (ancienneté = confiance).
--
-- ⚠️ CE QU'ON NE PUBLIE PAS, VOLONTAIREMENT : le solde de l'agent, ni même une
-- fourchette. Annoncer publiquement « cet agent a beaucoup d'espèces » revient
-- à désigner une cible. La disponibilité réelle se règle à l'accueil, entre
-- l'agent et le partenaire — jamais par une donnée exposée à tous.
--
-- Le filtre reste inchangé : partenaire actif, géolocalisé, dans le rayon.
-- =============================================================================

DROP FUNCTION IF EXISTS public.recharge_points_nearby(
  double precision, double precision, integer, numeric
);

CREATE FUNCTION public.recharge_points_nearby(
  p_lat double precision,
  p_lng double precision,
  p_limit integer DEFAULT 30,
  p_radius_override numeric DEFAULT NULL::numeric
)
RETURNS TABLE(
  wallet_id uuid,
  display_name text,
  address text,
  phone text,
  hours text,
  lat double precision,
  lng double precision,
  distance_km double precision,
  is_verified boolean,
  wilaya text,
  commune text,
  owner_name text,
  since date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  WITH cfg AS (
    SELECT COALESCE(browse_radius_km, 15)::numeric AS r_global
    FROM public.platform_settings WHERE id = true
  ),
  base AS (
    SELECT
      w.id, w.display_name, w.address, w.phone, w.hours, w.lat, w.lng,
      2 * 6371 * asin(sqrt(
        power(sin(radians(w.lat - p_lat) / 2), 2) +
        cos(radians(p_lat)) * cos(radians(w.lat)) *
        power(sin(radians(w.lng - p_lng) / 2), 2)
      )) AS distance_km,
      COALESCE(w.is_verified, false) AS is_verified,
      w.wilaya, w.commune, w.owner_name,
      w.tenure_start::date AS since,
      COALESCE(p_radius_override, cfg.r_global) AS eff_radius
    FROM public.operator_wallets w
    CROSS JOIN cfg
    WHERE w.is_partner
      AND w.status = 'active'
      AND w.lat IS NOT NULL
      AND w.lng IS NOT NULL
  )
  SELECT b.id, b.display_name, b.address, b.phone, b.hours, b.lat, b.lng,
         b.distance_km, b.is_verified, b.wilaya, b.commune, b.owner_name,
         b.since
  FROM base b
  WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND b.distance_km <= b.eff_radius
  -- Les agents VÉRIFIÉS d'abord à distance comparable : à 200 m près, mieux
  -- vaut envoyer le partenaire chez un agent contrôlé par l'équipe.
  ORDER BY b.is_verified DESC, b.distance_km ASC
  LIMIT greatest(1, least(coalesce(p_limit, 30), 100));
$function$;

-- Mêmes appelants qu'avant : tout partenaire connecté cherche ses agents.
-- (`anon` inclus : la page publique « points de recharge » doit fonctionner
--  sans session — piège connu, une RPC sans GRANT anon est invisible.)
REVOKE ALL ON FUNCTION public.recharge_points_nearby(
  double precision, double precision, integer, numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recharge_points_nearby(
  double precision, double precision, integer, numeric
) TO anon, authenticated, service_role;

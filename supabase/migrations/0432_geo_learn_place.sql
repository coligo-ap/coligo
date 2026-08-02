-- =============================================================================
-- 0432 — Le gazetteer Coligo APPREND des lieux réellement choisis.
--
-- Notre base couvre les localités, pas les cités ni les lotissements : « Cité
-- des douaniers », « Ighil Ouazoug »… n'y étaient pas. Google les connaît,
-- mais dépendre d'un service facturé pour les adresses du quotidien n'est pas
-- tenable — et le jour où la clé est coupée, la recherche s'effondre.
--
-- Donc : chaque lieu qu'un client CHOISIT réellement est enregistré chez nous.
-- Pas ce qu'il tape, pas ce qu'on lui propose — ce qu'il RETIENT. Le signal est
-- le meilleur qui soit : quelqu'un est allé là.
--
-- Garde-fous :
--   • dédoublonnage géographique (~150 m) ET par nom — on n'accumule pas dix
--     variantes du même endroit ;
--   • nom borné et nettoyé ; coordonnées vérifiées dans les bornes du pays ;
--   • `source = 'learned'` pour distinguer l'appris de l'importé, et pouvoir
--     l'auditer ou le purger sans toucher au reste.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.geo_learn_place(
  p_name text,
  p_lat double precision,
  p_lng double precision,
  p_wilaya text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_exists boolean;
BEGIN
  -- Bornes de l'Algérie : une coordonnée hors pays est une erreur, pas un lieu.
  IF v_name = '' OR length(v_name) < 3 OR length(v_name) > 120
     OR p_lat IS NULL OR p_lng IS NULL
     OR p_lat < 18 OR p_lat > 38 OR p_lng < -9 OR p_lng > 12 THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.geo_places g
    WHERE (
        -- même endroit à ~150 m près
        abs(g.lat - p_lat) < 0.0015 AND abs(g.lng - p_lng) < 0.0015
      )
      OR (
        -- ou même nom déjà connu dans le secteur (5 km)
        lower(unaccent(g.name)) = lower(unaccent(v_name))
        AND abs(g.lat - p_lat) < 0.05 AND abs(g.lng - p_lng) < 0.05
      )
  ) INTO v_exists;

  IF v_exists THEN RETURN false; END IF;

  INSERT INTO public.geo_places (name, wilaya, lat, lng, source, search_text)
  VALUES (
    v_name,
    nullif(btrim(coalesce(p_wilaya, '')), ''),
    p_lat, p_lng,
    'learned',
    lower(unaccent(v_name))
  );
  RETURN true;
END;
$function$;

-- Écrite depuis le SERVEUR uniquement (service_role) : laisser le navigateur
-- écrire dans le gazetteer ouvrirait la porte au remplissage de faux lieux.
REVOKE ALL ON FUNCTION public.geo_learn_place(text, double precision, double precision, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.geo_learn_place(text, double precision, double precision, text)
  TO service_role;

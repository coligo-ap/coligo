-- =============================================================================
-- 0180 — Personnalisation par client : favoris + boost personnel ("Tes lieux")
-- =============================================================================
-- En plus de la popularité GLOBALE (geo_picks, 0179), chaque client a sa propre
-- mémoire : ses adresses favorites (étoile) et ses lieux déjà choisis remontent
-- en tête POUR LUI. Comme Uber/Yassir « Tes lieux ». Accès via fonctions
-- SECURITY DEFINER scopées par auth.uid() (RLS deny-all sur la table).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_place_stats (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cell       TEXT NOT NULL,            -- round(lat,4)','round(lng,4) — ~11 m
  label      TEXT,
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION,
  picks      INT NOT NULL DEFAULT 0,
  favorite   BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cell)
);
ALTER TABLE public.user_place_stats ENABLE ROW LEVEL SECURITY;

-- Cellule ~11 m à partir de coordonnées (parité avec geo_picks).
CREATE OR REPLACE FUNCTION public.geo_cell(p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT round(p_lat::numeric, 4)::text || ',' || round(p_lng::numeric, 4)::text;
$$;

-- +1 sur l'historique personnel d'un lieu choisi (best-effort).
CREATE OR REPLACE FUNCTION public.user_place_record(
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_label TEXT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.user_place_stats(user_id, cell, label, lat, lng, picks)
  VALUES (v_uid, public.geo_cell(p_lat, p_lng), p_label, p_lat, p_lng, 1)
  ON CONFLICT (user_id, cell) DO UPDATE
    SET picks = public.user_place_stats.picks + 1,
        label = coalesce(excluded.label, public.user_place_stats.label),
        updated_at = now();
END $$;

-- Étoile : (dé)marque un lieu comme favori.
CREATE OR REPLACE FUNCTION public.user_place_fav(
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_label TEXT, p_on BOOLEAN
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.user_place_stats(user_id, cell, label, lat, lng, favorite)
  VALUES (v_uid, public.geo_cell(p_lat, p_lng), p_label, p_lat, p_lng, p_on)
  ON CONFLICT (user_id, cell) DO UPDATE
    SET favorite = p_on,
        label = coalesce(excluded.label, public.user_place_stats.label),
        lat = excluded.lat, lng = excluded.lng, updated_at = now();
END $$;

-- Mémoire du client (favoris + lieux choisis), pour boost + affichage.
CREATE OR REPLACE FUNCTION public.user_place_mine()
RETURNS TABLE (cell TEXT, label TEXT, lat DOUBLE PRECISION, lng DOUBLE PRECISION,
               picks INT, favorite BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT cell, label, lat, lng, picks, favorite
  FROM public.user_place_stats
  WHERE user_id = auth.uid()
  ORDER BY favorite DESC, picks DESC, updated_at DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.geo_cell(DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_place_record(DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_place_fav(DOUBLE PRECISION, DOUBLE PRECISION, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_place_mine() TO authenticated;

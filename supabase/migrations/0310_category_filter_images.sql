-- =============================================================================
-- 0310 — Images des FILTRES de catégories (marketplace client), gérées par le
-- super-admin (hub Marketing). Le rond de filtre affiche l'image si présente,
-- sinon l'emoji (repli). Lecture PUBLIQUE (le strip client la consomme sans
-- session) ; ÉCRITURE uniquement service_role (server action admin gardée
-- adminCan('marketing')) — REVOKE + aucune policy d'écriture.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.category_filter_images (
  code        TEXT PRIMARY KEY,
  image_url   TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.category_filter_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS category_filter_images_read ON public.category_filter_images;
CREATE POLICY category_filter_images_read ON public.category_filter_images
  FOR SELECT TO anon, authenticated USING (true);

-- Anti-altération : aucune écriture par les rôles client (service_role only).
REVOKE INSERT, UPDATE, DELETE ON public.category_filter_images
  FROM anon, authenticated;

-- Bucket public des visuels de filtres (upload via service_role uniquement).
INSERT INTO storage.buckets (id, name, public)
VALUES ('category-filters', 'category-filters', true)
ON CONFLICT (id) DO NOTHING;

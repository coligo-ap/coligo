-- =============================================================================
-- 0248 — Bannières promo : upload d'image + mode d'intégration (image_fit)
-- =============================================================================
-- Le super-admin pouvait seulement coller une URL, et l'image n'était qu'un
-- léger calque (opacité 30 %). On ajoute :
--   • un BUCKET public `promo-banners` (upload direct depuis l'admin) ;
--   • une colonne `image_fit` pour CHOISIR comment l'image s'intègre :
--       - 'cover'   : image PLEINE (remplit toute la bannière, recadrée) +
--                     voile pour garder le texte lisible → « en full » ;
--       - 'contain' : image ENTIÈRE visible (jamais recadrée), centrée sur le
--                     fond de couleur → « pas totalement » ;
--       - 'overlay' : comportement historique (texture en fond + dégradé).
-- Toute image (même très grande) s'intègre : le rendu est responsive et borne
-- l'image au cadre via object-fit (aucun débordement, aucune déformation).
-- =============================================================================

ALTER TABLE public.promo_banners
  ADD COLUMN IF NOT EXISTS image_fit TEXT NOT NULL DEFAULT 'overlay'
    CHECK (image_fit IN ('cover', 'contain', 'overlay'));

-- Bucket PUBLIC (lecture par tous via URL publique ; écriture super-admin).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('promo-banners', 'promo-banners', true, 5 * 1024 * 1024,
        ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS promo_banners_obj_read ON storage.objects;
CREATE POLICY promo_banners_obj_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'promo-banners');

DROP POLICY IF EXISTS promo_banners_obj_admin_write ON storage.objects;
CREATE POLICY promo_banners_obj_admin_write ON storage.objects
  FOR ALL USING (bucket_id = 'promo-banners' AND public.is_super_admin())
  WITH CHECK (bucket_id = 'promo-banners' AND public.is_super_admin());

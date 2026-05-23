-- =============================================================================
-- Coligo v3 - Migration 0014 : Paramètres complets du commerçant
-- =============================================================================
-- Appliquée via `npm run db:push` (ou copiable dans le SQL Editor Supabase).
--
-- Étend `merchants` avec tous les réglages nécessaires au côté client :
--   - Vitrine : slug, descriptions FR/AR, logo/cover, adresse, géoloc, téléphone.
--   - Horaires d'ouverture (jsonb par jour, créneaux multiples).
--   - Règles de commande : minimum, délai de prep, modes de paiement.
--   - Créneaux de retrait : granularité + capacité par créneau.
--   - Buckets Storage + policies (un dossier par commerçant).
--   - Vue publique `merchants_public` : ne révèle que les champs vitrine.
--
-- Règles d'or :
--   - `is_open_now` N'EST PAS stocké → calculé à la volée côté app.
--   - `slug` est unique, généré depuis le nom + suffixe -2/-3 si collision.
--   - Les uploads sont confinés à `{merchant_id}/...` par RLS storage.
-- =============================================================================

-- ============================================================================
-- 1. EXTENSION schema "merchants" — colonnes vitrine + règles
-- ============================================================================
ALTER TABLE public.merchants
  -- Vitrine publique
  ADD COLUMN IF NOT EXISTS slug              TEXT,
  ADD COLUMN IF NOT EXISTS description_fr    TEXT,
  ADD COLUMN IF NOT EXISTS description_ar    TEXT,
  ADD COLUMN IF NOT EXISTS logo_url          TEXT,
  ADD COLUMN IF NOT EXISTS cover_url         TEXT,
  ADD COLUMN IF NOT EXISTS phone_public      TEXT,
  ADD COLUMN IF NOT EXISTS address           TEXT,
  ADD COLUMN IF NOT EXISTS commune           TEXT,
  ADD COLUMN IF NOT EXISTS latitude          NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS longitude         NUMERIC(9, 6),

  -- Horaires d'ouverture (jsonb : map "mon..sun" → array de {open,close})
  -- Exemple :
  --   {"mon":[{"open":"08:00","close":"12:00"},{"open":"14:00","close":"19:00"}],
  --    "fri":[],
  --    ...}
  ADD COLUMN IF NOT EXISTS opening_hours     JSONB NOT NULL DEFAULT
    '{"mon":[],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}'::jsonb,

  -- Règles de commande
  ADD COLUMN IF NOT EXISTS min_order_da      INTEGER NOT NULL DEFAULT 0
    CHECK (min_order_da >= 0),
  ADD COLUMN IF NOT EXISTS prep_time_min     INTEGER NOT NULL DEFAULT 15
    CHECK (prep_time_min >= 0 AND prep_time_min <= 600),
  ADD COLUMN IF NOT EXISTS accepts_cash      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS accepts_online    BOOLEAN NOT NULL DEFAULT true,

  -- Créneaux de retrait
  ADD COLUMN IF NOT EXISTS pickup_slot_minutes  INTEGER NOT NULL DEFAULT 15
    CHECK (pickup_slot_minutes > 0 AND pickup_slot_minutes <= 240),
  ADD COLUMN IF NOT EXISTS max_orders_per_slot  INTEGER
    CHECK (max_orders_per_slot IS NULL OR max_orders_per_slot > 0);

-- ============================================================================
-- 2. SLUG : unicité + fonction de génération automatique
-- ============================================================================
-- Fonction utilitaire : « Boulangerie El-Karîm » → "boulangerie-el-karim".
-- - Casse : tout en minuscules.
-- - Diacritiques : retirés (unaccent n'est pas garanti partout → translit ASCII).
-- - Caractères non-alphanum : remplacés par '-'.
-- - Compactage des tirets, trim, limite à 60 chars.
CREATE OR REPLACE FUNCTION public.slugify(p_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_slug TEXT;
BEGIN
  IF p_input IS NULL OR btrim(p_input) = '' THEN
    RETURN '';
  END IF;
  v_slug := lower(p_input);
  -- translit basique des accents fréquents (lat-1) sans dépendre de unaccent
  v_slug := translate(
    v_slug,
    'àáâãäåāăąèéêëēĕėęěìíîïīĭįòóôõöōŏőùúûüūŭůűýÿñçœæ',
    'aaaaaaaaaeeeeeeeeeiiiiiiiooooooooouuuuuuuuyyncoa'
  );
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
  v_slug := regexp_replace(v_slug, '^-+|-+$', '', 'g');
  v_slug := substring(v_slug FROM 1 FOR 60);
  IF v_slug = '' THEN
    v_slug := 'commerce';
  END IF;
  RETURN v_slug;
END;
$$;

-- Fonction "unique slug" : si le slug de base existe déjà sur un AUTRE
-- commerçant, on ajoute -2, -3... jusqu'à trouver un libre.
CREATE OR REPLACE FUNCTION public.merchant_unique_slug(
  p_base TEXT,
  p_self_id UUID DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_base    TEXT := public.slugify(p_base);
  v_attempt TEXT;
  v_counter INT  := 1;
BEGIN
  IF v_base = '' THEN
    v_base := 'commerce';
  END IF;
  v_attempt := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.merchants
    WHERE slug = v_attempt
      AND (p_self_id IS NULL OR id <> p_self_id)
  ) LOOP
    v_counter := v_counter + 1;
    v_attempt := v_base || '-' || v_counter::text;
  END LOOP;
  RETURN v_attempt;
END;
$$;

-- Backfill : tous les merchants existants reçoivent un slug unique.
UPDATE public.merchants
SET slug = public.merchant_unique_slug(name, id)
WHERE slug IS NULL OR slug = '';

-- Verrou unicité une fois le backfill fait.
ALTER TABLE public.merchants
  ALTER COLUMN slug SET NOT NULL,
  ADD CONSTRAINT merchants_slug_key UNIQUE (slug);

CREATE INDEX IF NOT EXISTS idx_merchants_slug ON public.merchants(slug);

-- ============================================================================
-- 3. VUE PUBLIQUE — strictement les champs vitrine
-- ============================================================================
-- Le côté client (à construire) consultera cette vue (anon) plutôt que la
-- table directement. Les champs sensibles (commission_rate, is_frozen,
-- user_id, taux surchargés, etc.) ne sont PAS exposés.
CREATE OR REPLACE VIEW public.merchants_public
WITH (security_invoker = true) AS
SELECT
  id,
  slug,
  name,
  category,
  description_fr,
  description_ar,
  logo_url,
  cover_url,
  phone_public,
  city,
  commune,
  wilaya_code,
  address,
  latitude,
  longitude,
  opening_hours,
  min_order_da,
  prep_time_min,
  accepts_cash,
  accepts_online,
  pickup_slot_minutes,
  max_orders_per_slot,
  is_active,
  created_at
FROM public.merchants
WHERE is_active = true;

-- Lecture publique : ouverte à anon + authenticated.
GRANT SELECT ON public.merchants_public TO anon, authenticated;

-- Lecture publique des merchants actifs (nécessaire pour que la vue
-- security_invoker passe RLS quand un anon la requête).
DROP POLICY IF EXISTS "merchants_public_select_active" ON public.merchants;
CREATE POLICY "merchants_public_select_active" ON public.merchants
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- ============================================================================
-- 4. STORAGE — buckets logos / covers + policies dossier par commerçant
-- ============================================================================
-- Création idempotente du bucket public.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('merchant-logos',  'merchant-logos',  true, 2 * 1024 * 1024,
   ARRAY['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('merchant-covers', 'merchant-covers', true, 5 * 1024 * 1024,
   ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Helper : (storage.foldername(name))[1] est l'UUID merchant — le dossier
-- racine du fichier. La policy autorise un commerçant à écrire UNIQUEMENT
-- dans son propre dossier.
CREATE OR REPLACE FUNCTION public.is_storage_owner(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_folder UUID;
BEGIN
  BEGIN
    v_folder := (string_to_array(p_path, '/'))[1]::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN EXISTS (
    SELECT 1 FROM public.merchants
    WHERE id = v_folder AND user_id = auth.uid()
  );
END;
$$;

-- Policies storage : drop+recreate (idempotent) pour les 2 buckets.
DO $$
DECLARE
  v_bucket TEXT;
BEGIN
  FOREACH v_bucket IN ARRAY ARRAY['merchant-logos','merchant-covers'] LOOP
    -- SELECT public (pas de policy à créer : bucket marqué public).

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      v_bucket || '_insert_own'
    );
    EXECUTE format($p$
      CREATE POLICY %I ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = %L AND public.is_storage_owner(name))
    $p$, v_bucket || '_insert_own', v_bucket);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      v_bucket || '_update_own'
    );
    EXECUTE format($p$
      CREATE POLICY %I ON storage.objects
      FOR UPDATE TO authenticated
      USING      (bucket_id = %L AND public.is_storage_owner(name))
      WITH CHECK (bucket_id = %L AND public.is_storage_owner(name))
    $p$, v_bucket || '_update_own', v_bucket, v_bucket);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      v_bucket || '_delete_own'
    );
    EXECUTE format($p$
      CREATE POLICY %I ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = %L AND public.is_storage_owner(name))
    $p$, v_bucket || '_delete_own', v_bucket);
  END LOOP;
END $$;

-- =============================================================================
-- REQUÊTE DE VÉRIFICATION (à exécuter après, dans le SQL Editor) :
--
--   -- Slugs générés ?
--   SELECT id, name, slug FROM public.merchants ORDER BY created_at;
--
--   -- Vue publique accessible (anon depuis l'app) ?
--   SELECT slug, name, opening_hours FROM public.merchants_public LIMIT 5;
--
--   -- Buckets en place ?
--   SELECT id, public, file_size_limit FROM storage.buckets
--   WHERE id IN ('merchant-logos','merchant-covers');
-- =============================================================================

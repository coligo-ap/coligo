-- =============================================================================
-- 0110 — Cohérence livreur ↔ super-admin + verrouillage après vérification
-- =============================================================================
-- Objectif (anti-fraude / protection des données) :
--  • Le livreur renseigne LUI-MÊME, la PREMIÈRE FOIS, son véhicule, ses pièces
--    (avec scans) et ses moyens de versement — DANS LES MÊMES TABLES que celles
--    gérées par le super-admin (cohérence totale).
--  • Une fois le compte VÉRIFIÉ par le super-admin, le livreur ne peut PLUS
--    modifier ses infos : tout devient lecture seule. Il peut seulement
--    soumettre une DEMANDE DE MODIFICATION, appliquée uniquement après
--    approbation de l'équipe super-admin.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Demandes de modification (après vérification)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_change_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('vehicle', 'document', 'payout', 'profile', 'other')),
  note        TEXT NOT NULL,
  payload     JSONB,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_change_requests_driver_idx
  ON public.driver_change_requests (driver_id, status);

ALTER TABLE public.driver_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_change_owner_read ON public.driver_change_requests;
CREATE POLICY driver_change_owner_read ON public.driver_change_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_change_requests.driver_id AND d.user_id = auth.uid()
    )
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS driver_change_owner_insert ON public.driver_change_requests;
CREATE POLICY driver_change_owner_insert ON public.driver_change_requests
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_change_requests.driver_id AND d.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS driver_change_admin_write ON public.driver_change_requests;
CREATE POLICY driver_change_admin_write ON public.driver_change_requests
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 2. Self-service du livreur sur ses pièces / moyens : autorisé UNIQUEMENT tant
--    que le compte n'est PAS vérifié (en plus de l'accès super-admin).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS driver_documents_owner_write ON public.driver_documents;
CREATE POLICY driver_documents_owner_write ON public.driver_documents
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_documents.driver_id
        AND d.user_id = auth.uid()
        AND COALESCE(d.is_verified, false) = false
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_documents.driver_id
        AND d.user_id = auth.uid()
        AND COALESCE(d.is_verified, false) = false
    )
  );

DROP POLICY IF EXISTS driver_payout_owner_write ON public.driver_payout_methods;
CREATE POLICY driver_payout_owner_write ON public.driver_payout_methods
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_payout_methods.driver_id
        AND d.user_id = auth.uid()
        AND COALESCE(d.is_verified, false) = false
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_payout_methods.driver_id
        AND d.user_id = auth.uid()
        AND COALESCE(d.is_verified, false) = false
    )
  );

-- Scans dans le bucket privé : upload par le livreur tant que non vérifié.
DROP POLICY IF EXISTS "driver_docs_owner_write" ON storage.objects;
CREATE POLICY "driver_docs_owner_write" ON storage.objects
  FOR ALL USING (
    bucket_id = 'driver-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.drivers
      WHERE user_id = auth.uid() AND COALESCE(is_verified, false) = false
    )
  ) WITH CHECK (
    bucket_id = 'driver-docs'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.drivers
      WHERE user_id = auth.uid() AND COALESCE(is_verified, false) = false
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Garde-fou sur `drivers` : un livreur ne modifie JAMAIS les colonnes
--    sensibles, et PLUS RIEN une fois vérifié (passe par une demande).
--    Le super-admin (service-role : auth.uid() NULL) et les triggers système
--    (ex. note client → rating, appelés par un AUTRE user) ne sont pas affectés.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drivers_self_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- N'agit QUE sur une auto-modification par le livreur lui-même.
  IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- Colonnes protégées : jamais modifiables par le livreur.
  IF NEW.is_verified   IS DISTINCT FROM OLD.is_verified
  OR NEW.is_frozen     IS DISTINCT FROM OLD.is_frozen
  OR NEW.is_blocked    IS DISTINCT FROM OLD.is_blocked
  OR NEW.verified_at   IS DISTINCT FROM OLD.verified_at
  OR NEW.verified_by   IS DISTINCT FROM OLD.verified_by
  OR NEW.blocked_at    IS DISTINCT FROM OLD.blocked_at
  OR NEW.block_reason  IS DISTINCT FROM OLD.block_reason
  OR NEW.frozen_at     IS DISTINCT FROM OLD.frozen_at
  OR NEW.freeze_reason IS DISTINCT FROM OLD.freeze_reason
  OR NEW.rating_avg    IS DISTINCT FROM OLD.rating_avg
  OR NEW.rating_count  IS DISTINCT FROM OLD.rating_count
  OR NEW.admin_note    IS DISTINCT FROM OLD.admin_note
  OR NEW.user_id       IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'forbidden_protected_field';
  END IF;

  -- Compte vérifié → aucune modification directe (demande obligatoire).
  IF COALESCE(OLD.is_verified, false) THEN
    RAISE EXCEPTION 'profile_locked';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_self_update_guard_trg ON public.drivers;
CREATE TRIGGER drivers_self_update_guard_trg
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW
  EXECUTE FUNCTION public.drivers_self_update_guard();

-- =============================================================================
-- VÉRIF :
--   SELECT * FROM public.driver_change_requests LIMIT 1;
--   -- un livreur vérifié ne peut plus UPDATE sa row (profile_locked).
-- =============================================================================

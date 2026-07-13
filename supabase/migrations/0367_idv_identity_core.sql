-- ============================================================================
-- 0367 — IDV (Identity Verification) : SOCLE de la vérification d'identité
-- automatisée (document + selfie + liveness + comparaison de visage).
--
-- Distinct du « dossier KYC livreur » existant (driver_documents, mig 0352) :
-- IDV est le moteur transverse — pilotable par le super-admin — qui vérifie
-- QUI est la personne (document authentique + visage correspondant), pour
-- n'importe quel profil (livreur, chauffeur, commerçant, …).
--
-- Ce socle pose : la configuration (modes, seuils, règles par profil, types de
-- documents), le dossier de vérification et ses contrôles, le journal d'audit
-- append-only, le bucket privé des captures, et le kill-switch global
-- (feature_flags 'identity_verification', système mig 0182).
--
-- Sécurité :
--   • idv_verifications / idv_checks / idv_audit_log : AUCUNE policy → seul le
--     service_role (server actions auto-gardées) y accède. Le client n'accède
--     JAMAIS directement aux scores/extractions (anti-gaming des seuils).
--   • tables de config : lecture seule authenticated ; sur idv_modes les
--     colonnes de SEUILS sont exclues du grant (visibles admin uniquement).
--   • bucket idv-captures : privé, zéro policy storage → URLs signées serveur.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Modes de vérification (extensible : express, standard, premium…)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idv_modes (
  key            text PRIMARY KEY,
  label_fr       text NOT NULL,
  label_ar       text,
  description_fr text,
  description_ar text,
  position       int  NOT NULL DEFAULT 0,
  enabled        boolean NOT NULL DEFAULT true,

  -- Contrôles exécutés dans ce mode : { "doc_quality": true, "mrz": true, … }
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Réaction aux échecs NON liés au face match :
  -- { "liveness_fail": "reject"|"review", "doc_low_confidence": …,
  --   "expired_document": …, "check_failed": … }
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Seuils de décision (tous les scores sont NORMALISÉS dans [0,1],
  -- quel que soit le backend ML — le service KYC fait la conversion).
  face_match_approve numeric NOT NULL DEFAULT 0.60
    CHECK (face_match_approve >= 0 AND face_match_approve <= 1),
  face_match_reject  numeric NOT NULL DEFAULT 0.35
    CHECK (face_match_reject >= 0 AND face_match_reject <= 1),
  liveness_min       numeric NOT NULL DEFAULT 0.70
    CHECK (liveness_min >= 0 AND liveness_min <= 1),
  doc_confidence_min numeric NOT NULL DEFAULT 0.60
    CHECK (doc_confidence_min >= 0 AND doc_confidence_min <= 1),
  max_attempts       int NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,

  CHECK (face_match_reject < face_match_approve)
);

COMMENT ON TABLE public.idv_modes IS
  'Niveaux de vérification IDV configurables (contrôles + seuils). Écriture super-admin uniquement.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Types de documents supportés (extensible pays / type)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idv_document_types (
  key             text PRIMARY KEY,          -- 'dz_passport' | 'dz_cni' | 'dz_permis' | …
  country         char(2) NOT NULL DEFAULT 'DZ',
  label_fr        text NOT NULL,
  label_ar        text,
  sides           smallint NOT NULL DEFAULT 2 CHECK (sides IN (1, 2)),
  mrz_format      text CHECK (mrz_format IN ('td1', 'td2', 'td3')),
  enabled         boolean NOT NULL DEFAULT true,
  position        int NOT NULL DEFAULT 0,
  -- Champs que le pipeline doit extraire pour ce document (clés normalisées).
  expected_fields jsonb NOT NULL DEFAULT '[]'::jsonb
);

COMMENT ON TABLE public.idv_document_types IS
  'Registre des documents d''identité acceptés. Ajouter un pays/type = une ligne, pas de refonte.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Règles par profil (livreur, chauffeur, commerçant, … extensible)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idv_profile_rules (
  profile     text PRIMARY KEY,              -- 'driver' | 'chauffeur' | 'merchant' | …
  requirement text NOT NULL DEFAULT 'disabled'
    CHECK (requirement IN ('required', 'optional', 'disabled')),
  allowed_modes        text[] NOT NULL DEFAULT ARRAY['standard'],
  default_mode         text NOT NULL DEFAULT 'standard' REFERENCES public.idv_modes(key),
  user_can_choose_mode boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

COMMENT ON TABLE public.idv_profile_rules IS
  'Exigence IDV par profil : obligatoire / facultatif / désactivé + modes autorisés.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Dossiers de vérification
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idv_verifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile       text NOT NULL REFERENCES public.idv_profile_rules(profile),
  mode          text NOT NULL REFERENCES public.idv_modes(key),
  document_type text REFERENCES public.idv_document_types(key),

  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',              -- créé, document pas encore analysé
    'doc_processing',     -- document envoyé, analyse en cours
    'doc_validated',      -- « Document validé » → étape selfie
    'selfie_processing',  -- selfie envoyé, liveness + face match en cours
    'pending_review',     -- zone intermédiaire → revue humaine
    'approved',
    'rejected',
    'resubmit_document',  -- l'admin demande un nouveau document
    'resubmit_selfie',    -- l'admin demande un nouveau selfie
    'canceled',
    'expired'
  )),
  attempt int NOT NULL DEFAULT 1,

  -- Chemins dans le bucket privé idv-captures.
  doc_front_path text,
  doc_back_path  text,
  selfie_path    text,
  selfie_frames  jsonb,          -- frames du défi liveness (chemins)

  -- Résultats d'analyse (JAMAIS exposés au client — service_role uniquement).
  extracted           jsonb,     -- champs extraits (nom, n° document, dates, MRZ…)
  scores              jsonb,     -- { face_match, liveness, doc_confidence, … } ∈ [0,1]
  document_expires_at date,      -- expiration du DOCUMENT (alertes de péremption)

  decision text CHECK (decision IN
    ('auto_approved', 'auto_rejected', 'manual_approved', 'manual_rejected')),
  decision_reason text,
  decided_at      timestamptz,
  decided_by      uuid,          -- admin ; NULL = décision automatique

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Un seul dossier « vivant » par (utilisateur, profil).
CREATE UNIQUE INDEX IF NOT EXISTS idv_verifications_one_active
  ON public.idv_verifications (user_id, profile)
  WHERE status NOT IN ('approved', 'rejected', 'canceled', 'expired');

-- File d'attente de revue humaine (tri FIFO).
CREATE INDEX IF NOT EXISTS idv_verifications_review_queue
  ON public.idv_verifications (created_at)
  WHERE status = 'pending_review';

CREATE INDEX IF NOT EXISTS idv_verifications_user
  ON public.idv_verifications (user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 5) Contrôles individuels (résultat détaillé de chaque check exécuté)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idv_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid NOT NULL REFERENCES public.idv_verifications(id) ON DELETE CASCADE,
  attempt         int NOT NULL DEFAULT 1,
  check_key       text NOT NULL,   -- 'doc_quality' | 'mrz' | 'doc_expiry' | 'ocr_extract'
                                   -- | 'doc_authenticity' | 'liveness_passive'
                                   -- | 'liveness_active' | 'face_match' | …
  status text NOT NULL CHECK (status IN ('passed', 'failed', 'warning', 'skipped', 'error')),
  score   numeric CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idv_checks_verification
  ON public.idv_checks (verification_id, created_at);

-- ────────────────────────────────────────────────────────────────────────────
-- 6) Journal d'audit APPEND-ONLY (aucune FK : le journal survit à tout)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idv_audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  verification_id uuid,            -- volontairement SANS FK (log immuable)
  actor_type      text NOT NULL CHECK (actor_type IN ('system', 'user', 'admin')),
  actor_id        uuid,
  actor_email     text,
  action          text NOT NULL,   -- 'created' | 'document_uploaded' | 'processed'
                                   -- | 'auto_approved' | 'manual_rejected'
                                   -- | 'resubmit_requested' | 'note_added'
                                   -- | 'settings_updated' | …
  reason   text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idv_audit_verification
  ON public.idv_audit_log (verification_id, created_at);

-- Immuabilité : ni UPDATE ni DELETE, même en service_role (trigger, pas RLS).
CREATE OR REPLACE FUNCTION public.idv_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'idv_audit_log est append-only : % interdit', TG_OP;
END $$;

DROP TRIGGER IF EXISTS idv_audit_no_rewrite ON public.idv_audit_log;
CREATE TRIGGER idv_audit_no_rewrite
  BEFORE UPDATE OR DELETE ON public.idv_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.idv_audit_immutable();

-- ────────────────────────────────────────────────────────────────────────────
-- 7) updated_at automatique
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.idv_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS idv_modes_touch ON public.idv_modes;
CREATE TRIGGER idv_modes_touch
  BEFORE UPDATE ON public.idv_modes
  FOR EACH ROW EXECUTE FUNCTION public.idv_touch_updated_at();

DROP TRIGGER IF EXISTS idv_profile_rules_touch ON public.idv_profile_rules;
CREATE TRIGGER idv_profile_rules_touch
  BEFORE UPDATE ON public.idv_profile_rules
  FOR EACH ROW EXECUTE FUNCTION public.idv_touch_updated_at();

DROP TRIGGER IF EXISTS idv_verifications_touch ON public.idv_verifications;
CREATE TRIGGER idv_verifications_touch
  BEFORE UPDATE ON public.idv_verifications
  FOR EACH ROW EXECUTE FUNCTION public.idv_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 8) RLS + privilèges
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.idv_modes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idv_document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idv_profile_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idv_verifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idv_checks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idv_audit_log      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.idv_modes          FROM anon, authenticated;
REVOKE ALL ON public.idv_document_types FROM anon, authenticated;
REVOKE ALL ON public.idv_profile_rules  FROM anon, authenticated;
REVOKE ALL ON public.idv_verifications  FROM anon, authenticated;
REVOKE ALL ON public.idv_checks         FROM anon, authenticated;
REVOKE ALL ON public.idv_audit_log      FROM anon, authenticated;

-- Config lisible par les utilisateurs connectés (affichage du parcours)…
GRANT SELECT ON public.idv_document_types TO authenticated;
GRANT SELECT ON public.idv_profile_rules  TO authenticated;
-- …mais sur idv_modes, les SEUILS et la POLICY restent invisibles
-- (anti-gaming) : grant limité aux colonnes de présentation.
GRANT SELECT (key, label_fr, label_ar, description_fr, description_ar,
              position, enabled, max_attempts)
  ON public.idv_modes TO authenticated;

DROP POLICY IF EXISTS idv_modes_read ON public.idv_modes;
CREATE POLICY idv_modes_read ON public.idv_modes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS idv_document_types_read ON public.idv_document_types;
CREATE POLICY idv_document_types_read ON public.idv_document_types
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS idv_profile_rules_read ON public.idv_profile_rules;
CREATE POLICY idv_profile_rules_read ON public.idv_profile_rules
  FOR SELECT TO authenticated USING (true);

-- idv_verifications / idv_checks / idv_audit_log : AUCUNE policy.
-- Tout passe par les Server Actions (service_role auto-gardé) : le client ne
-- lit jamais scores, extractions ni décisions brutes directement.

-- ────────────────────────────────────────────────────────────────────────────
-- 9) Bucket privé des captures (document + selfie + frames liveness)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('idv-captures', 'idv-captures', false, 10 * 1024 * 1024,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
-- AUCUNE policy storage.objects : lecture/écriture via service_role + URLs
-- signées courtes générées côté serveur uniquement.

-- ────────────────────────────────────────────────────────────────────────────
-- 10) Kill-switch global (système feature_flags, mig 0182)
--     'hidden' par défaut : la fonctionnalité n'est PAS publiée tant que le
--     super-admin ne l'active pas depuis /admin/controle.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.feature_flags (key, status)
VALUES ('identity_verification', 'hidden')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 11) Seeds — modes, documents DZ, règles par profil (tout DÉSACTIVÉ)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.idv_modes
  (key, label_fr, label_ar, description_fr, description_ar, position, checks, policy,
   face_match_approve, face_match_reject, liveness_min, doc_confidence_min, max_attempts)
VALUES
  ('express', 'Vérification rapide', 'تحقق سريع',
   'Contrôles essentiels : document lisible et valide, selfie, comparaison du visage.',
   'فحوصات أساسية: وثيقة مقروءة وسارية، صورة ذاتية، مطابقة الوجه.',
   0,
   '{"doc_quality": true, "ocr_extract": true, "mrz": true, "doc_expiry": true,
     "doc_authenticity": false, "liveness_passive": true, "liveness_active": false,
     "face_match": true}',
   '{"liveness_fail": "review", "doc_low_confidence": "review",
     "expired_document": "reject", "check_failed": "review"}',
   0.62, 0.35, 0.65, 0.55, 3),
  ('standard', 'Vérification standard', 'تحقق قياسي',
   'Contrôles complets : authenticité du document, présence réelle renforcée (défis), comparaison du visage.',
   'فحوصات كاملة: أصالة الوثيقة، تحقق معزز من الحضور الفعلي، مطابقة الوجه.',
   1,
   '{"doc_quality": true, "ocr_extract": true, "mrz": true, "doc_expiry": true,
     "doc_authenticity": true, "liveness_passive": true, "liveness_active": true,
     "face_match": true}',
   '{"liveness_fail": "reject", "doc_low_confidence": "review",
     "expired_document": "reject", "check_failed": "review"}',
   0.60, 0.35, 0.70, 0.60, 3)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.idv_document_types
  (key, country, label_fr, label_ar, sides, mrz_format, position, expected_fields)
VALUES
  ('dz_passport', 'DZ', 'Passeport biométrique', 'جواز السفر البيومتري',
   1, 'td3', 0,
   '["surname", "given_names", "document_number", "nationality",
     "date_of_birth", "sex", "date_of_expiry", "nin"]'),
  ('dz_cni', 'DZ', 'Carte nationale d''identité biométrique', 'بطاقة التعريف الوطنية البيومترية',
   2, 'td1', 1,
   '["surname", "given_names", "document_number", "nin",
     "date_of_birth", "sex", "date_of_expiry"]'),
  ('dz_permis', 'DZ', 'Permis de conduire biométrique', 'رخصة السياقة البيومترية',
   2, NULL, 2,
   '["surname", "given_names", "document_number",
     "date_of_birth", "date_of_expiry", "categories"]')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.idv_profile_rules
  (profile, requirement, allowed_modes, default_mode, user_can_choose_mode)
VALUES
  ('driver',    'disabled', ARRAY['express', 'standard'], 'standard', false),
  ('chauffeur', 'disabled', ARRAY['express', 'standard'], 'standard', false),
  ('merchant',  'disabled', ARRAY['express', 'standard'], 'standard', false)
ON CONFLICT (profile) DO NOTHING;

-- =============================================================================
-- Coligo v3 - Migration 0361 : recherche par CODE-BARRES (phase 1)
-- =============================================================================
-- Le client scanne un EAN (accueil marketplace / fiche commerçant) → on résout
-- le NOM du produit puis on l'injecte dans la recherche texte existante.
-- Résolution : 1) catalogue LOCAL ci-dessous (géré par les super-admins,
-- auto-enrichi par OpenFoodFacts à chaque scan résolu — il devient la base
-- algérienne au fil de l'eau) ; 2) repli OpenFoodFacts (fetch côté serveur).
-- Pilotage super-admin : deux feature_flags (une par surface) sur
-- /admin/controle + CRUD du catalogue sur /admin/codes-barres.
-- =============================================================================

-- 1) Catalogue local code-barres → nom produit.
CREATE TABLE IF NOT EXISTS public.barcode_catalog (
  barcode      TEXT PRIMARY KEY CHECK (barcode ~ '^[0-9]{8,14}$'),
  product_name TEXT NOT NULL,
  brand        TEXT,
  -- 'admin' = saisi/corrigé par l'équipe (prioritaire, jamais écrasé par le
  -- repli) ; 'openfoodfacts' = auto-enrichi lors d'un scan résolu.
  source       TEXT NOT NULL DEFAULT 'admin'
               CHECK (source IN ('admin', 'openfoodfacts')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lecture/écriture UNIQUEMENT via le serveur (service_role) : RLS sans policy.
ALTER TABLE public.barcode_catalog ENABLE ROW LEVEL SECURITY;

-- 2) Journal des scans — sert aux admins à ENRICHIR le catalogue (les scans
--    non résolus remontent sur /admin/codes-barres) et à mesurer l'usage.
CREATE TABLE IF NOT EXISTS public.barcode_scan_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode      TEXT NOT NULL,
  resolved     BOOLEAN NOT NULL,
  source       TEXT,
  product_name TEXT,
  surface      TEXT NOT NULL CHECK (surface IN ('marketplace', 'merchant')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bsl_created
  ON public.barcode_scan_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bsl_unresolved
  ON public.barcode_scan_log(resolved, created_at DESC);

ALTER TABLE public.barcode_scan_log ENABLE ROW LEVEL SECURITY;

-- 3) Kill-switches par SURFACE (réutilise le système feature_flags mig 0182 :
--    active / hidden / coming_soon / maintenance, pilotés sur /admin/controle).
INSERT INTO public.feature_flags (key)
VALUES ('barcode_marketplace'), ('barcode_merchant')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- VÉRIFICATION :
--   SELECT key, status FROM feature_flags WHERE key LIKE 'barcode%';
--   INSERT INTO barcode_catalog (barcode, product_name) VALUES ('123', 'x');
--     -- → échec CHECK (8-14 chiffres requis)
-- =============================================================================

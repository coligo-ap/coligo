-- ============================================================
-- 0148 — Drive : validation des documents chauffeur PIÈCE PAR PIÈCE
-- + coordonnées de paiement du chauffeur (CCP).
--
-- Obligatoire pour activer le compte : permis (recto + verso),
-- carte grise, photo de plaque, selfie en direct, identité complète
-- (nom, prénom, téléphone, date de naissance, ville).
-- Facultatif : assurance (« si disponible »), adresse domicile,
-- CCP du chauffeur (requis seulement avant le PREMIER versement).
-- ============================================================

ALTER TABLE public.chauffeur_documents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS review_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Un document re-soumis par le chauffeur repasse en 'pending'.
CREATE OR REPLACE FUNCTION public.chauffeur_doc_reset_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.url IS DISTINCT FROM OLD.url THEN
    NEW.status := 'pending';
    NEW.review_note := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_chauffeur_doc_reset ON public.chauffeur_documents;
CREATE TRIGGER trg_chauffeur_doc_reset
  BEFORE UPDATE ON public.chauffeur_documents
  FOR EACH ROW EXECUTE FUNCTION public.chauffeur_doc_reset_status();

-- Coordonnées de versement du chauffeur (facultatif à l'inscription).
ALTER TABLE public.chauffeurs
  ADD COLUMN IF NOT EXISTS ccp_number TEXT,
  ADD COLUMN IF NOT EXISTS ccp_key TEXT;

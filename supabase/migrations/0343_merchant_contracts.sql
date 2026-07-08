-- ============================================================================
-- 0343 : CONTRATS COMMERÇANTS — générés par le super-admin (hub Commerçants).
--
-- Le contrat de partenariat commercial (droit algérien : loi 18-05 e-commerce,
-- acte sous seing privé art. 327 code civil) est émis par la plateforme,
-- téléchargé en PDF, signé de façon manuscrite par le commerçant (« lu et
-- approuvé » + cachet) puis marqué signé ici. Les informations des parties et
-- les conditions financières sont FIGÉES à l'émission (jsonb) : le document
-- reste opposable même si la fiche commerçant évolue ensuite.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.merchant_contract_seq;

CREATE TABLE public.merchant_contracts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number  text NOT NULL UNIQUE,
  merchant_id      uuid REFERENCES public.merchants(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'issued'
                   CHECK (status IN ('issued', 'signed', 'terminated')),
  -- Identification du commerçant figée à l'émission (raison sociale, forme
  -- juridique, RC, NIF, adresse, représentant, contacts…).
  party            jsonb NOT NULL,
  -- Conditions figées : commissions, délais de reversement/versement, plafond
  -- d'endettement, durée, préavis, lieu de signature, date d'effet…
  terms            jsonb NOT NULL,
  created_by       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Traçabilité de la signature : scan du contrat signé (bucket privé
  -- merchant-contracts) + qui l'a enregistré et quand.
  signed_at        timestamptz,
  signed_by        uuid REFERENCES auth.users(id),
  signed_file_path text,
  terminated_at    timestamptz,
  notes            text
);

CREATE INDEX merchant_contracts_merchant_idx
  ON public.merchant_contracts (merchant_id, created_at DESC);

-- Numéro lisible et strictement croissant : CTR-2026-0001, CTR-2026-0002…
CREATE OR REPLACE FUNCTION public.set_merchant_contract_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contract_number IS NULL OR NEW.contract_number = '' THEN
    NEW.contract_number :=
      'CTR-' || to_char(now() AT TIME ZONE 'Africa/Algiers', 'YYYY') || '-' ||
      lpad(nextval('public.merchant_contract_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER merchant_contracts_number
  BEFORE INSERT ON public.merchant_contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_merchant_contract_number();

-- ── RLS : réservé aux admins du domaine « commercants » (RBAC mig 0301) ──────
ALTER TABLE public.merchant_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY merchant_contracts_admin_select ON public.merchant_contracts
  FOR SELECT TO authenticated
  USING (public.admin_can('commercants'));

CREATE POLICY merchant_contracts_admin_insert ON public.merchant_contracts
  FOR INSERT TO authenticated
  WITH CHECK (public.admin_can('commercants') AND created_by = auth.uid());

CREATE POLICY merchant_contracts_admin_update ON public.merchant_contracts
  FOR UPDATE TO authenticated
  USING (public.admin_can('commercants'))
  WITH CHECK (public.admin_can('commercants'));

-- Pas de DELETE : un contrat émis se résilie (terminated), il ne s'efface pas.
REVOKE ALL ON public.merchant_contracts FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.merchant_contracts TO authenticated;
GRANT USAGE ON SEQUENCE public.merchant_contract_seq TO authenticated;

-- ── Bucket privé des contrats signés (scans PDF/photo uploadés par l'admin) ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('merchant-contracts', 'merchant-contracts', false, 15 * 1024 * 1024,
        ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "merchant_contracts_files_admin" ON storage.objects;
CREATE POLICY "merchant_contracts_files_admin" ON storage.objects
  FOR ALL USING (
    bucket_id = 'merchant-contracts' AND public.admin_can('commercants')
  ) WITH CHECK (
    bucket_id = 'merchant-contracts' AND public.admin_can('commercants')
  );

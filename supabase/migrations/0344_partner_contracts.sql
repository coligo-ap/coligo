-- ============================================================================
-- 0344 : CONTRATS PARTENAIRES (livreurs + chauffeurs) — pendant de la mig 0343
-- (contrats commerçants). Une seule table, `partner_kind` distingue le livreur
-- (domaine admin « livraison ») du chauffeur (domaine « drive ») ; les RLS
-- suivent le domaine du partenaire. Numérotation par registre : CTL-YYYY-NNNN
-- (livreurs) / CTC-YYYY-NNNN (chauffeurs). party/terms figés à l'émission.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.partner_contract_seq_driver;
CREATE SEQUENCE IF NOT EXISTS public.partner_contract_seq_chauffeur;

CREATE TABLE public.partner_contracts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number  text NOT NULL UNIQUE,
  partner_kind     text NOT NULL CHECK (partner_kind IN ('driver', 'chauffeur')),
  -- id dans drivers/chauffeurs selon le kind (pas de FK possible sur 2 tables).
  partner_id       uuid,
  status           text NOT NULL DEFAULT 'issued'
                   CHECK (status IN ('issued', 'signed', 'terminated')),
  party            jsonb NOT NULL,
  terms            jsonb NOT NULL,
  created_by       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  signed_at        timestamptz,
  signed_by        uuid REFERENCES auth.users(id),
  signed_file_path text,
  terminated_at    timestamptz,
  notes            text
);

CREATE INDEX partner_contracts_partner_idx
  ON public.partner_contracts (partner_kind, partner_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_partner_contract_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contract_number IS NULL OR NEW.contract_number = '' THEN
    IF NEW.partner_kind = 'driver' THEN
      NEW.contract_number :=
        'CTL-' || to_char(now() AT TIME ZONE 'Africa/Algiers', 'YYYY') || '-' ||
        lpad(nextval('public.partner_contract_seq_driver')::text, 4, '0');
    ELSE
      NEW.contract_number :=
        'CTC-' || to_char(now() AT TIME ZONE 'Africa/Algiers', 'YYYY') || '-' ||
        lpad(nextval('public.partner_contract_seq_chauffeur')::text, 4, '0');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER partner_contracts_number
  BEFORE INSERT ON public.partner_contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_partner_contract_number();

-- ── RLS : le domaine admin requis dépend du type de partenaire ───────────────
CREATE OR REPLACE FUNCTION public.partner_contract_domain(p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE WHEN p_kind = 'driver' THEN 'livraison' ELSE 'drive' END $$;

ALTER TABLE public.partner_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY partner_contracts_admin_select ON public.partner_contracts
  FOR SELECT TO authenticated
  USING (public.admin_can(public.partner_contract_domain(partner_kind)));

CREATE POLICY partner_contracts_admin_insert ON public.partner_contracts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.admin_can(public.partner_contract_domain(partner_kind))
    AND created_by = auth.uid()
  );

CREATE POLICY partner_contracts_admin_update ON public.partner_contracts
  FOR UPDATE TO authenticated
  USING (public.admin_can(public.partner_contract_domain(partner_kind)))
  WITH CHECK (public.admin_can(public.partner_contract_domain(partner_kind)));

-- Pas de DELETE : un contrat émis se résilie, il ne s'efface pas.
REVOKE ALL ON public.partner_contracts FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.partner_contracts TO authenticated;
GRANT USAGE ON SEQUENCE public.partner_contract_seq_driver TO authenticated;
GRANT USAGE ON SEQUENCE public.partner_contract_seq_chauffeur TO authenticated;

-- ── Bucket privé des scans signés (mêmes règles que merchant-contracts) ──────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('partner-contracts', 'partner-contracts', false, 15 * 1024 * 1024,
        ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "partner_contracts_files_admin" ON storage.objects;
CREATE POLICY "partner_contracts_files_admin" ON storage.objects
  FOR ALL USING (
    bucket_id = 'partner-contracts'
    AND (public.admin_can('livraison') OR public.admin_can('drive'))
  ) WITH CHECK (
    bucket_id = 'partner-contracts'
    AND (public.admin_can('livraison') OR public.admin_can('drive'))
  );

-- =============================================================================
-- 0104 — Gestion des profils livreurs côté SUPER-ADMIN
-- =============================================================================
-- Le super-admin doit pouvoir gérer le profil complet d'un livreur :
--   • véhicule (type, marque/modèle, immatriculation, couleur, année) ;
--   • pièces d'identité (CNI, permis, carte grise, passeport) avec numéro +
--     dates de validité/expiration → table `driver_documents` ;
--   • moyens de versement multiples (espèces, CCP, BaridiMob, virement) avec
--     numéro de compte → table `driver_payout_methods` ;
--   • vérification du profil (vérifié / non vérifié) + note interne ;
--   • gel/blocage (déjà `is_frozen`) — durci ici : un livreur gelé ne peut PLUS
--     passer en ligne ni recevoir de course (toutes les portes fermées) ;
--   • retrait/réattribution instantané d'une commande de livraison
--     (`admin_reassign_delivery` : remise au réseau OU à un livreur donné ;
--     l'annulation passe par `admin_cancel_order` existant).
--
-- Les FINANCES (gain brut/net, cotisations, dû plateforme/au livreur sur une
-- période) sont déjà calculables depuis `delivery_ledger` / `orders` /
-- `driver_statements` → pas de nouvelle table, juste lecture côté admin.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colonnes profil sur `drivers`
-- ----------------------------------------------------------------------------
ALTER TABLE public.drivers
  -- Véhicule (vehicle_label / vehicle_plate existent déjà).
  ADD COLUMN IF NOT EXISTS vehicle_type        TEXT,    -- moto / scooter / voiture / velo / camionnette
  ADD COLUMN IF NOT EXISTS vehicle_brand       TEXT,    -- marque (ex. Yamaha)
  ADD COLUMN IF NOT EXISTS vehicle_model       TEXT,    -- modèle (ex. NMAX)
  ADD COLUMN IF NOT EXISTS vehicle_color       TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_year        INTEGER,
  -- Identité (les pièces détaillées vont dans driver_documents ; ici les
  -- références rapides demandées explicitement).
  ADD COLUMN IF NOT EXISTS national_id_number  TEXT,    -- numéro national
  ADD COLUMN IF NOT EXISTS id_card_number      TEXT,    -- numéro carte d'identité
  ADD COLUMN IF NOT EXISTS date_of_birth       DATE,
  ADD COLUMN IF NOT EXISTS address             TEXT,
  -- Vérification administrative du profil.
  ADD COLUMN IF NOT EXISTS is_verified         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by         TEXT,
  ADD COLUMN IF NOT EXISTS admin_note          TEXT;

-- ----------------------------------------------------------------------------
-- 2. Documents d'identité du livreur (1 livreur → N pièces)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('cni', 'permis', 'carte_grise', 'passeport', 'autre')),
  number      TEXT,
  issued_at   DATE,
  expires_at  DATE,
  file_url    TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_documents_driver_idx
  ON public.driver_documents (driver_id);

-- ----------------------------------------------------------------------------
-- 3. Moyens de versement (1 livreur → N moyens ; paiement multi-moyens)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.driver_payout_methods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  method          TEXT NOT NULL CHECK (method IN ('especes', 'ccp', 'baridimob', 'virement')),
  label           TEXT,                 -- libellé libre (ex. « Compte perso »)
  account_number  TEXT,                 -- numéro de compte / CCP / RIP / RIB
  account_name    TEXT,                 -- titulaire
  is_default      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS driver_payout_methods_driver_idx
  ON public.driver_payout_methods (driver_id);

-- ----------------------------------------------------------------------------
-- 4. RLS — le livreur lit SES pièces / moyens ; l'écriture passe par le
--    service-role (super-admin). Le super-admin lit tout via service-role
--    (bypass RLS) ou via is_super_admin().
-- ----------------------------------------------------------------------------
ALTER TABLE public.driver_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_payout_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_documents_owner_read ON public.driver_documents;
CREATE POLICY driver_documents_owner_read ON public.driver_documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_documents.driver_id AND d.user_id = auth.uid()
    )
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS driver_documents_admin_write ON public.driver_documents;
CREATE POLICY driver_documents_admin_write ON public.driver_documents
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS driver_payout_owner_read ON public.driver_payout_methods;
CREATE POLICY driver_payout_owner_read ON public.driver_payout_methods
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_payout_methods.driver_id AND d.user_id = auth.uid()
    )
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS driver_payout_admin_write ON public.driver_payout_methods;
CREATE POLICY driver_payout_admin_write ON public.driver_payout_methods
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 5. Un seul moyen de versement « par défaut » par livreur (trigger).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_payout_single_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.driver_payout_methods
      SET is_default = false
      WHERE driver_id = NEW.driver_id AND id <> NEW.id AND is_default;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_payout_single_default_trg ON public.driver_payout_methods;
CREATE TRIGGER driver_payout_single_default_trg
  AFTER INSERT OR UPDATE OF is_default ON public.driver_payout_methods
  FOR EACH ROW WHEN (NEW.is_default)
  EXECUTE FUNCTION public.driver_payout_single_default();

-- ----------------------------------------------------------------------------
-- 6. Durcissement du GEL : un livreur gelé ne peut ni passer en ligne ni
--    recevoir une course (toutes les portes, pas seulement le pull nearby qui
--    le bloquait déjà).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_driver_availability(
  p_merchant_driver_id uuid, p_status driver_avail_status)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user UUID;
  v_frozen BOOLEAN;
  v_current_order UUID;
BEGIN
  SELECT d.user_id, COALESCE(d.is_frozen, false)
    INTO v_user, v_frozen
  FROM public.merchant_drivers md
  JOIN public.drivers d ON d.id = md.driver_id
  WHERE md.id = p_merchant_driver_id AND md.status = 'active';

  IF v_user IS NULL OR v_user <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Gelé → seul le retour « offline » est permis ; impossible de se mettre
  -- « available »/« busy ».
  IF v_frozen AND p_status <> 'offline' THEN
    RAISE EXCEPTION 'account_frozen';
  END IF;

  SELECT current_order_id INTO v_current_order
  FROM public.driver_availability WHERE merchant_driver_id = p_merchant_driver_id;

  IF v_current_order IS NOT NULL AND p_status <> 'busy' THEN
    RAISE EXCEPTION 'has_pending_order';
  END IF;

  INSERT INTO public.driver_availability (merchant_driver_id, status)
    VALUES (p_merchant_driver_id, p_status)
    ON CONFLICT (merchant_driver_id)
    DO UPDATE SET status = p_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.pull_next_express(p_merchant_driver_id uuid)
RETURNS TABLE(order_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_driver_user_id UUID;
  v_merchant_id    UUID;
  v_driver_id      UUID;
  v_frozen         BOOLEAN;
  v_order_id       UUID;
BEGIN
  SELECT d.user_id, md.merchant_id, md.driver_id, COALESCE(d.is_frozen, false)
    INTO v_driver_user_id, v_merchant_id, v_driver_id, v_frozen
  FROM public.merchant_drivers md
  JOIN public.drivers d ON d.id = md.driver_id
  WHERE md.id = p_merchant_driver_id
    AND md.status = 'active';

  IF v_driver_user_id IS NULL OR v_driver_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Gelé → aucune attribution.
  IF v_frozen THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.driver_availability
    WHERE merchant_driver_id = p_merchant_driver_id AND status = 'busy'
  ) THEN
    RETURN;
  END IF;

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.merchant_id = v_merchant_id
    AND o.fulfillment_type = 'delivery'
    AND o.delivery_mode = 'express'
    AND o.delivery_driver_id IS NULL
    AND o.status IN ('preparing', 'ready')
    AND (
      o.prep_notif_at IS NULL
      OR o.marked_ready_at IS NOT NULL
      OR o.status = 'ready'
      OR o.prep_notif_at <= now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.express_declines ed
      WHERE ed.order_id = o.id
        AND ed.driver_id = v_driver_id
        AND ed.declined_at > now() - interval '10 minutes'
    )
  ORDER BY o.created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.orders
    SET delivery_driver_id = v_driver_id,
        driver_notified_at = COALESCE(driver_notified_at, now())
    WHERE id = v_order_id;

  INSERT INTO public.driver_availability (merchant_driver_id, status, current_order_id)
    VALUES (p_merchant_driver_id, 'busy', v_order_id)
    ON CONFLICT (merchant_driver_id)
    DO UPDATE SET status = 'busy', current_order_id = v_order_id;

  RETURN QUERY SELECT v_order_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Réattribution d'une commande de livraison par le super-admin.
--    p_mode = 'pool'   → retire au livreur + remet au réseau (re-pull possible
--                        par un AUTRE livreur ; cooldown 10 min sur l'ancien).
--    p_mode = 'driver' → attribue à un livreur précis (non gelé).
--    (L'annulation passe par admin_cancel_order, qui gère remboursements.)
--    Sécurité : pré-retrait uniquement (pas encore récupérée chez le commerçant)
--    pour ne pas casser la custody du cash.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reassign_delivery(
  p_order_id uuid,
  p_mode text,
  p_driver_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_order      public.orders%ROWTYPE;
  v_old_driver UUID;
  v_md_id      UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_order.fulfillment_type <> 'delivery' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivery');
  END IF;
  IF v_order.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_terminal');
  END IF;
  IF v_order.delivery_picked_up_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_picked_up');
  END IF;

  v_old_driver := v_order.delivery_driver_id;

  -- Libère la disponibilité de l'ancien livreur (paire occupée par CETTE cmd).
  IF v_old_driver IS NOT NULL THEN
    UPDATE public.driver_availability da
      SET status = 'available', current_order_id = NULL
      FROM public.merchant_drivers md
      WHERE da.merchant_driver_id = md.id
        AND md.driver_id = v_old_driver
        AND da.current_order_id = p_order_id;
  END IF;

  IF p_mode = 'pool' THEN
    UPDATE public.orders
      SET delivery_driver_id = NULL,
          driver_notified_at = NULL,
          delivery_arrived_at = NULL
      WHERE id = p_order_id;
    -- Empêche l'ancien livreur de re-prendre immédiatement (cooldown 10 min).
    IF v_old_driver IS NOT NULL THEN
      INSERT INTO public.express_declines (order_id, driver_id)
        VALUES (p_order_id, v_old_driver)
        ON CONFLICT (order_id, driver_id) DO UPDATE SET declined_at = now();
    END IF;

  ELSIF p_mode = 'driver' THEN
    IF p_driver_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'driver_required');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.drivers
      WHERE id = p_driver_id AND COALESCE(is_frozen, false) = false
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'driver_unavailable');
    END IF;

    UPDATE public.orders
      SET delivery_driver_id = p_driver_id,
          driver_notified_at = now(),
          delivery_arrived_at = NULL
      WHERE id = p_order_id;

    -- Si le livreur a une paire active chez ce commerçant, on la passe busy.
    SELECT md.id INTO v_md_id
    FROM public.merchant_drivers md
    WHERE md.driver_id = p_driver_id
      AND md.merchant_id = v_order.merchant_id
      AND md.status = 'active'
    LIMIT 1;
    IF v_md_id IS NOT NULL THEN
      INSERT INTO public.driver_availability (merchant_driver_id, status, current_order_id)
        VALUES (v_md_id, 'busy', p_order_id)
        ON CONFLICT (merchant_driver_id)
        DO UPDATE SET status = 'busy', current_order_id = p_order_id;
    END IF;
    -- Laisse re-prendre cette commande même si l'ancien l'avait « déclinée ».
    DELETE FROM public.express_declines
      WHERE order_id = p_order_id AND driver_id = p_driver_id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_mode');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'merchant_id', v_order.merchant_id,
    'old_driver_id', v_old_driver,
    'order_number', v_order.order_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reassign_delivery(uuid, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_reassign_delivery(uuid, text, uuid) TO authenticated;

-- =============================================================================
-- VÉRIF :
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='drivers' AND column_name IN
--       ('vehicle_type','national_id_number','is_verified');
--   SELECT * FROM public.driver_documents LIMIT 1;
--   SELECT * FROM public.driver_payout_methods LIMIT 1;
-- =============================================================================

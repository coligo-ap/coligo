-- =============================================================================
-- 0406 — Panier partagé : lien de paiement invité + expiration/rappels.
-- =============================================================================
-- Le capitaine passe la commande (classique, sur SON compte) puis peut
-- « faire payer un proche » : un payment_token distinct du share_token ouvre
-- la page publique /payer/{ptoken}. L'invité y (re)génère une session Chargily
-- pour LA commande du capitaine — metadata type 'order' inchangée → le webhook
-- existant fait foi, « premier paiement gagne » par l'UPDATE conditionnel.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Flag « carte internationale » du sélecteur invité (grisé « Bientôt ») :
--    branchable plus tard sur le rail stripe_eur SANS refonte.
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags (key, status, title_fr, title_ar, message_fr, message_ar)
VALUES (
  'intl_card', 'coming_soon',
  'Carte internationale', 'البطاقة الدولية',
  'Le paiement par carte internationale arrive bientôt.',
  'الدفع بالبطاقة الدولية قادم قريباً.'
)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. RPC shared_cart_payment_info(ptoken) — TOUT ce que voit la page /payer :
--    rassurante (prénom capitaine, commerçant, montant) et JAMAIS plus.
--    NULL si token inconnu. GRANT anon.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_cart_payment_info(p_payment_token text)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart public.shared_carts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_captain text;
BEGIN
  IF public.feature_blocked('shared_cart') THEN RETURN NULL; END IF;

  SELECT * INTO v_cart FROM public.shared_carts
   WHERE payment_token = p_payment_token;
  IF v_cart.id IS NULL OR v_cart.order_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_cart.order_id;
  IF v_order.id IS NULL THEN RETURN NULL; END IF;

  SELECT split_part(btrim(COALESCE(c.full_name, '')), ' ', 1) INTO v_captain
    FROM public.customers c WHERE c.id = v_cart.captain_customer_id;

  RETURN jsonb_build_object(
    'captain_name', NULLIF(v_captain, ''),
    'merchant', (
      SELECT jsonb_build_object('name', m.name, 'logo_url', m.logo_url)
        FROM public.merchants m WHERE m.id = v_cart.merchant_id
    ),
    'total_da', v_order.total_da,
    'payment_status', v_order.payment_status,
    'order_status', v_order.status,
    'share_token', v_cart.share_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_payment_info(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shared_cart_payment_info(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. expire_shared_carts() — cron (service uniquement). Trois responsabilités :
--    a) paniers open|locked NON commandés dépassés → expired ;
--    b) rappels ~24 h avant expiration (renvoyés au cron pour push, marqués) ;
--    c) REPRISE DE MAIN : panier `ordered` dont la commande liée a été ANNULÉE
--       sans paiement (échec invité, fenêtre 60 min dépassée…) → retour
--       `locked`, order_id/payment_token nettoyés — le capitaine recommande.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_shared_carts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired integer;
  v_reopened integer;
  v_reminders jsonb;
BEGIN
  UPDATE public.shared_carts
     SET status = 'expired', updated_at = now()
   WHERE status IN ('open', 'locked') AND order_id IS NULL
     AND expires_at < now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  UPDATE public.shared_carts sc
     SET status = 'locked', order_id = NULL, payment_token = NULL,
         payment_token_created_at = NULL, updated_at = now()
    FROM public.orders o
   WHERE sc.status = 'ordered' AND o.id = sc.order_id
     AND o.status = 'cancelled'
     AND o.payment_status NOT IN ('paid', 'refunded');
  GET DIAGNOSTICS v_reopened = ROW_COUNT;

  -- Rappels : paniers OUVERTS avec des articles, à moins de 24 h de
  -- l'expiration, jamais rappelés. Marqués dans la même requête (idempotent).
  WITH marked AS (
    UPDATE public.shared_carts sc
       SET reminder_sent_at = now()
     WHERE sc.status = 'open'
       AND sc.reminder_sent_at IS NULL
       AND sc.expires_at BETWEEN now() AND now() + interval '24 hours'
       AND EXISTS (SELECT 1 FROM public.shared_cart_items i WHERE i.cart_id = sc.id)
     RETURNING sc.id, sc.share_token, sc.captain_customer_id, sc.merchant_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'share_token', m.share_token,
           'captain_customer_id', m.captain_customer_id,
           'merchant_name', (SELECT name FROM public.merchants WHERE id = m.merchant_id)
         )), '[]'::jsonb)
    INTO v_reminders
    FROM marked m;

  RETURN jsonb_build_object(
    'expired', v_expired,
    'reopened', v_reopened,
    'reminders', v_reminders
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_shared_carts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_shared_carts() TO service_role;

-- =============================================================================
-- VÉRIFICATION :
--   SELECT public.shared_cart_payment_info('xxx');  -- NULL (anon OK)
--   SELECT public.expire_shared_carts();            -- (service) {expired:0,...}
-- =============================================================================

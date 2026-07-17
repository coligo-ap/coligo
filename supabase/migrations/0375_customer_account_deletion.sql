-- ============================================================================
-- 0375 — SUPPRESSION DE COMPTE CLIENT façon Uber/Bolt : anonymisation ATOMIQUE
--
-- La suppression app échouait (deleteMyCustomerAccount) : la suite d'updates
-- côté Node n'était pas transactionnelle et butait sur des contraintes venues
-- de chantiers postérieurs :
--   • customers.sos_contacts NOT NULL DEFAULT '[]' (chantier SOS) → NULL refusé ;
--   • orders_delivery_geo_required → delivery_lat/lng NULL refusés sur les
--     commandes livrées.
--
-- Principe (identique aux grandes plateformes) : le compte DISPARAÎT pour
-- l'utilisateur, mais AUCUN impact sur la comptabilité, les métriques ni les
-- registres commerçant/livreur/chauffeur :
--   • la ligne `customers` RESTE (pivot des commandes, courses, wallets,
--     ledgers, no-show, anti-fraude) — seule la PII est effacée ;
--   • commandes/courses/écritures financières : INTACTES ; on efface la PII
--     textuelle (nom, téléphone, adresse, note) et on ARRONDIT les coordonnées
--     de livraison à ~1 km (2 décimales) : le domicile exact disparaît, la
--     contrainte géo et les stats de zone restent satisfaites ;
--   • données purement personnelles (adresses, favoris, tokens push) :
--     supprimées ;
--   • le compte auth est neutralisé côté Node (email brouillé → réutilisable,
--     mot de passe aléatoire, ban ~100 ans).
--
-- TOUT-OU-RIEN : une seule fonction SQL = une transaction. Plus jamais de
-- compte à moitié anonymisé quand une étape casse.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.customer_anonymize_data(p_customer UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_user UUID;
BEGIN
  SELECT user_id INTO v_user FROM public.customers WHERE id = p_customer;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Gardes re-vérifiées côté SQL (bypass-proof) : rien d'« en vol ».
  IF EXISTS (SELECT 1 FROM public.orders o
              WHERE o.customer_id = p_customer
                AND o.status NOT IN ('completed','cancelled')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_order');
  END IF;
  IF EXISTS (SELECT 1 FROM public.rides r
              WHERE r.customer_id = p_customer
                AND r.status NOT IN ('completed','cancelled')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_ride');
  END IF;

  -- 1) Profil : PII effacée, la ligne reste (pivot comptable).
  --    sos_contacts est NOT NULL DEFAULT '[]' → on VIDE, on ne nullifie pas.
  UPDATE public.customers SET
    full_name          = 'Compte supprimé',
    phone              = NULL,
    email              = NULL,
    pay_handle         = NULL,
    latitude           = NULL,
    longitude          = NULL,
    default_wilaya_code = NULL,
    default_commune    = NULL,
    sos_contacts       = '[]'::jsonb
  WHERE id = p_customer;

  -- 2) Commandes : snapshots PII effacés, coordonnées ARRONDIES (~1 km) pour
  --    satisfaire orders_delivery_geo_required sans garder l'adresse exacte.
  --    Les colonnes financières ne sont PAS touchées (guard mig 0166 intact).
  UPDATE public.orders SET
    customer_name           = 'Client supprimé',
    customer_phone          = '',
    customer_note           = NULL,
    delivery_address_text   = NULL,
    delivery_recipient_name = NULL,
    delivery_lat            = round(delivery_lat::numeric, 2)::float8,
    delivery_lng            = round(delivery_lng::numeric, 2)::float8
  WHERE customer_id = p_customer;

  -- 3) Courses : adresses TEXTUELLES effacées (les coordonnées restent —
  --    NOT NULL + apprentissage des prix / stats de zone, comme Uber).
  UPDATE public.rides SET
    pickup_text = NULL,
    dest_text   = NULL
  WHERE customer_id = p_customer;

  -- 4) Données purement personnelles : suppression réelle.
  DELETE FROM public.customer_addresses          WHERE customer_id = p_customer;
  DELETE FROM public.customer_favorites          WHERE customer_id = p_customer;
  DELETE FROM public.customer_favorite_chauffeurs WHERE customer_id = p_customer;
  IF v_user IS NOT NULL THEN
    DELETE FROM public.device_tokens WHERE user_id = v_user;
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', v_user);
END $$;

-- service_role uniquement (appelée par le serveur après ses propres gardes).
REVOKE ALL ON FUNCTION public.customer_anonymize_data(UUID) FROM PUBLIC, anon, authenticated;

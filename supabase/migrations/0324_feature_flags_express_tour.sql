-- =============================================================================
-- 0324 — Kill-switch EXPRESS / TOURNÉE réellement enforcé (audit 04/07, A6)
-- =============================================================================
-- /admin/controle promettait un « kill-switch par service », mais seuls drive /
-- online_payment / coligo_pay / cashback avaient une garde serveur. Les modes
-- de LIVRAISON n'existaient même pas comme flags : couper l'express n'était
-- possible qu'en masquant l'UI (bypassable en appelant l'API).
--
-- Correctif :
--   • deux nouveaux flags : 'express' et 'tour' (visibles dans /admin/controle,
--     libellés ajoutés côté front dans le même commit) ;
--   • trigger BEFORE INSERT sur orders : nouvelle commande en livraison du mode
--     coupé → REFUS net ('feature_disabled:express' / ':tour', mappé en message
--     clair au checkout). Bridé aux rôles de connexion (authenticated/anon,
--     pattern 0269) : service_role/DEFINER passent (corrections, seeds).
--   • le dispatch express vérifie déjà feature_blocked('express') (mig 0323).
--   • les commandes DÉJÀ créées poursuivent leur cycle (on coupe le robinet,
--     on ne casse pas l'existant — même philosophie que le flag cashback).
-- =============================================================================

INSERT INTO public.feature_flags (key)
VALUES ('express'), ('tour')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_feature_delivery_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF NEW.fulfillment_type IS DISTINCT FROM 'delivery' THEN RETURN NEW; END IF;

  IF NEW.delivery_mode = 'express' AND public.feature_blocked('express') THEN
    RAISE EXCEPTION 'feature_disabled:express' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.delivery_mode = 'tour' AND public.feature_blocked('tour') THEN
    RAISE EXCEPTION 'feature_disabled:tour' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feature_delivery_mode ON public.orders;
CREATE TRIGGER trg_feature_delivery_mode
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_delivery_mode();

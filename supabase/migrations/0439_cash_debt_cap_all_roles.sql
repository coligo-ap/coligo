-- =============================================================================
-- 0439 — Plafond de dette ESPÈCES : le trigger mord sur TOUS les chemins.
--
-- Trou constaté : enforce_merchant_cash_debt_cap (mig 0269) s'exemptait pour
-- tout rôle hors authenticated/anon — écrit à l'époque où le client insérait
-- ses commandes en DIRECT (PostgREST + RLS). Depuis le durcissement, TOUTES
-- les commandes passent par le serveur (service_role via createOrder) : le
-- trigger ne se déclenchait plus JAMAIS sur le chemin réel, et seul le
-- pré-check applicatif du checkout protégeait (pas bypass-proof — panier
-- partagé, commandes programmées, futurs chemins).
--
-- Fix : plus d'exemption par rôle à la CRÉATION. Les exemptions MÉTIER
-- restent : commandes en ligne (elles réduisent la dette) et express COD
-- (le livreur est custodian des espèces, pas le commerçant). Un cap à 0
-- désactive la politique (merchant_cash_blocked renvoie false).
-- Vérifié : aucun chemin admin ne CRÉE de commande cash (les compensations
-- passent par wallet_entries) — pas d'asymétrie à préserver à l'INSERT.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_merchant_cash_debt_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.payment_method IS DISTINCT FROM 'cash' THEN RETURN NEW; END IF;
  IF NEW.fulfillment_type = 'delivery' AND NEW.delivery_mode = 'express' THEN
    RETURN NEW;
  END IF;
  IF public.merchant_cash_blocked(NEW.merchant_id) THEN
    RAISE EXCEPTION 'merchant_cash_debt_cap' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

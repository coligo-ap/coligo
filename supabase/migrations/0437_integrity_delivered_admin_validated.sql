-- =============================================================================
-- 0437 — Invariant `delivered_without_driver` : tolérer la clôture ADMIN.
--
-- Cas vécu (commande C832, 01/08) : l'équipe a débloqué une livraison via
-- l'action admin « validate_delivery » (chemin légitime, journalisé dans
-- admin_audit_log) — la commande est livrée SANS delivery_driver_id et
-- l'invariant levait un faux positif permanent (warning) qui polluait le
-- monitoring et faisait échouer test:noshow:money (D1).
--
-- Le contrôle exclut désormais les commandes dont la livraison a été validée
-- par un admin (trace d'audit exigée — une livraison sans livreur ET sans
-- trace reste une violation). Patch minimal : seule la branche
-- delivered_without_driver change, le reste de la fonction est repris du
-- LIVE (pg_get_functiondef, 06/08/2026) via un remplacement ciblé.
-- =============================================================================

DO $$
DECLARE
  v_def text;
  v_old text := $old$
  SELECT 'delivered_without_driver', 'warning', count(*)::int,
         'commande delivery livrée sans delivery_driver_id'
    FROM public.orders
   WHERE fulfillment_type='delivery' AND delivery_delivered_at IS NOT NULL
     AND delivery_driver_id IS NULL
  HAVING count(*) > 0
$old$;
  v_new text := $new$
  SELECT 'delivered_without_driver', 'warning', count(*)::int,
         'commande delivery livrée sans delivery_driver_id (hors validation admin)'
    FROM public.orders o
   WHERE o.fulfillment_type='delivery' AND o.delivery_delivered_at IS NOT NULL
     AND o.delivery_driver_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.admin_audit_log l
        WHERE l.target_id = o.id AND l.action = 'validate_delivery'
     )
  HAVING count(*) > 0
$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'integrity_violations';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'integrity_violations() introuvable';
  END IF;
  IF position(btrim(v_old) IN v_def) = 0 THEN
    RAISE EXCEPTION 'branche delivered_without_driver introuvable — définition live différente, reprendre le patch';
  END IF;

  v_def := replace(v_def, btrim(v_old), btrim(v_new));
  EXECUTE v_def;
END $$;

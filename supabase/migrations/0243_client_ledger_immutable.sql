-- =============================================================================
-- 0243 — Immutabilité DB des grands livres CLIENT + journal d'audit
-- =============================================================================
-- FAILLE (audit 2026-06-22, finding A-F11, MAJEUR) :
--   Le grand livre OPÉRATEUR est inviolable (trigger `trg_operator_entries_immutable`,
--   0185 : tout UPDATE/DELETE rejeté, même service_role). Mais les grands livres
--   CLIENT — `customer_wallet_entries` (cashback + Coligo Pay), `wallet_entries`
--   (commerçant), `platform_ledger` (plateforme) — et le journal d'audit
--   `order_events` ne reposaient QUE sur le RLS deny-all. Or le webhook et toutes
--   les RPC écrivent en service_role / SECURITY DEFINER, qui BYPASSENT le RLS :
--   un bug futur ou un accès service_role pouvait UPDATE/DELETE une écriture
--   d'argent client réel sans aucun garde-fou DB → asymétrie de garantie.
--
-- CORRECTIF : append-only au niveau DB. Tout UPDATE/DELETE est REJETÉ par défaut
--   — y compris service_role et SECURITY DEFINER (un bug/regression ne peut plus
--   altérer une écriture d'argent). Une correction = une NOUVELLE écriture de
--   compensation (INSERT), comme pour le grand livre opérateur.
--
--   Échappatoire EXPLICITE de maintenance : une opération DÉLIBÉRÉE (correction
--   admin exceptionnelle, scripts de test) doit poser `SET LOCAL
--   app.ledger_maintenance = 'on'` AVANT l'UPDATE/DELETE. Aucun chemin applicatif
--   (app/ + lib/ + RPC + webhook + triggers) ne pose ce drapeau → la protection
--   contre les mutations ACCIDENTELLES/buguées (la vraie menace A-F11) est totale.
-- Vérifié : AUCUN code app/lib ne fait UPDATE/DELETE sur ces tables (les
--   annulations posent des écritures inverses par INSERT) ; aucune FK
--   orders→ces tables n'est ON DELETE CASCADE → pas de conflit.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_ledger_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Échappatoire de maintenance délibérée uniquement (jamais posée par l'app).
  IF current_setting('app.ledger_maintenance', true) IS NOT DISTINCT FROM 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION
    '% est append-only : % interdit. Corrigez par une écriture de compensation (INSERT).',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

-- customer_wallet_entries (cashback + topup Coligo Pay)
DROP TRIGGER IF EXISTS cwe_no_update ON public.customer_wallet_entries;
DROP TRIGGER IF EXISTS cwe_no_delete ON public.customer_wallet_entries;
CREATE TRIGGER cwe_no_update BEFORE UPDATE ON public.customer_wallet_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();
CREATE TRIGGER cwe_no_delete BEFORE DELETE ON public.customer_wallet_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();

-- wallet_entries (grand livre commerçant)
DROP TRIGGER IF EXISTS we_no_update ON public.wallet_entries;
DROP TRIGGER IF EXISTS we_no_delete ON public.wallet_entries;
CREATE TRIGGER we_no_update BEFORE UPDATE ON public.wallet_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();
CREATE TRIGGER we_no_delete BEFORE DELETE ON public.wallet_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();

-- platform_ledger (grand livre plateforme)
DROP TRIGGER IF EXISTS pl_no_update ON public.platform_ledger;
DROP TRIGGER IF EXISTS pl_no_delete ON public.platform_ledger;
CREATE TRIGGER pl_no_update BEFORE UPDATE ON public.platform_ledger
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();
CREATE TRIGGER pl_no_delete BEFORE DELETE ON public.platform_ledger
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();

-- order_events (journal d'audit append-only)
DROP TRIGGER IF EXISTS oe_no_update ON public.order_events;
DROP TRIGGER IF EXISTS oe_no_delete ON public.order_events;
CREATE TRIGGER oe_no_update BEFORE UPDATE ON public.order_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();
CREATE TRIGGER oe_no_delete BEFORE DELETE ON public.order_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_append_only();

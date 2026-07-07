-- =============================================================================
-- 0339 — FIX reclassement des catégories (drag & drop admin).
-- =============================================================================
-- Bug : `reorderCategories` écrivait les positions via un UPSERT PostgREST ne
-- portant que {code, position, updated_at}. Or PostgreSQL vérifie les
-- contraintes NOT NULL sur la ligne PROPOSÉE **avant** l'arbitrage ON CONFLICT
-- → « null value in column "label" violates not-null constraint » même quand
-- toutes les lignes existent (la branche INSERT n'est jamais prise, mais le
-- tuple candidat est quand même contrôlé). Aucune écriture partielle : l'ordre
-- ne s'appliquait simplement jamais.
--
-- Correctif : RPC atomique qui ne fait QUE des UPDATE (aucun tuple candidat à
-- l'INSERT), avec le même contrat que l'action :
--   • l'ensemble reçu doit être EXACTEMENT celui en base (ni doublon, ni code
--     manquant/inconnu) → sinon 'stale' (liste périmée, rien n'est écrit) ;
--   • verrouillage FOR UPDATE de toutes les lignes : une création/suppression
--     concurrente attend le commit → jamais d'ordre écrit sur un set périmé ;
--   • positions réécrites en (rang × 10), comme le seed 0311.
-- service_role uniquement (appelée via le client admin après adminCan, pattern
-- admin_delete_category 0319).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_reorder_categories(p_codes text[])
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_len      int := COALESCE(array_length(p_codes, 1), 0);
  v_distinct bigint;
  v_total    bigint;
  v_matched  bigint;
BEGIN
  SELECT count(DISTINCT c) INTO v_distinct FROM unnest(p_codes) c;
  IF v_len = 0 OR v_distinct <> v_len THEN
    RETURN 'stale';
  END IF;

  -- Verrouille TOUTES les lignes (sérialise avec création/suppression).
  PERFORM 1 FROM public.merchant_categories FOR UPDATE;

  SELECT count(*) INTO v_total FROM public.merchant_categories;
  SELECT count(*) INTO v_matched
    FROM public.merchant_categories mc
    JOIN unnest(p_codes) c ON c = mc.code;
  IF v_matched <> v_total OR v_matched <> v_len THEN
    RETURN 'stale';
  END IF;

  UPDATE public.merchant_categories mc
     SET position   = u.ord::int * 10,
         updated_at = now()
    FROM unnest(p_codes) WITH ORDINALITY AS u(code, ord)
   WHERE mc.code = u.code;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reorder_categories(text[])
  FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_reorder_categories(text[]) TO service_role;

COMMENT ON FUNCTION public.admin_reorder_categories(text[]) IS
  'Reclassement atomique des catégories (mig 0339) — UPDATE only, set exact exigé, service_role seul.';

-- Le refus « portefeuille suspendu » ne prononce plus le mot « recharger ».
--
-- La migration 0355 a déjà séparé les deux causes de refus de
-- `trg_gate_driver_assign` (statut du portefeuille vs solde). Mais son message de
-- suspension disait encore « Recharger ne débloquera pas les livraisons en
-- espèces » : la négation est correcte, le mot reste. Un livreur qui lit vite y
-- voit « recharger », et va recharger.
--
-- Le message ne parle donc plus que de l'action utile : contacter l'équipe.
-- Le second message, lui, garde son « rechargez » — là, c'est la bonne action.

create or replace function public.trg_gate_driver_assign()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE
  v_status text;
BEGIN
  IF NEW.delivery_driver_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.delivery_driver_id IS DISTINCT FROM OLD.delivery_driver_id)
     AND NEW.payment_method IS DISTINCT FROM 'online'          -- online = prépayé → autorisé
     AND NOT public.operator_can_operate_owner('driver', NEW.delivery_driver_id) THEN

    SELECT w.status INTO v_status
      FROM public.operator_wallets w
     WHERE w.owner_type = 'driver' AND w.owner_id = NEW.delivery_driver_id;

    -- Le statut est la première porte que franchit `operator_can_operate` : la
    -- nommer évite d'envoyer le livreur agir sur son solde, qui n'y est pour rien.
    IF v_status IS NOT NULL AND v_status <> 'active' THEN
      RAISE EXCEPTION
        'Portefeuille % — contactez l''équipe Coligo.',
        CASE v_status
          WHEN 'suspended' THEN 'suspendu'
          WHEN 'disabled'  THEN 'désactivé'
          WHEN 'pending'   THEN 'en attente de validation'
          WHEN 'rejected'  THEN 'refusé'
          ELSE v_status
        END
        USING ERRCODE = 'check_violation';
    END IF;

    -- Ici, et seulement ici, recharger est la bonne action.
    RAISE EXCEPTION 'Solde insuffisant : rechargez votre portefeuille pour accepter des livraisons en espèces.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

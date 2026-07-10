-- Le garde d'attribution dit POURQUOI il refuse.
--
-- `trg_gate_driver_assign` refusait toute livraison en espèces avec un seul
-- message : « Solde insuffisant : rechargez votre portefeuille ». Or
-- `operator_can_operate` sort sur DEUX conditions, et le statut passe en premier :
--
--   1. `status <> 'active'`  → refus, AVANT même de regarder le solde ;
--   2. gating actif ET solde effectif < −seuil négatif.
--
-- Un livreur au portefeuille `suspended` mais au solde parfaitement sain se
-- voyait donc envoyer recharger — ce qui n'aurait rien débloqué. Constaté sur le
-- compte « Yaxine livreur » : 100 DA de solde, seuil à −500, et pourtant bloqué.
-- Le message a coûté un diagnostic entier.
--
-- Aucun code applicatif ne dépend du texte de cette exception (vérifié) ; le
-- code d'erreur `check_violation` est conservé.

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

    -- Le statut est la première porte : la nommer évite d'envoyer le livreur
    -- recharger un portefeuille dont le solde n'est pas en cause.
    IF v_status IS NOT NULL AND v_status <> 'active' THEN
      RAISE EXCEPTION
        'Votre portefeuille est % : contactez l''équipe Coligo. Recharger ne débloquera pas les livraisons en espèces.',
        CASE v_status
          WHEN 'suspended' THEN 'suspendu'
          WHEN 'disabled'  THEN 'désactivé'
          WHEN 'pending'   THEN 'en attente de validation'
          WHEN 'rejected'  THEN 'refusé'
          ELSE v_status
        END
        USING ERRCODE = 'check_violation';
    END IF;

    RAISE EXCEPTION 'Solde insuffisant : rechargez votre portefeuille pour accepter des livraisons en espèces.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

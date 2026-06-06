-- =============================================================================
-- Coligo v3 - Migration 0085 : valeurs d'enum pour le transfert P2P Coligo Pay
-- =============================================================================
-- Postgres interdit d'utiliser une valeur d'enum dans la même transaction que
-- celle qui l'ajoute → on isole l'ALTER TYPE ici ; la table + les fonctions qui
-- consomment ces valeurs sont en 0086 (même découpage que 0018/0019).
--
-- Transfert P2P = mouvement EN BOUCLE FERMÉE entre deux soldes Coligo Pay
-- (topup). Aucun retrait espèces/carte : l'argent ne quitte jamais Coligo.
--   transfer_out : −montant chez l'expéditeur
--   transfer_in  : +montant chez le bénéficiaire (qui possède forcément Coligo Pay)
-- =============================================================================

ALTER TYPE public.customer_wallet_entry_type ADD VALUE IF NOT EXISTS 'transfer_out';
ALTER TYPE public.customer_wallet_entry_type ADD VALUE IF NOT EXISTS 'transfer_in';

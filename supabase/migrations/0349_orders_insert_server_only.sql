-- =============================================================================
-- 0349 — Création de commande RÉSERVÉE au serveur de confiance (anti-fraude prix)
-- =============================================================================
-- CONTEXTE : jusqu'ici la commande était insérée par le client sous le rôle
-- `authenticated` (policy `orders_insert_own_customer`). La Server Action
-- recalcule TOUS les montants (prix produits, promos, code promo, livraison,
-- frais de service) — MAIS un client malveillant pouvait contourner l'action et
-- appeler PostgREST directement pour INSÉRER une commande avec des montants
-- FORGÉS (service_fee = 0, total_da bas…). Le trigger BEFORE INSERT
-- `enforce_order_insert_integrity` ne verrouillait pas les colonnes monétaires,
-- et `protect_order_financial_fields` ne couvre que les UPDATE.
--
-- CORRECTIF : la Server Action écrit désormais la commande et ses lignes via le
-- rôle `service_role` (bypass RLS). On RETIRE donc les policies INSERT réservées
-- au client sur les 4 tables du domaine commande. Conséquence : un INSERT
-- PostgREST direct par un client (rôle authenticated) est REJETÉ par RLS — le
-- SEUL chemin de création devient la Server Action, qui recalcule tout depuis la
-- DB. Les montants deviennent donc autoritaires et infalsifiables.
--
-- Les gardes métier qui tournent aussi pour service_role restent actives
-- (capacité créneau, dette commerçant `trg_gate_merchant_order`, feature
-- online_payment, dépense cashback/topup avec vérif de solde, génération du
-- pickup_code). Les gardes réservées à authenticated que service_role ne
-- déclenche pas (zone de service, kill-switch livraison express/tour) sont
-- revalidées EN AMONT dans la Server Action (TS) avant l'écriture.
--
-- Les policies SELECT (client/commerçant/livreur/admin) sont INCHANGÉES : la
-- lecture reste gouvernée par RLS comme avant.
-- =============================================================================

DROP POLICY IF EXISTS orders_insert_own_customer ON public.orders;
DROP POLICY IF EXISTS order_items_insert_own_customer ON public.order_items;
DROP POLICY IF EXISTS oio_insert_customer ON public.order_item_options;
DROP POLICY IF EXISTS oprom_insert_customer ON public.order_promotions;

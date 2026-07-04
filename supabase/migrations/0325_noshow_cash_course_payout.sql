-- =============================================================================
-- 0325 — ANNULÉE (décision produit du propriétaire, 04/07/2026)
-- =============================================================================
-- Cette migration payait automatiquement la course du livreur sur un no-show
-- d'une commande EN ESPÈCES. FAUX : le livreur n'est PAS payé pour la course
-- au no-show espèces — il est uniquement remboursé de l'AVANCE remise au
-- commerçant au retrait (P − commission), après validation du support
-- plateforme (super-admin) via driver_refund_claims (mig 0160).
--
-- Le SQL d'origine a couru quelques minutes en prod le 04/07/2026 puis a été
-- remplacé par la mig 0326 AVANT toute écriture (vérifié : 0 ligne
-- delivery_ledger concernée). Contenu retiré à la demande du propriétaire ;
-- fichier conservé en no-op car la version est déjà enregistrée comme
-- appliquée côté Supabase (la supprimer casserait `db push`).
-- La règle en vigueur est ENTIÈREMENT définie par 0326.
-- =============================================================================

SELECT 1; -- no-op

-- 0357 — Banque d'images : nouveau kind 'category'.
--
-- La banque (mig 0348) ne connaissait que 'cover' et 'logo' (visuels de
-- vitrine commerçant). On y range désormais aussi des visuels de CATÉGORIES
-- de produits (tuiles photo façon Bolt Market), réutilisables par n'importe
-- quel commerce : `kind='category'`, `category` (code merchant_categories)
-- laissé NULL = visuel générique.
--
-- (Déjà appliquée en prod le 11/07/2026 via le pipeline d'import des visuels ;
-- ce fichier garde l'historique de schéma en phase.)

alter table public.merchant_image_bank
  drop constraint if exists merchant_image_bank_kind_check;

alter table public.merchant_image_bank
  add constraint merchant_image_bank_kind_check
  check (kind in ('cover', 'logo', 'category'));

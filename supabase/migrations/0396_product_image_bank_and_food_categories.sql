-- =============================================================================
-- 0396 — Banque d'images PRODUITS + ouverture des segments Fast-food / Restaurant
-- =============================================================================
-- 1. `merchant_image_bank` accueille désormais des visuels de PRODUIT
--    (kind='product') en plus des couvertures/logos/rayons, avec la traçabilité
--    de licence exigée par la règle « licences commerciales explicites » :
--    auteur, licence et URL de la page source de chaque visuel.
--    Les visuels ajoutés par cette vague viennent de Wikimedia Commons
--    (CC0 / domaine public / CC BY / CC BY-SA — tous utilisables
--    commercialement) ; les packshots supérette proviennent du catalogue déjà
--    présent en base.
--
-- 2. Les catégories `fast_food` et `restaurant` passent en `active` : elles
--    étaient masquées, ce qui EXCLUAIT de `merchants_public` tout commerçant
--    dont c'est la catégorie principale (mig 0314).
--
-- Sécurité inchangée : RLS activée SANS policy sur merchant_image_bank →
-- service_role uniquement.

-- 1. Traçabilité des visuels ---------------------------------------------------
alter table public.merchant_image_bank
  add column if not exists credit_author text,
  add column if not exists credit_license text,
  add column if not exists source_url text;

comment on column public.merchant_image_bank.credit_author is
  'Auteur/crédit à afficher si la licence l''exige (CC BY / CC BY-SA).';
comment on column public.merchant_image_bank.credit_license is
  'Licence vérifiée à l''import (CC0, domaine public, CC BY 4.0…). Aucune image sous licence non commerciale.';
comment on column public.merchant_image_bank.source_url is
  'Page source du visuel (permet de re-vérifier la licence à tout moment).';

alter table public.merchant_image_bank
  drop constraint if exists merchant_image_bank_kind_check;
alter table public.merchant_image_bank
  add constraint merchant_image_bank_kind_check
  check (kind = any (array['cover', 'logo', 'category', 'product']));

-- Un visuel produit se retrouve par sa famille de commerce (`category`) et son
-- libellé — index utile dès que la banque dépassera quelques centaines de lignes.
create index if not exists merchant_image_bank_kind_cat_idx
  on public.merchant_image_bank (kind, category)
  where active;

-- 2. Ouverture des segments Fast-food et Restaurant ---------------------------
update public.merchant_categories
set status = 'active',
    image_url = coalesce(image_url, '/categories/photos/fast_food.jpg'),
    updated_at = now()
where code = 'fast_food';

update public.merchant_categories
set status = 'active',
    image_url = coalesce(image_url, '/categories/photos/restaurant.jpg'),
    updated_at = now()
where code = 'restaurant';

-- =============================================================================
-- FAMILLES DE CATÉGORIES — une tuile de l'accueil ouvre un UNIVERS filtré
--
-- Les tuiles du hub (/services) ne pointaient qu'une catégorie unique :
-- « Fast-food & Restaurants » ne montrait que les fast-foods (ni restaurants,
-- ni pizzerias), et « Supérette & Alimentation » que les supérettes. Elles
-- ouvrent désormais une FAMILLE, qui agrège ses membres ET propose une rangée
-- de pilules pour se re-filtrer : Burgers · Pizza · Tacos · Sandwichs ·
-- Poulet · Bowls… côté restauration, Supérette · Fruits & Légumes ·
-- Boulangerie · Boucherie… côté alimentation.
--
-- Mécanique : `merchant_categories.parent_code` (auto-référence). La lecture
-- (categoryMerchantIds) agrège parent + enfants ; la rangée de pilules se
-- déduit de la même colonne. Familles et filtres de plat ne sont JAMAIS
-- proposés à l'inscription ni affichés dans le strip
-- (show_signup / show_marketplace = false) : ce sont des portes d'entrée.
-- =============================================================================

alter table public.merchant_categories
  add column if not exists parent_code text
    references public.merchant_categories(code) on delete set null;

comment on column public.merchant_categories.parent_code is
  'Catégorie parente (famille). Une famille agrège ses enfants dans le filtre marketplace et alimente la rangée de pilules.';

create index if not exists idx_merchant_categories_parent
  on public.merchant_categories (parent_code)
  where parent_code is not null;

-- 1. Les deux FAMILLES — cibles des tuiles de l'accueil, invisibles ailleurs.
insert into public.merchant_categories
  (code, label, label_ar, emoji, kind, status, position,
   show_marketplace, show_signup)
values
  ('fam_restauration', 'Fast-food & Restaurants', 'فاست فود و مطاعم',
   '🍔', 'filter', 'active', 900, false, false),
  ('fam_alimentation', 'Supérette & Alimentation', 'سوبيرات و مواد غذائية',
   '🛒', 'filter', 'active', 910, false, false)
on conflict (code) do update
  set label            = excluded.label,
      label_ar         = excluded.label_ar,
      emoji            = excluded.emoji,
      show_marketplace = false,
      show_signup      = false;

-- 2. Filtres PAR TYPE DE PLAT (rangée de pilules de la famille restauration).
--    `keywords` alimente le rattachement automatique ci-dessous — même
--    mécanique que les filtres éditoriaux (mig 0313).
insert into public.merchant_categories
  (code, label, label_ar, emoji, kind, status, position,
   show_marketplace, show_signup, parent_code, keywords)
values
  ('burgers', 'Burgers', 'برغر', '🍔', 'filter', 'active', 31,
   false, false, 'fam_restauration',
   array['burger', 'cheeseburger', 'hamburger', 'برغر', 'برجر']),
  ('tacos', 'Tacos', 'طاكوس', '🌯', 'filter', 'active', 32,
   false, false, 'fam_restauration',
   array['tacos', 'taco', 'طاكوس']),
  ('sandwichs', 'Sandwichs', 'ساندويتش', '🥪', 'filter', 'active', 33,
   false, false, 'fam_restauration',
   array['sandwich', 'panini', 'chawarma', 'chawerma', 'shawarma',
         'hot-dog', 'hot dog', 'ساندويتش', 'شاورما']),
  ('poulet', 'Poulet', 'دجاج', '🍗', 'filter', 'active', 34,
   false, false, 'fam_restauration',
   array['poulet', 'chicken', 'nuggets', 'tenders', 'escalope', 'دجاج']),
  ('bowls', 'Bowls', 'بولز', '🥗', 'filter', 'active', 35,
   false, false, 'fam_restauration',
   array['bowl', 'salade', 'poke', 'césar', 'cesar', 'سلطة'])
on conflict (code) do update
  set parent_code      = excluded.parent_code,
      keywords         = excluded.keywords,
      show_marketplace = false,
      show_signup      = false;

-- 3. Rattachement des TYPES existants à leur famille. Ils gardent leur statut
--    et leur place dans le strip : `parent_code` n'est lu que par le filtre.
update public.merchant_categories
   set parent_code = 'fam_restauration'
 where code in ('fast_food', 'restaurant', 'pizzeria', 'cafe', 'glacier');

update public.merchant_categories
   set parent_code = 'fam_alimentation'
 where code in ('superette', 'fruits_legumes', 'boulangerie', 'boucherie',
                'poissonnerie', 'produits_bio');

-- 4. Rattachement AUTOMATIQUE des commerçants aux filtres de plat, par les
--    noms de produits (FR + AR). `source='auto'` : l'admin peut détacher ou
--    recalculer sans perdre les liaisons manuelles (mig 0313).
insert into public.merchant_category_links (merchant_id, code, source)
select distinct p.merchant_id, f.code, 'auto'
  from public.products p
  join public.merchants m
    on m.id = p.merchant_id
  join public.merchant_categories f
    on f.parent_code = 'fam_restauration'
   and f.keywords is not null
   and cardinality(f.keywords) > 0
 where p.archived_at is null
   and m.category in (
     select code from public.merchant_categories
      where parent_code = 'fam_restauration'
   )
   and exists (
     select 1
       from unnest(f.keywords) k
      where p.name_fr ilike '%' || k || '%'
         or coalesce(p.name_ar, '') ilike '%' || k || '%'
   )
on conflict (merchant_id, code) do nothing;

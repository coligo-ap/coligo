-- =============================================================================
-- 0348 — Banque d'images commerçants (visuels HD par catégorie)
-- =============================================================================
-- Bibliothèque de photos professionnelles (Unsplash, 2400 px, libres de droits
-- pour usage commercial) sélectionnées PAR CATÉGORIE de commerce. Le super-admin
-- les relie à un commerçant comme photo de COUVERTURE (ou logo) depuis
-- Commerçants > Visuels — manuellement, ou automatiquement selon la catégorie.
-- Chaque URL a été vérifiée (HTTP 200) à la génération de cette migration.
--
-- Sécurité : RLS activée SANS policy → aucune lecture/écriture anon ou
-- authenticated ; tout passe par service_role côté admin (self-guard app).

create table if not exists public.merchant_image_bank (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'cover' check (kind in ('cover', 'logo')),
  -- Code de merchant_categories (null = visuel générique toutes catégories).
  category text,
  label text not null,
  url text not null,
  position integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, url)
);

comment on table public.merchant_image_bank is
  'Banque de visuels HD par catégorie, reliables aux commerçants (couverture/logo) par le super-admin (Commerçants > Visuels).';

alter table public.merchant_image_bank enable row level security;

create index if not exists merchant_image_bank_cat_idx
  on public.merchant_image_bank (category)
  where active;

insert into public.merchant_image_bank (kind, category, label, url, position) values
  ('cover', 'superette', 'Rayons de supérette', 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=2400&q=85&auto=format', 10),
  ('cover', 'superette', 'Allée de supermarché', 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=2400&q=85&auto=format', 20),
  ('cover', 'superette', 'Épicerie fine', 'https://images.unsplash.com/photo-1583258292688-d0213dc5a3a8?w=2400&q=85&auto=format', 30),
  ('cover', 'superette', 'Chariot de courses', 'https://images.unsplash.com/photo-1580913428023-02c695666d61?w=2400&q=85&auto=format', 40),
  ('cover', 'boulangerie', 'Pains artisanaux', 'https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=2400&q=85&auto=format', 50),
  ('cover', 'boulangerie', 'Fournée de pains', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=2400&q=85&auto=format', 60),
  ('cover', 'boulangerie', 'Miches dorées', 'https://images.unsplash.com/photo-1517433670267-08bbd4be890f?w=2400&q=85&auto=format', 70),
  ('cover', 'boulangerie', 'Croissants frais', 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=2400&q=85&auto=format', 80),
  ('cover', 'pizzeria', 'Pizza au feu de bois', 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=2400&q=85&auto=format', 90),
  ('cover', 'pizzeria', 'Four à pizza', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=2400&q=85&auto=format', 100),
  ('cover', 'pizzeria', 'Pizza margherita', 'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?w=2400&q=85&auto=format', 110),
  ('cover', 'boucherie', 'Étal de boucher', 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=2400&q=85&auto=format', 120),
  ('cover', 'boucherie', 'Pièces de viande', 'https://images.unsplash.com/photo-1603048297172-c92544798d5a?w=2400&q=85&auto=format', 130),
  ('cover', 'boucherie', 'Comptoir boucherie', 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=2400&q=85&auto=format', 140),
  ('cover', 'fruits_legumes', 'Étal de primeur', 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=2400&q=85&auto=format', 150),
  ('cover', 'fruits_legumes', 'Légumes du marché', 'https://images.unsplash.com/photo-1573246123716-6b1782bfc499?w=2400&q=85&auto=format', 160),
  ('cover', 'fruits_legumes', 'Agrumes frais', 'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=2400&q=85&auto=format', 170),
  ('cover', 'fruits_legumes', 'Marché coloré', 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=2400&q=85&auto=format', 180),
  ('cover', 'fast_food', 'Burger maison', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=2400&q=85&auto=format', 190),
  ('cover', 'fast_food', 'Burger & frites', 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=2400&q=85&auto=format', 200),
  ('cover', 'fast_food', 'Burger gourmand', 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=2400&q=85&auto=format', 210),
  ('cover', 'restaurant', 'Table dressée', 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=2400&q=85&auto=format', 220),
  ('cover', 'restaurant', 'Salle de restaurant', 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=2400&q=85&auto=format', 230),
  ('cover', 'restaurant', 'Restaurant chaleureux', 'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=2400&q=85&auto=format', 240),
  ('cover', 'cafe', 'Latte art', 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=2400&q=85&auto=format', 250),
  ('cover', 'cafe', 'Comptoir de café', 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=2400&q=85&auto=format', 260),
  ('cover', 'cafe', 'Salon de café', 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=2400&q=85&auto=format', 270),
  ('cover', 'glacier', 'Glaces artisanales', 'https://images.unsplash.com/photo-1501443762994-82bd5dace89a?w=2400&q=85&auto=format', 280),
  ('cover', 'glacier', 'Cornets de glace', 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=2400&q=85&auto=format', 290),
  ('cover', 'glacier', 'Coupe glacée', 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=2400&q=85&auto=format', 300),
  ('cover', 'poissonnerie', 'Étal de poissonnerie', 'https://images.unsplash.com/photo-1534177616072-ef7dc120449d?w=2400&q=85&auto=format', 310),
  ('cover', 'poissonnerie', 'Marché aux poissons', 'https://images.unsplash.com/photo-1498654200943-1088dd4438ae?w=2400&q=85&auto=format', 320),
  ('cover', 'poissonnerie', 'Poisson frais sur glace', 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=2400&q=85&auto=format', 330),
  ('cover', 'poissonnerie', 'Saumon frais', 'https://images.unsplash.com/photo-1544943910-4c1dc44aab44?w=2400&q=85&auto=format', 340),
  ('cover', 'produits_bio', 'Produits du terroir', 'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?w=2400&q=85&auto=format', 350),
  ('cover', 'fleuriste', 'Bouquets frais', 'https://images.unsplash.com/photo-1487070183336-b863922373d4?w=2400&q=85&auto=format', 360),
  ('cover', 'fleuriste', 'Boutique de fleurs', 'https://images.unsplash.com/photo-1563241527-3004b7be0ffd?w=2400&q=85&auto=format', 370),
  ('cover', 'fleuriste', 'Roses du fleuriste', 'https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=2400&q=85&auto=format', 380),
  ('cover', 'pharmacie', 'Officine', 'https://images.unsplash.com/photo-1583912086096-8c60d75a53f9?w=2400&q=85&auto=format', 390),
  ('cover', 'pharmacie', 'Rayon pharmacie', 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=2400&q=85&auto=format', 400),
  ('cover', 'pharmacie', 'Parapharmacie', 'https://images.unsplash.com/photo-1576602976047-174e57a47881?w=2400&q=85&auto=format', 410),
  ('cover', 'cosmetiques', 'Flacons cosmétiques', 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=2400&q=85&auto=format', 420),
  ('cover', 'cosmetiques', 'Maquillage', 'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=2400&q=85&auto=format', 430),
  ('cover', 'cosmetiques', 'Soins & beauté', 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=2400&q=85&auto=format', 440),
  ('cover', 'vetements', 'Boutique de mode', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=2400&q=85&auto=format', 450),
  ('cover', 'vetements', 'Portants de vêtements', 'https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?w=2400&q=85&auto=format', 460),
  ('cover', 'vetements', 'Collection mode', 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=2400&q=85&auto=format', 470),
  ('cover', 'chaussures', 'Sneakers en vitrine', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=2400&q=85&auto=format', 480),
  ('cover', 'chaussures', 'Chaussures de ville', 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=2400&q=85&auto=format', 490),
  ('cover', 'chaussures', 'Baskets tendance', 'https://images.unsplash.com/photo-1560343090-f0409e92791a?w=2400&q=85&auto=format', 500),
  ('cover', 'bijouterie', 'Bijoux précieux', 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=2400&q=85&auto=format', 510),
  ('cover', 'bijouterie', 'Vitrine de bijoux', 'https://images.unsplash.com/photo-1573408301185-9146fe634ad0?w=2400&q=85&auto=format', 520),
  ('cover', 'bijouterie', 'Bagues en or', 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=2400&q=85&auto=format', 530),
  ('cover', 'librairie', 'Rayonnages de livres', 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=2400&q=85&auto=format', 540),
  ('cover', 'librairie', 'Livres empilés', 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=2400&q=85&auto=format', 550),
  ('cover', 'librairie', 'Coin lecture', 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=2400&q=85&auto=format', 560),
  ('cover', 'jouets', 'Jouets colorés', 'https://images.unsplash.com/photo-1558877385-81a1c7e67d72?w=2400&q=85&auto=format', 570),
  ('cover', 'jouets', 'Peluches et jeux', 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=2400&q=85&auto=format', 580),
  ('cover', 'jouets', 'Blocs de construction', 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=2400&q=85&auto=format', 590),
  ('cover', 'electronique', 'Univers high-tech', 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=2400&q=85&auto=format', 600),
  ('cover', 'electronique', 'Accessoires électroniques', 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=2400&q=85&auto=format', 610),
  ('cover', 'electronique', 'Smartphones', 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=2400&q=85&auto=format', 620),
  ('cover', 'informatique', 'Setup informatique', 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=2400&q=85&auto=format', 630),
  ('cover', 'informatique', 'Poste de travail', 'https://images.unsplash.com/photo-1547082299-de196ea013d6?w=2400&q=85&auto=format', 640),
  ('cover', 'informatique', 'Ordinateur portable', 'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?w=2400&q=85&auto=format', 650),
  ('cover', 'electromenager', 'Cuisine équipée', 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=2400&q=85&auto=format', 660),
  ('cover', 'electromenager', 'Appareils de cuisine', 'https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?w=2400&q=85&auto=format', 670),
  ('cover', 'quincaillerie', 'Outils rangés', 'https://images.unsplash.com/photo-1530124566582-a618bc2615dc?w=2400&q=85&auto=format', 680),
  ('cover', 'quincaillerie', 'Atelier bricolage', 'https://images.unsplash.com/photo-1581147036324-c17ac41dfa6c?w=2400&q=85&auto=format', 690),
  ('cover', 'quincaillerie', 'Outillage à main', 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=2400&q=85&auto=format', 700),
  ('cover', 'decoration', 'Intérieur décoré', 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=2400&q=85&auto=format', 710),
  ('cover', 'decoration', 'Salon cosy', 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=2400&q=85&auto=format', 720),
  ('cover', 'decoration', 'Déco maison', 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=2400&q=85&auto=format', 730),
  ('cover', 'ameublement', 'Canapé design', 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=2400&q=85&auto=format', 740),
  ('cover', 'ameublement', 'Mobilier contemporain', 'https://images.unsplash.com/photo-1538688525198-9b88f6f53126?w=2400&q=85&auto=format', 750),
  ('cover', 'ameublement', 'Chambre aménagée', 'https://images.unsplash.com/photo-1567016432779-094069958ea5?w=2400&q=85&auto=format', 760),
  ('cover', 'sport', 'Esprit sportif', 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=2400&q=85&auto=format', 770),
  ('cover', 'sport', 'Piste d''athlétisme', 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=2400&q=85&auto=format', 780),
  ('cover', 'sport', 'Équipement fitness', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=2400&q=85&auto=format', 790),
  ('cover', 'autre', 'Devanture de boutique', 'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=2400&q=85&auto=format', 800),
  ('cover', 'autre', 'Boutique ouverte', 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=2400&q=85&auto=format', 810),
  ('cover', null, 'Rue commerçante', 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=2400&q=85&auto=format', 820),
  ('cover', null, 'Commerce de proximité', 'https://images.unsplash.com/photo-1534723452862-4c874018d66d?w=2400&q=85&auto=format', 830)
on conflict (kind, url) do nothing;

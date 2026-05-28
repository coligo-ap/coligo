-- =============================================================================
-- Coligo — Seed RICHE de démo (multi-merchants + clients + commandes)
-- =============================================================================
-- Exécuté via `npm run db:seed:demo` (script Node qui pousse via le pooler
-- en mode postgres = bypass RLS + accès à auth.users).
--
-- Stratégie :
--   - On crée des auth.users factices (email @demo.coligo.app) pour avoir le
--     user_id requis par merchants/customers.
--   - On marque toutes les lignes seed pour pouvoir les EFFACER puis recréer
--     proprement à chaque run (idempotent) :
--       merchants.slug commence par 'demo-'
--       orders.notes  = 'seed-demo'
--       customers.email finit par '@demo.coligo.app'
--       auth.users.email finit par '@demo.coligo.app'
--
-- /!\ NE PAS exécuter en production sur des données réelles.
-- =============================================================================

-- 1. NETTOYAGE des données seed précédentes (ordre = inverse des FK).
DELETE FROM public.orders WHERE notes = 'seed-demo';
DELETE FROM public.merchants WHERE slug LIKE 'demo-%';
DELETE FROM public.customers WHERE email LIKE '%@demo.coligo.app';
DELETE FROM auth.users WHERE email LIKE '%@demo.coligo.app';

-- 2. AUTH USERS factices — id reproductible (UUID v5-like via md5) pour
--    pouvoir ré-exécuter sans casser les références.
DO $$
DECLARE
  v_users TEXT[] := ARRAY[
    'sup-ali','sup-amine',
    'boul-yacine','boul-karim',
    'bouch-hocine','pizz-sofia','cafe-rachid','frui-nadir','pharma-leila',
    'client-mehdi','client-sara','client-yasmine','client-omar','client-rania','client-walid'
  ];
  v_email TEXT;
  v_id UUID;
BEGIN
  FOREACH v_email IN ARRAY v_users LOOP
    v_id := ('00000000-0000-4000-8000-' || lpad(abs(hashtext(v_email))::text, 12, '0'))::uuid;
    -- IMPORTANT : on initialise les colonnes "token" à '' (chaîne vide) et
    -- NON à NULL. GoTrue (auth) scanne ces colonnes en string Go ; un NULL
    -- provoque « Database error querying schema » (HTTP 500) au login. Les
    -- comptes créés via l'API GoTrue reçoivent '' automatiquement ; pour un
    -- INSERT direct comme ici, c'est à nous de le faire.
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      v_email || '@demo.coligo.app',
      crypt('coligo2026', gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers',ARRAY['email']),
      jsonb_build_object('demo', true, 'role', CASE WHEN v_email LIKE 'client-%' THEN 'customer' ELSE 'merchant' END),
      now(), now(),
      '', '', '', '', '', '', '', ''
    );
  END LOOP;
END $$;

-- 3. MERCHANTS — 9 commerces variés, tous en Algérie (Alger / Béjaïa / Oran / Constantine).
--    Photos : Unsplash libres de droits.
DO $$
DECLARE
  v_uid UUID;
  v_mid UUID;
BEGIN
  -- 3.1 Supérette El Amine (Alger Bab Ezzouar)
  v_uid := ('00000000-0000-4000-8000-' || lpad(abs(hashtext('sup-amine'))::text, 12, '0'))::uuid;
  INSERT INTO public.merchants (
    user_id, name, category, city, wilaya_code, commune, address,
    description_fr, slug, logo_url, cover_url, phone_public,
    latitude, longitude,
    opening_hours, min_order_da, prep_time_min,
    accepts_cash, accepts_online, pickup_slot_minutes,
    is_active
  ) VALUES (
    v_uid, 'Supérette El Amine', 'superette', 'Alger', '16', 'Bab Ezzouar',
    'Cité 5 Juillet, Bât. C n°12, Bab Ezzouar',
    'Alimentation générale, produits frais, dépôt de pain et livraisons rapides.',
    'demo-superette-el-amine',
    'https://images.unsplash.com/photo-1583922146273-cd9b80a5b6cb?w=400&auto=format',
    'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=1600&auto=format',
    '+213555700101', 36.7197, 3.1880,
    '{"mon":[{"open":"07:30","close":"22:00"}],"tue":[{"open":"07:30","close":"22:00"}],"wed":[{"open":"07:30","close":"22:00"}],"thu":[{"open":"07:30","close":"22:00"}],"fri":[{"open":"14:00","close":"22:00"}],"sat":[{"open":"07:30","close":"22:00"}],"sun":[{"open":"08:00","close":"21:00"}]}'::jsonb,
    300, 10, true, true, 15, true
  );

  -- 3.2 Supérette Tasdira (Béjaïa)
  v_uid := ('00000000-0000-4000-8000-' || lpad(abs(hashtext('sup-ali'))::text, 12, '0'))::uuid;
  INSERT INTO public.merchants (
    user_id, name, category, city, wilaya_code, commune, address,
    description_fr, slug, logo_url, cover_url, phone_public,
    latitude, longitude, opening_hours, min_order_da, prep_time_min,
    accepts_cash, accepts_online, pickup_slot_minutes, is_active
  ) VALUES (
    v_uid, 'Supérette Tasdira', 'superette', 'Béjaïa', '06', 'Béjaïa',
    'Boulevard de la liberté, en face du marché',
    'Tout pour la maison : épicerie, frais, produits d''entretien. Promos chaque semaine.',
    'demo-superette-tasdira',
    'https://images.unsplash.com/photo-1601598851547-4302969d0614?w=400&auto=format',
    'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1600&auto=format',
    '+213661700102', 36.7525, 5.0846,
    '{"mon":[{"open":"08:00","close":"20:00"}],"tue":[{"open":"08:00","close":"20:00"}],"wed":[{"open":"08:00","close":"20:00"}],"thu":[{"open":"08:00","close":"20:00"}],"fri":[{"open":"15:00","close":"22:00"}],"sat":[{"open":"08:00","close":"22:00"}],"sun":[]}'::jsonb,
    250, 15, true, false, 20, true
  );

  -- 3.3 Boulangerie Le Pain d'Or (Alger Centre)
  v_uid := ('00000000-0000-4000-8000-' || lpad(abs(hashtext('boul-yacine'))::text, 12, '0'))::uuid;
  INSERT INTO public.merchants (
    user_id, name, category, city, wilaya_code, commune, address,
    description_fr, slug, logo_url, cover_url, phone_public,
    latitude, longitude, opening_hours, min_order_da, prep_time_min,
    accepts_cash, accepts_online, pickup_slot_minutes, is_active
  ) VALUES (
    v_uid, 'Boulangerie Le Pain d''Or', 'boulangerie', 'Alger', '16', 'Alger Centre',
    'Rue Didouche Mourad, 15',
    'Pain traditionnel, viennoiseries, pâtisseries orientales et françaises. Sur place ou à emporter.',
    'demo-boulangerie-pain-dor',
    'https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=400&auto=format',
    'https://images.unsplash.com/photo-1517433367423-c7e5b0f35086?w=1600&auto=format',
    '+213770700103', 36.7700, 3.0589,
    '{"mon":[{"open":"05:30","close":"21:00"}],"tue":[{"open":"05:30","close":"21:00"}],"wed":[{"open":"05:30","close":"21:00"}],"thu":[{"open":"05:30","close":"21:00"}],"fri":[{"open":"05:30","close":"12:00"},{"open":"14:30","close":"21:00"}],"sat":[{"open":"05:30","close":"21:00"}],"sun":[{"open":"06:00","close":"13:00"}]}'::jsonb,
    100, 5, true, true, 10, true
  );

  -- 3.4 Boulangerie Pâtisserie Salima (Oran) — horaire de NUIT (ramadan-style)
  v_uid := ('00000000-0000-4000-8000-' || lpad(abs(hashtext('boul-karim'))::text, 12, '0'))::uuid;
  INSERT INTO public.merchants (
    user_id, name, category, city, wilaya_code, commune, address,
    description_fr, slug, logo_url, cover_url, phone_public,
    latitude, longitude, opening_hours, min_order_da, prep_time_min,
    accepts_cash, accepts_online, pickup_slot_minutes, is_active
  ) VALUES (
    v_uid, 'Pâtisserie Salima', 'boulangerie', 'Oran', '31', 'Es Sénia',
    'Cité des frères Bouadou, local n°4',
    'Spécialités orientales (qalbelouz, baklawa, makrout). Ouvert tard, parfait pour vos commandes du soir.',
    'demo-patisserie-salima',
    'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&auto=format',
    'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=1600&auto=format',
    '+213555700104', 35.6311, -0.6258,
    '{"mon":[{"open":"15:00","close":"02:00"}],"tue":[{"open":"15:00","close":"02:00"}],"wed":[{"open":"15:00","close":"02:00"}],"thu":[{"open":"15:00","close":"02:00"}],"fri":[{"open":"16:00","close":"02:00"}],"sat":[{"open":"15:00","close":"02:00"}],"sun":[{"open":"15:00","close":"23:00"}]}'::jsonb,
    200, 20, true, true, 15, true
  );

  -- 3.5 Boucherie Halal Cherchell (Tipaza)
  v_uid := ('00000000-0000-4000-8000-' || lpad(abs(hashtext('bouch-hocine'))::text, 12, '0'))::uuid;
  INSERT INTO public.merchants (
    user_id, name, category, city, wilaya_code, commune, address,
    description_fr, slug, logo_url, cover_url, phone_public,
    latitude, longitude, opening_hours, min_order_da, prep_time_min,
    accepts_cash, accepts_online, pickup_slot_minutes, is_active
  ) VALUES (
    v_uid, 'Boucherie Halal Cherchell', 'boucherie', 'Tipaza', '42', 'Cherchell',
    'Avenue de la République, 22',
    'Viandes fraîches du jour : agneau, bœuf, poulet fermier. Découpe sur demande.',
    'demo-boucherie-cherchell',
    'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=400&auto=format',
    'https://images.unsplash.com/photo-1567532900872-f4e906cbf06a?w=1600&auto=format',
    '+213770700105', 36.6080, 2.1948,
    '{"mon":[{"open":"06:00","close":"13:00"},{"open":"15:00","close":"19:30"}],"tue":[{"open":"06:00","close":"13:00"},{"open":"15:00","close":"19:30"}],"wed":[{"open":"06:00","close":"13:00"},{"open":"15:00","close":"19:30"}],"thu":[{"open":"06:00","close":"13:00"},{"open":"15:00","close":"19:30"}],"fri":[],"sat":[{"open":"06:00","close":"13:00"},{"open":"15:00","close":"19:30"}],"sun":[{"open":"06:00","close":"12:00"}]}'::jsonb,
    500, 20, true, false, 20, true
  );

  -- 3.6 Pizzeria Bella Italia (Constantine)
  v_uid := ('00000000-0000-4000-8000-' || lpad(abs(hashtext('pizz-sofia'))::text, 12, '0'))::uuid;
  INSERT INTO public.merchants (
    user_id, name, category, city, wilaya_code, commune, address,
    description_fr, slug, logo_url, cover_url, phone_public,
    latitude, longitude, opening_hours, min_order_da, prep_time_min,
    accepts_cash, accepts_online, pickup_slot_minutes, max_orders_per_slot, is_active
  ) VALUES (
    v_uid, 'Pizzeria Bella Italia', 'pizzeria', 'Constantine', '25', 'El Khroub',
    'Cité Massinissa, lot n°48',
    'Pizzas, calzones et tacos. Pâte maison, four à pierre. Le meilleur d''El Khroub.',
    'demo-pizzeria-bella-italia',
    'https://images.unsplash.com/photo-1571066811602-716837d681de?w=400&auto=format',
    'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1600&auto=format',
    '+213661700106', 36.2581, 6.6916,
    '{"mon":[{"open":"11:00","close":"23:30"}],"tue":[{"open":"11:00","close":"23:30"}],"wed":[{"open":"11:00","close":"23:30"}],"thu":[{"open":"11:00","close":"00:30"}],"fri":[{"open":"15:00","close":"01:00"}],"sat":[{"open":"11:00","close":"01:00"}],"sun":[{"open":"11:00","close":"23:00"}]}'::jsonb,
    400, 25, true, true, 20, 8, true
  );

  -- 3.7 Café Salon de thé Akhawat (Alger Hydra)
  v_uid := ('00000000-0000-4000-8000-' || lpad(abs(hashtext('cafe-rachid'))::text, 12, '0'))::uuid;
  INSERT INTO public.merchants (
    user_id, name, category, city, wilaya_code, commune, address,
    description_fr, slug, logo_url, cover_url, phone_public,
    latitude, longitude, opening_hours, min_order_da, prep_time_min,
    accepts_cash, accepts_online, pickup_slot_minutes, is_active
  ) VALUES (
    v_uid, 'Café Akhawat', 'cafe', 'Alger', '16', 'Hydra',
    'Chemin Doudou Mokhtar, 38',
    'Cafés de spécialité, pâtisseries du jour, jus naturels. Espace de travail au calme.',
    'demo-cafe-akhawat',
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&auto=format',
    'https://images.unsplash.com/photo-1559925393-8be0ec4767c8?w=1600&auto=format',
    '+213555700107', 36.7372, 3.0379,
    '{"mon":[{"open":"07:00","close":"22:00"}],"tue":[{"open":"07:00","close":"22:00"}],"wed":[{"open":"07:00","close":"22:00"}],"thu":[{"open":"07:00","close":"22:00"}],"fri":[{"open":"14:00","close":"22:00"}],"sat":[{"open":"08:00","close":"23:00"}],"sun":[{"open":"08:00","close":"22:00"}]}'::jsonb,
    150, 10, true, true, 15, true
  );

  -- 3.8 Primeur Au Verger (Alger Birkhadem)
  v_uid := ('00000000-0000-4000-8000-' || lpad(abs(hashtext('frui-nadir'))::text, 12, '0'))::uuid;
  INSERT INTO public.merchants (
    user_id, name, category, city, wilaya_code, commune, address,
    description_fr, slug, logo_url, cover_url, phone_public,
    latitude, longitude, opening_hours, min_order_da, prep_time_min,
    accepts_cash, accepts_online, pickup_slot_minutes, is_active
  ) VALUES (
    v_uid, 'Primeur Au Verger', 'fruits_legumes', 'Alger', '16', 'Birkhadem',
    'Place du marché, kiosque 7',
    'Fruits et légumes de saison directement du producteur. Arrivage chaque matin à 6h.',
    'demo-primeur-verger',
    'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=400&auto=format',
    'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=1600&auto=format',
    '+213770700108', 36.7050, 3.0578,
    '{"mon":[{"open":"06:00","close":"19:00"}],"tue":[{"open":"06:00","close":"19:00"}],"wed":[{"open":"06:00","close":"19:00"}],"thu":[{"open":"06:00","close":"19:00"}],"fri":[],"sat":[{"open":"06:00","close":"19:00"}],"sun":[{"open":"06:00","close":"14:00"}]}'::jsonb,
    200, 10, true, false, 15, true
  );

  -- 3.9 Pharmacie de la Place (Alger Kouba) — FERMÉ aujourd'hui pour test "Fermé"
  v_uid := ('00000000-0000-4000-8000-' || lpad(abs(hashtext('pharma-leila'))::text, 12, '0'))::uuid;
  INSERT INTO public.merchants (
    user_id, name, category, city, wilaya_code, commune, address,
    description_fr, slug, logo_url, cover_url, phone_public,
    latitude, longitude, opening_hours, min_order_da, prep_time_min,
    accepts_cash, accepts_online, pickup_slot_minutes, is_active
  ) VALUES (
    v_uid, 'Pharmacie de la Place', 'pharmacie', 'Alger', '16', 'Kouba',
    'Rue Tripoli, près du métro Kouba',
    'Conseil pharmaceutique, parapharmacie, livraisons rapides. Garde la nuit selon planning.',
    'demo-pharmacie-place',
    'https://images.unsplash.com/photo-1576602976047-174e57a47881?w=400&auto=format',
    'https://images.unsplash.com/photo-1583912086096-8c60d75a53f9?w=1600&auto=format',
    '+213661700109', 36.7283, 3.0917,
    '{"mon":[{"open":"08:30","close":"19:30"}],"tue":[{"open":"08:30","close":"19:30"}],"wed":[{"open":"08:30","close":"19:30"}],"thu":[{"open":"08:30","close":"19:30"}],"fri":[],"sat":[{"open":"08:30","close":"19:30"}],"sun":[]}'::jsonb,
    0, 5, true, true, 10, true
  );
END $$;

-- 4. CATEGORIES + PRODUITS pour chaque commerçant.
DO $$
DECLARE
  v_mid UUID;
  v_cat UUID;
BEGIN
  -- ---- Supérette El Amine ----
  SELECT id INTO v_mid FROM public.merchants WHERE slug='demo-superette-el-amine';

  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Boissons', 1) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, stock_qty, position) VALUES
    (v_mid, v_cat, 'Boissons', 'Eau minérale Ifri 1.5L', 60, 'piece', 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=600&auto=format', 50, 1),
    (v_mid, v_cat, 'Boissons', 'Selecto 1L', 150, 'piece', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format', 24, 2),
    (v_mid, v_cat, 'Boissons', 'Hamoud Boualem 1L', 130, 'piece', 'https://images.unsplash.com/photo-1567103472667-6898f3a79cf2?w=600&auto=format', 30, 3),
    (v_mid, v_cat, 'Boissons', 'Lait Candia 1L', 180, 'piece', 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=600&auto=format', 18, 4);

  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Épicerie', 2) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, stock_qty, position) VALUES
    (v_mid, v_cat, 'Épicerie', 'Pâtes Sim 500g', 95, 'piece', 'https://images.unsplash.com/photo-1551462147-37885acc36f1?w=600&auto=format', 40, 1),
    (v_mid, v_cat, 'Épicerie', 'Riz long 1kg', 250, 'piece', 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&auto=format', 25, 2),
    (v_mid, v_cat, 'Épicerie', 'Huile Fleurial 5L', 1450, 'piece', 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&auto=format', 12, 3),
    (v_mid, v_cat, 'Épicerie', 'Sucre 1kg', 130, 'piece', 'https://images.unsplash.com/photo-1610170010482-d6e26a0ae3a1?w=600&auto=format', 35, 4);

  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Frais', 3) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, stock_qty, position) VALUES
    (v_mid, v_cat, 'Frais', 'Yaourt Soummam x4', 90, 'piece', 'https://images.unsplash.com/photo-1488477304112-4944851de03d?w=600&auto=format', 20, 1),
    (v_mid, v_cat, 'Frais', 'Fromage Président 200g', 320, 'piece', 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=600&auto=format', 10, 2),
    (v_mid, v_cat, 'Frais', 'Œufs x12', 380, 'piece', 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=600&auto=format', 15, 3);

  -- ---- Boulangerie Le Pain d'Or ----
  SELECT id INTO v_mid FROM public.merchants WHERE slug='demo-boulangerie-pain-dor';

  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Pains', 1) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Pains', 'Baguette tradition', 15, 'piece', 'https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=600&auto=format', 1),
    (v_mid, v_cat, 'Pains', 'Pain de campagne', 80, 'piece', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&auto=format', 2),
    (v_mid, v_cat, 'Pains', 'Pain complet', 50, 'piece', 'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=600&auto=format', 3),
    (v_mid, v_cat, 'Pains', 'Pain au lait', 35, 'piece', 'https://images.unsplash.com/photo-1517686748843-bb360cfc62b5?w=600&auto=format', 4);

  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Viennoiseries', 2) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Viennoiseries', 'Croissant beurre', 50, 'piece', 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&auto=format', 1),
    (v_mid, v_cat, 'Viennoiseries', 'Pain au chocolat', 60, 'piece', 'https://images.unsplash.com/photo-1623334044303-241021148842?w=600&auto=format', 2),
    (v_mid, v_cat, 'Viennoiseries', 'Brioche pur beurre', 250, 'piece', 'https://images.unsplash.com/photo-1573931809164-d4d9f1b56a40?w=600&auto=format', 3);

  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Pâtisseries', 3) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Pâtisseries', 'Tarte aux pommes', 180, 'piece', 'https://images.unsplash.com/photo-1568571780765-9276ac8b75a2?w=600&auto=format', 1),
    (v_mid, v_cat, 'Pâtisseries', 'Éclair au chocolat', 130, 'piece', 'https://images.unsplash.com/photo-1623595119708-26b1f7500c20?w=600&auto=format', 2),
    (v_mid, v_cat, 'Pâtisseries', 'Mille-feuille', 200, 'piece', 'https://images.unsplash.com/photo-1559620192-032c4bc4674e?w=600&auto=format', 3);

  -- ---- Pâtisserie Salima ----
  SELECT id INTO v_mid FROM public.merchants WHERE slug='demo-patisserie-salima';
  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Orientales', 1) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Orientales', 'Qalbelouz 1kg', 1200, 'kg', 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=600&auto=format', 1),
    (v_mid, v_cat, 'Orientales', 'Baklawa amandes 1kg', 1800, 'kg', 'https://images.unsplash.com/photo-1604908554027-2bb78d3a4b95?w=600&auto=format', 2),
    (v_mid, v_cat, 'Orientales', 'Makrout au miel 1kg', 1400, 'kg', 'https://images.unsplash.com/photo-1568051243858-533a607809a5?w=600&auto=format', 3),
    (v_mid, v_cat, 'Orientales', 'Cornes de gazelle (12 pcs)', 900, 'piece', 'https://images.unsplash.com/photo-1612203985729-70726954388c?w=600&auto=format', 4);

  -- ---- Boucherie Cherchell ----
  SELECT id INTO v_mid FROM public.merchants WHERE slug='demo-boucherie-cherchell';
  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Viandes', 1) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Viandes', 'Agneau côtelettes 1kg', 2400, 'kg', 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600&auto=format', 1),
    (v_mid, v_cat, 'Viandes', 'Bœuf bourguignon 1kg', 2100, 'kg', 'https://images.unsplash.com/photo-1588168333986-5078d3ae3976?w=600&auto=format', 2),
    (v_mid, v_cat, 'Viandes', 'Poulet fermier entier', 950, 'piece', 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=600&auto=format', 3),
    (v_mid, v_cat, 'Viandes', 'Merguez 1kg', 1500, 'kg', 'https://images.unsplash.com/photo-1610440042657-612c34d95e9f?w=600&auto=format', 4);

  -- ---- Pizzeria Bella Italia ----
  SELECT id INTO v_mid FROM public.merchants WHERE slug='demo-pizzeria-bella-italia';
  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Pizzas', 1) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Pizzas', 'Margherita', 650, 'piece', 'https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?w=600&auto=format', 1),
    (v_mid, v_cat, 'Pizzas', '4 fromages', 850, 'piece', 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format', 2),
    (v_mid, v_cat, 'Pizzas', 'Pepperoni', 780, 'piece', 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&auto=format', 3),
    (v_mid, v_cat, 'Pizzas', 'Calzone viande', 900, 'piece', 'https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?w=600&auto=format', 4);

  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Tacos', 2) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Tacos', 'Tacos poulet', 400, 'piece', 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600&auto=format', 1),
    (v_mid, v_cat, 'Tacos', 'Tacos viande', 500, 'piece', 'https://images.unsplash.com/photo-1599974579688-8dbdd335c77f?w=600&auto=format', 2);

  -- ---- Café Akhawat ----
  SELECT id INTO v_mid FROM public.merchants WHERE slug='demo-cafe-akhawat';
  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Cafés', 1) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Cafés', 'Espresso', 80, 'piece', 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=600&auto=format', 1),
    (v_mid, v_cat, 'Cafés', 'Cappuccino', 150, 'piece', 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=600&auto=format', 2),
    (v_mid, v_cat, 'Cafés', 'Latte', 180, 'piece', 'https://images.unsplash.com/photo-1561882468-9110e03e0f78?w=600&auto=format', 3),
    (v_mid, v_cat, 'Cafés', 'Thé à la menthe', 100, 'piece', 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=600&auto=format', 4);

  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'À grignoter', 2) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'À grignoter', 'Cookie pépites', 150, 'piece', 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=600&auto=format', 1),
    (v_mid, v_cat, 'À grignoter', 'Cheesecake', 350, 'piece', 'https://images.unsplash.com/photo-1567171466295-4afa63d45416?w=600&auto=format', 2);

  -- ---- Primeur Au Verger ----
  SELECT id INTO v_mid FROM public.merchants WHERE slug='demo-primeur-verger';
  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Fruits', 1) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Fruits', 'Bananes 1kg', 220, 'kg', 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=600&auto=format', 1),
    (v_mid, v_cat, 'Fruits', 'Pommes Golden 1kg', 280, 'kg', 'https://images.unsplash.com/photo-1568702846914-96b305d2aaeb?w=600&auto=format', 2),
    (v_mid, v_cat, 'Fruits', 'Fraises 500g', 350, 'kg', 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=600&auto=format', 3);

  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Légumes', 2) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Légumes', 'Tomates 1kg', 180, 'kg', 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&auto=format', 1),
    (v_mid, v_cat, 'Légumes', 'Pommes de terre 5kg', 350, 'kg', 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=600&auto=format', 2),
    (v_mid, v_cat, 'Légumes', 'Oignons 1kg', 90, 'kg', 'https://images.unsplash.com/photo-1620574387735-3624d75b2dbc?w=600&auto=format', 3),
    (v_mid, v_cat, 'Légumes', 'Salade laitue', 60, 'piece', 'https://images.unsplash.com/photo-1622206151226-18ca2c9ab4a1?w=600&auto=format', 4);

  -- ---- Pharmacie de la Place ----
  SELECT id INTO v_mid FROM public.merchants WHERE slug='demo-pharmacie-place';
  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Parapharmacie', 1) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Parapharmacie', 'Doliprane 1000 boîte', 280, 'piece', 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=600&auto=format', 1),
    (v_mid, v_cat, 'Parapharmacie', 'Crème solaire SPF50', 1500, 'piece', 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&auto=format', 2),
    (v_mid, v_cat, 'Parapharmacie', 'Vitamines C effervescentes', 650, 'piece', 'https://images.unsplash.com/photo-1550572017-edd951b55104?w=600&auto=format', 3);

  -- ---- Supérette Tasdira ----
  SELECT id INTO v_mid FROM public.merchants WHERE slug='demo-superette-tasdira';
  INSERT INTO public.categories (merchant_id, title, position) VALUES (v_mid, 'Snacks', 1) RETURNING id INTO v_cat;
  INSERT INTO public.products (merchant_id, category_id, category, name_fr, price_da, unit, image_url, position) VALUES
    (v_mid, v_cat, 'Snacks', 'Chips Lays 150g', 120, 'piece', 'https://images.unsplash.com/photo-1613919113640-25732ec5e61f?w=600&auto=format', 1),
    (v_mid, v_cat, 'Snacks', 'Kinder Bueno x4', 350, 'piece', 'https://images.unsplash.com/photo-1623933070571-c08a06af1b9d?w=600&auto=format', 2),
    (v_mid, v_cat, 'Snacks', 'Pringles original', 280, 'piece', 'https://images.unsplash.com/photo-1599490659213-e2b9527bd087?w=600&auto=format', 3);
END $$;

-- 5. CUSTOMERS (profil) — basés sur les auth.users client-*
DO $$
DECLARE
  v_uid UUID;
  v_def RECORD;
  v_customers JSONB := '[
    {"key":"client-mehdi",  "name":"Mehdi Khelladi",   "phone":"+213555900201","wilaya":"16","commune":"Bab Ezzouar"},
    {"key":"client-sara",   "name":"Sara Benhamida",   "phone":"+213661900202","wilaya":"06","commune":"Béjaïa"},
    {"key":"client-yasmine","name":"Yasmine Tlemsani", "phone":"+213770900203","wilaya":"16","commune":"Hydra"},
    {"key":"client-omar",   "name":"Omar Boudjedra",   "phone":"+213555900204","wilaya":"31","commune":"Es Sénia"},
    {"key":"client-rania",  "name":"Rania Mokrani",    "phone":"+213661900205","wilaya":"16","commune":"Birkhadem"},
    {"key":"client-walid",  "name":"Walid Belkacem",   "phone":"+213770900206","wilaya":"25","commune":"El Khroub"}
  ]'::jsonb;
BEGIN
  FOR v_def IN SELECT * FROM jsonb_to_recordset(v_customers)
    AS x(key TEXT, name TEXT, phone TEXT, wilaya TEXT, commune TEXT)
  LOOP
    v_uid := ('00000000-0000-4000-8000-' || lpad(abs(hashtext(v_def.key))::text, 12, '0'))::uuid;
    INSERT INTO public.customers (
      user_id, full_name, phone, email, default_wilaya_code, default_commune
    ) VALUES (
      v_uid, v_def.name, v_def.phone, v_def.key || '@demo.coligo.app', v_def.wilaya, v_def.commune
    );
  END LOOP;
END $$;

-- 6. COMMANDES — un mix : pending, accepted, preparing, ready, completed (sur 3
--    semaines) — pour avoir un wallet/historique riche.
DO $$
DECLARE
  v_mid_sup1 UUID; v_mid_sup2 UUID; v_mid_boul UUID; v_mid_pat UUID;
  v_mid_bou  UUID; v_mid_piz  UUID; v_mid_cafe UUID; v_mid_pri UUID;
  v_cid_mehdi UUID; v_cid_sara UUID; v_cid_yasm UUID;
  v_cid_omar  UUID; v_cid_rania UUID; v_cid_walid UUID;
  v_oid UUID;
BEGIN
  SELECT id INTO v_mid_sup1 FROM public.merchants WHERE slug='demo-superette-el-amine';
  SELECT id INTO v_mid_sup2 FROM public.merchants WHERE slug='demo-superette-tasdira';
  SELECT id INTO v_mid_boul FROM public.merchants WHERE slug='demo-boulangerie-pain-dor';
  SELECT id INTO v_mid_pat  FROM public.merchants WHERE slug='demo-patisserie-salima';
  SELECT id INTO v_mid_bou  FROM public.merchants WHERE slug='demo-boucherie-cherchell';
  SELECT id INTO v_mid_piz  FROM public.merchants WHERE slug='demo-pizzeria-bella-italia';
  SELECT id INTO v_mid_cafe FROM public.merchants WHERE slug='demo-cafe-akhawat';
  SELECT id INTO v_mid_pri  FROM public.merchants WHERE slug='demo-primeur-verger';

  SELECT c.id INTO v_cid_mehdi FROM public.customers c JOIN auth.users u ON u.id=c.user_id WHERE u.email='client-mehdi@demo.coligo.app';
  SELECT c.id INTO v_cid_sara  FROM public.customers c JOIN auth.users u ON u.id=c.user_id WHERE u.email='client-sara@demo.coligo.app';
  SELECT c.id INTO v_cid_yasm  FROM public.customers c JOIN auth.users u ON u.id=c.user_id WHERE u.email='client-yasmine@demo.coligo.app';
  SELECT c.id INTO v_cid_omar  FROM public.customers c JOIN auth.users u ON u.id=c.user_id WHERE u.email='client-omar@demo.coligo.app';
  SELECT c.id INTO v_cid_rania FROM public.customers c JOIN auth.users u ON u.id=c.user_id WHERE u.email='client-rania@demo.coligo.app';
  SELECT c.id INTO v_cid_walid FROM public.customers c JOIN auth.users u ON u.id=c.user_id WHERE u.email='client-walid@demo.coligo.app';

  -- ----- PENDING (en attente d'acceptation par le commerçant) -----
  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_boul, v_cid_mehdi, 'Mehdi Khelladi', '+213555900201', 'pending', 'cash',
    295, 295, now() + interval '15 min', 'asap', 'seed-demo', now() - interval '3 min')
  RETURNING id INTO v_oid;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_oid, 'Baguette tradition', 15, 5, 75),
    (v_oid, 'Croissant beurre', 50, 2, 100),
    (v_oid, 'Pain au chocolat', 60, 2, 120);

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_sup1, v_cid_yasm, 'Yasmine Tlemsani', '+213770900203', 'pending', 'online',
    790, 790, now() + interval '30 min', 'slot', 'seed-demo', now() - interval '1 min')
  RETURNING id INTO v_oid;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_oid, 'Eau minérale Ifri 1.5L', 60, 3, 180),
    (v_oid, 'Lait Candia 1L', 180, 2, 360),
    (v_oid, 'Yaourt Soummam x4', 90, 1, 90),
    (v_oid, 'Pâtes Sim 500g', 95, 1, 95),
    (v_oid, 'Sucre 1kg', 130, 0.5, 65);

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, pickup_slot_at, pickup_type, customer_note, notes, created_at)
  VALUES (v_mid_piz, v_cid_walid, 'Walid Belkacem', '+213770900206', 'pending', 'cash',
    1450, 1450, now() + interval '45 min', 'asap', 'Pas de piment svp', 'seed-demo', now() - interval '4 min')
  RETURNING id INTO v_oid;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_oid, '4 fromages', 850, 1, 850),
    (v_oid, 'Tacos poulet', 400, 1, 400),
    (v_oid, 'Tacos poulet', 400, 0.5, 200);

  -- ----- ACCEPTED -----
  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_bou, v_cid_sara, 'Sara Benhamida', '+213661900202', 'accepted', 'cash',
    2400, 2400, now() + interval '50 min', 'slot', 'seed-demo', now() - interval '14 min')
  RETURNING id INTO v_oid;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_oid, 'Agneau côtelettes 1kg', 2400, 1, 2400);

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_cafe, v_cid_rania, 'Rania Mokrani', '+213661900205', 'accepted', 'online',
    560, 560, now() + interval '20 min', 'asap', 'seed-demo', now() - interval '8 min')
  RETURNING id INTO v_oid;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_oid, 'Cappuccino', 150, 2, 300),
    (v_oid, 'Cookie pépites', 150, 1, 150),
    (v_oid, 'Cheesecake', 350, 0.3, 110);

  -- ----- PREPARING -----
  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_piz, v_cid_omar, 'Omar Boudjedra', '+213555900204', 'preparing', 'cash',
    1300, 1300, now() + interval '15 min', 'asap', 'seed-demo', now() - interval '22 min')
  RETURNING id INTO v_oid;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_oid, 'Margherita', 650, 2, 1300);

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_boul, v_cid_sara, 'Sara Benhamida', '+213661900202', 'preparing', 'cash',
    430, 430, now() + interval '25 min', 'asap', 'seed-demo', now() - interval '20 min')
  RETURNING id INTO v_oid;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_oid, 'Tarte aux pommes', 180, 1, 180),
    (v_oid, 'Brioche pur beurre', 250, 1, 250);

  -- ----- READY -----
  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_pat, v_cid_omar, 'Omar Boudjedra', '+213555900204', 'ready', 'cash',
    1800, 1800, now() + interval '5 min', 'asap', 'seed-demo', now() - interval '40 min')
  RETURNING id INTO v_oid;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_oid, 'Baklawa amandes 1kg', 1800, 1, 1800);

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_pri, v_cid_rania, 'Rania Mokrani', '+213661900205', 'ready', 'cash',
    580, 580, now() + interval '8 min', 'asap', 'seed-demo', now() - interval '32 min')
  RETURNING id INTO v_oid;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_oid, 'Bananes 1kg', 220, 1, 220),
    (v_oid, 'Tomates 1kg', 180, 1, 180),
    (v_oid, 'Salade laitue', 60, 3, 180);

  -- ----- COMPLETED (sur les 3 dernières semaines pour le wallet) -----
  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, commission_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_piz, v_cid_walid, 'Walid Belkacem', '+213770900206', 'completed', 'cash',
    1500, 1500, 75, now() - interval '2 days', 'asap', 'seed-demo', now() - interval '2 days 1 hour');

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, commission_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_sup1, v_cid_mehdi, 'Mehdi Khelladi', '+213555900201', 'completed', 'online',
    980, 980, 49, now() - interval '3 days', 'slot', 'seed-demo', now() - interval '3 days 2 hours');

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, commission_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_boul, v_cid_yasm, 'Yasmine Tlemsani', '+213770900203', 'completed', 'cash',
    380, 380, 19, now() - interval '4 days', 'asap', 'seed-demo', now() - interval '4 days 1 hour');

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, commission_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_pat, v_cid_omar, 'Omar Boudjedra', '+213555900204', 'completed', 'online',
    2400, 2400, 120, now() - interval '5 days', 'slot', 'seed-demo', now() - interval '5 days 3 hours');

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, commission_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_bou, v_cid_walid, 'Walid Belkacem', '+213770900206', 'completed', 'cash',
    3200, 3200, 160, now() - interval '7 days', 'slot', 'seed-demo', now() - interval '7 days');

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, commission_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_cafe, v_cid_rania, 'Rania Mokrani', '+213661900205', 'completed', 'online',
    320, 320, 16, now() - interval '8 days', 'asap', 'seed-demo', now() - interval '8 days 1 hour');

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, commission_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_pri, v_cid_yasm, 'Yasmine Tlemsani', '+213770900203', 'completed', 'cash',
    750, 750, 37, now() - interval '10 days', 'asap', 'seed-demo', now() - interval '10 days');

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, commission_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_sup2, v_cid_sara, 'Sara Benhamida', '+213661900202', 'completed', 'cash',
    640, 640, 32, now() - interval '12 days', 'asap', 'seed-demo', now() - interval '12 days');

  INSERT INTO public.orders (merchant_id, customer_id, customer_name, customer_phone, status, payment_method,
    total_da, subtotal_da, commission_da, pickup_slot_at, pickup_type, notes, created_at)
  VALUES (v_mid_piz, v_cid_mehdi, 'Mehdi Khelladi', '+213555900201', 'completed', 'cash',
    1300, 1300, 65, now() - interval '14 days', 'asap', 'seed-demo', now() - interval '14 days');
END $$;

-- 7. Récap final.
SELECT 'merchants demo' AS table_, count(*)::int AS n FROM public.merchants WHERE slug LIKE 'demo-%'
UNION ALL SELECT 'customers demo', count(*)::int FROM public.customers WHERE email LIKE '%@demo.coligo.app'
UNION ALL SELECT 'products demo',  count(*)::int FROM public.products WHERE merchant_id IN (SELECT id FROM public.merchants WHERE slug LIKE 'demo-%')
UNION ALL SELECT 'orders demo',    count(*)::int FROM public.orders   WHERE notes = 'seed-demo';

-- =============================================================================
-- Coligo — Données de test (commandes)
-- =============================================================================
-- À COLLER dans le SQL Editor Supabase (il bypass les RLS : l'insertion
-- fonctionne même si les policies n'autorisent pas l'INSERT côté app).
--
-- 1) Récupère ton merchant_id :
--      SELECT m.id, m.name FROM public.merchants m
--      JOIN auth.users u ON u.id = m.user_id;
-- 2) Remplace '<MERCHANT_ID>' ci-dessous par ton id, puis exécute.
--
-- Astuce : `npm run db:seed` fait tout ça automatiquement (récupère le 1er
-- commerçant et exécute ce fichier via le pooler).
--
-- Ré-exécutable : les commandes seed (notes = 'seed') sont d'abord supprimées.
-- =============================================================================

DO $$
DECLARE
  v_merchant UUID := '<MERCHANT_ID>';
  v_order    UUID;
BEGIN
  IF v_merchant IS NULL THEN
    RAISE EXCEPTION 'merchant_id manquant';
  END IF;

  -- Nettoyage des commandes seed précédentes (order_items en cascade).
  DELETE FROM public.orders WHERE merchant_id = v_merchant AND notes = 'seed';

  -- 1. pending — Karim Boudjemaa
  INSERT INTO public.orders (merchant_id, customer_name, customer_phone, status, total_da, pickup_slot_at, notes, created_at)
  VALUES (v_merchant, 'Karim Boudjemaa', '+213555100001', 'pending', 125, now() + interval '30 min', 'seed', now() - interval '5 min')
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_order, 'Baguette traditionnelle', 15, 3, 45),
    (v_order, 'Croissant au beurre', 40, 2, 80);

  -- 2. pending — Lina Benali
  INSERT INTO public.orders (merchant_id, customer_name, customer_phone, status, total_da, pickup_slot_at, notes, created_at)
  VALUES (v_merchant, 'Lina Benali', '+213661200002', 'pending', 170, now() + interval '45 min', 'seed', now() - interval '2 min')
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_order, 'Pain complet', 25, 2, 50),
    (v_order, 'Msemen', 30, 4, 120);

  -- 3. accepted — Yacine Mansouri
  INSERT INTO public.orders (merchant_id, customer_name, customer_phone, status, total_da, pickup_slot_at, notes, created_at)
  VALUES (v_merchant, 'Yacine Mansouri', '+213770300003', 'accepted', 720, now() + interval '1 hour', 'seed', now() - interval '15 min')
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_order, 'Pizza margherita', 600, 1, 600),
    (v_order, 'Canette soda', 60, 2, 120);

  -- 4. accepted — Sara Kacem
  INSERT INTO public.orders (merchant_id, customer_name, customer_phone, status, total_da, pickup_slot_at, notes, created_at)
  VALUES (v_merchant, 'Sara Kacem', '+213555400004', 'accepted', 850, now() + interval '1 hour 30 min', 'seed', now() - interval '12 min')
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_order, 'Tacos poulet', 350, 2, 700),
    (v_order, 'Frites', 150, 1, 150);

  -- 5. preparing — Nadir Taleb
  INSERT INTO public.orders (merchant_id, customer_name, customer_phone, status, total_da, pickup_slot_at, notes, created_at)
  VALUES (v_merchant, 'Nadir Taleb', '+213699500005', 'preparing', 1140, now() + interval '20 min', 'seed', now() - interval '25 min')
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_order, 'Burger maison', 450, 2, 900),
    (v_order, 'Canette soda', 60, 2, 120),
    (v_order, 'Tiramisu', 120, 1, 120);

  -- 6. preparing — Amina Larbi
  INSERT INTO public.orders (merchant_id, customer_name, customer_phone, status, total_da, pickup_slot_at, notes, created_at)
  VALUES (v_merchant, 'Amina Larbi', '+213555600006', 'preparing', 380, now() + interval '40 min', 'seed', now() - interval '18 min')
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_order, 'Salade César', 300, 1, 300),
    (v_order, 'Jus d''orange frais', 80, 1, 80);

  -- 7. ready — Mohamed Cherif
  INSERT INTO public.orders (merchant_id, customer_name, customer_phone, status, total_da, pickup_slot_at, notes, created_at)
  VALUES (v_merchant, 'Mohamed Cherif', '+213770700007', 'ready', 940, now() + interval '10 min', 'seed', now() - interval '35 min')
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_order, 'Poulet rôti', 900, 1, 900),
    (v_order, 'Pain', 20, 2, 40);

  -- 8. completed — Fatima Zohra
  INSERT INTO public.orders (merchant_id, customer_name, customer_phone, status, total_da, pickup_slot_at, notes, created_at)
  VALUES (v_merchant, 'Fatima Zohra', '+213555800008', 'completed', 1400, now() - interval '1 hour', 'seed', now() - interval '3 hours')
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_order, 'Gâteau d''anniversaire', 1200, 1, 1200),
    (v_order, 'Café', 100, 2, 200);

  -- 9. completed — Bilal Haddad
  INSERT INTO public.orders (merchant_id, customer_name, customer_phone, status, total_da, pickup_slot_at, notes, created_at)
  VALUES (v_merchant, 'Bilal Haddad', '+213661900009', 'completed', 560, now() - interval '2 hours', 'seed', now() - interval '4 hours')
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_order, 'Sandwich thon', 250, 2, 500),
    (v_order, 'Canette soda', 60, 1, 60);

  -- 10. cancelled — Sofiane Brahimi
  INSERT INTO public.orders (merchant_id, customer_name, customer_phone, status, total_da, pickup_slot_at, notes, created_at)
  VALUES (v_merchant, 'Sofiane Brahimi', '+213770000010', 'cancelled', 800, now() - interval '30 min', 'seed', now() - interval '50 min')
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da) VALUES
    (v_order, 'Pizza 4 fromages', 700, 1, 700),
    (v_order, 'Canette soda', 50, 2, 100);

  -- Fige la commission (5 %) sur les commandes seed.
  UPDATE public.orders
  SET commission_da = round(total_da * 0.05)
  WHERE merchant_id = v_merchant AND notes = 'seed';

  RAISE NOTICE 'Seed terminé pour le commerçant %.', v_merchant;
END $$;

-- =============================================================================
-- 0311 — PHASE 1 catégories : la liste des types de commerçants passe EN BASE
-- (elle était statique dans lib/config/categories.ts). Le super-admin
-- (Marketing) peut créer / réordonner / changer le statut :
--   active        → sélectionnable à l'inscription + filtre marketplace ;
--   coming_soon   → visible GRISÉ « bientôt disponible » à l'inscription ;
--   hidden        → invisible partout.
-- L'image du rond de filtre (ex-table category_filter_images, mig 0310) est
-- fusionnée ici (image_url) ; l'ancienne table est supprimée.
-- Lecture PUBLIQUE ; écritures service_role UNIQUEMENT (actions admin gardées
-- adminCan('marketing')). L'inscription/édition VALIDE le code côté serveur.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.merchant_categories (
  code       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  label_ar   TEXT NOT NULL,
  emoji      TEXT NOT NULL DEFAULT '🏷️',
  image_url  TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'hidden', 'coming_soon')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.merchant_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS merchant_categories_read ON public.merchant_categories;
CREATE POLICY merchant_categories_read ON public.merchant_categories
  FOR SELECT TO anon, authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.merchant_categories
  FROM anon, authenticated;

-- Seed = liste statique actuelle (ordre préservé via position).
INSERT INTO public.merchant_categories (code, label, label_ar, emoji, position) VALUES
  ('boulangerie', 'Boulangerie / Pâtisserie', 'مخبزة / حلويات', '🥖', 10),
  ('superette', 'Supérette / Épicerie', 'بقالة / سوبريت', '🛒', 20),
  ('fast_food', 'Fast-food / Restauration rapide', 'وجبات سريعة', '🍔', 30),
  ('restaurant', 'Restaurant', 'مطعم', '🍽️', 40),
  ('cafe', 'Café / Salon de thé', 'مقهى / قاعة شاي', '☕', 50),
  ('pizzeria', 'Pizzeria', 'بيتزا', '🍕', 60),
  ('creperie', 'Crêperie / Gaufres', 'كريب / وافل', '🥞', 70),
  ('glacier', 'Glacier', 'آيس كريم', '🍦', 80),
  ('boucherie', 'Boucherie / Charcuterie', 'جزارة / لحوم', '🥩', 90),
  ('poissonnerie', 'Poissonnerie', 'أسماك', '🐟', 100),
  ('fruits_legumes', 'Fruits & Légumes', 'خضر وفواكه', '🥦', 110),
  ('produits_bio', 'Produits bio / Terroir', 'منتجات عضوية', '🌿', 120),
  ('fleuriste', 'Fleuriste', 'بائع ورود', '💐', 130),
  ('pharmacie', 'Pharmacie / Parapharmacie', 'صيدلية', '💊', 140),
  ('cosmetiques', 'Cosmétiques / Beauté', 'مستحضرات تجميل', '💄', 150),
  ('vetements', 'Vêtements / Mode', 'ملابس / موضة', '👕', 160),
  ('chaussures', 'Chaussures / Maroquinerie', 'أحذية / جلود', '👟', 170),
  ('bijouterie', 'Bijouterie / Horlogerie', 'مجوهرات / ساعات', '💍', 180),
  ('librairie', 'Librairie / Papeterie', 'مكتبة / قرطاسية', '📚', 190),
  ('jouets', 'Jouets / Enfants', 'ألعاب / أطفال', '🧸', 200),
  ('electronique', 'Électronique / Téléphonie', 'إلكترونيات / هواتف', '📱', 210),
  ('informatique', 'Informatique', 'إعلام آلي', '💻', 220),
  ('electromenager', 'Électroménager', 'أجهزة كهرومنزلية', '🔌', 230),
  ('quincaillerie', 'Quincaillerie / Bricolage', 'أدوات / عتاد', '🔧', 240),
  ('decoration', 'Décoration / Maison', 'ديكور / منزل', '🏠', 250),
  ('ameublement', 'Ameublement / Mobilier', 'أثاث', '🛋️', 260),
  ('sport', 'Articles de sport', 'مستلزمات رياضية', '⚽', 270),
  ('animalerie', 'Animalerie', 'محل حيوانات', '🐾', 280),
  ('autre', 'Autre', 'أخرى', '🏷️', 290)
ON CONFLICT (code) DO NOTHING;

-- Reprise des images de filtres déjà uploadées (mig 0310), puis suppression
-- de l'ancienne table (une seule source désormais).
UPDATE public.merchant_categories mc
SET image_url = cfi.image_url
FROM public.category_filter_images cfi
WHERE cfi.code = mc.code;

DROP TABLE IF EXISTS public.category_filter_images;

-- =============================================================================
-- 0233 — Fondation config Adresses/Prix (Partie E du prompt) + overrides ville
-- =============================================================================
-- RÈGLE 2 du prompt : « aucune valeur hardcodée ». Les constantes géo/prix
-- (longueur min Google, plafonds journaliers, debounce, TTL cache, nb de
-- suggestions, TTL devis, ordre des fournisseurs, poids de scoring) deviennent
-- des CLÉS du registre /admin/config (éditables, bilingues FR/AR, historisées).
--
-- RÈGLE 3 : « multi-ville ». Nouvelle table settings_city_overrides : surcharge
-- d'une clé par wilaya/commune (résolution : commune > wilaya > global). Les
-- valeurs globales restent dans platform_settings (déjà câblé partout).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colonnes de valeur GLOBALES (defaults = anciennes constantes en dur).
-- ----------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS address_suggestions_max      INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS address_search_debounce_ms   INTEGER NOT NULL DEFAULT 450,
  ADD COLUMN IF NOT EXISTS reverse_geocode_debounce_ms  INTEGER NOT NULL DEFAULT 450,
  ADD COLUMN IF NOT EXISTS cache_ttl_google_s           INTEGER NOT NULL DEFAULT 2592000,
  ADD COLUMN IF NOT EXISTS cache_ttl_free_s             INTEGER NOT NULL DEFAULT 86400,
  ADD COLUMN IF NOT EXISTS google_min_qlen              INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS google_daily_global          INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS google_daily_per_user        INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS geocode_google_enabled       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quote_ttl_s                  INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS provider_priority            JSONB   NOT NULL DEFAULT
    '[{"id":"gazetteer","enabled":true},{"id":"merchants","enabled":true},{"id":"photon","enabled":true},{"id":"nominatim","enabled":true},{"id":"google","enabled":true}]'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence_score_weights     JSONB   NOT NULL DEFAULT
    '{"precision":0.4,"provider_success":0.2,"quality":0.2,"validation":0.2}'::jsonb;

-- ----------------------------------------------------------------------------
-- 2. Seed du registre (groupe « geo »). Libellés FR/AR + aide.
-- ----------------------------------------------------------------------------
INSERT INTO public.platform_config_registry
  (key, value_type, group_key, label_fr, label_ar, help_fr, help_ar, sort_order, min_num, max_num, step_num, json_shape)
VALUES
  ('address_suggestions_max', 'number', 'geo',
   'Nombre de suggestions d''adresse', 'عدد اقتراحات العنوان',
   'Combien de suggestions afficher sous la barre de recherche d''adresse. Surchargeable par ville.',
   'عدد الاقتراحات المعروضة تحت شريط البحث عن العنوان.',
   10, 3, 15, 1, NULL),
  ('address_search_debounce_ms', 'number', 'geo',
   'Délai avant recherche d''adresse (ms)', 'مهلة قبل البحث عن العنوان (مللي ثانية)',
   'Attente après la dernière frappe avant d''interroger les fournisseurs (protège le coût et la fluidité).',
   'الانتظار بعد آخر إدخال قبل استدعاء مزودي الخدمة.',
   20, 100, 1200, 50, NULL),
  ('reverse_geocode_debounce_ms', 'number', 'geo',
   'Délai reverse-géocodage au déplacement de l''épingle (ms)', 'مهلة العنونة العكسية عند تحريك الدبوس (مللي ثانية)',
   'Attente après le dernier micro-déplacement de l''épingle avant de résoudre l''adresse (anti-explosion d''appels).',
   'الانتظار بعد آخر تحريك للدبوس قبل تحليل العنوان.',
   30, 100, 1200, 50, NULL),
  ('cache_ttl_google_s', 'number', 'geo',
   'Durée de cache des résultats Google (s)', 'مدة تخزين نتائج جوجل (ثانية)',
   'Une recherche Google payée est réutilisée sans la repayer pendant cette durée (ToS Google = 30 j max).',
   'تُعاد نتيجة بحث جوجل المدفوعة دون إعادة الدفع خلال هذه المدة.',
   40, 3600, 2592000, 3600, NULL),
  ('cache_ttl_free_s', 'number', 'geo',
   'Durée de cache des résultats gratuits (s)', 'مدة تخزين النتائج المجانية (ثانية)',
   'Durée de réutilisation du cache des fournisseurs gratuits (Nominatim/Photon/gazetteer).',
   'مدة إعادة استخدام ذاكرة المزودين المجانيين.',
   50, 60, 2592000, 60, NULL),
  ('google_min_qlen', 'number', 'geo',
   'Longueur min. de requête avant Google', 'الحد الأدنى لطول الاستعلام قبل جوجل',
   'En-dessous de ce nombre de caractères, on reste sur le gratuit (jamais d''appel Google payant).',
   'تحت هذا العدد من الأحرف، يبقى البحث مجانياً.',
   60, 3, 12, 1, NULL),
  ('google_daily_global', 'number', 'geo',
   'Plafond Google / jour (global)', 'سقف جوجل اليومي (إجمالي)',
   'Nombre maximum d''appels Google Places payants par jour, toutes recherches confondues (filet dur).',
   'الحد الأقصى لاستدعاءات جوجل المدفوعة يومياً.',
   70, 0, 100000, 50, NULL),
  ('google_daily_per_user', 'number', 'geo',
   'Plafond Google / jour / client', 'سقف جوجل اليومي لكل زبون',
   'Nombre maximum d''appels Google payants déclenchés par un même client par jour (anti-abus).',
   'الحد الأقصى لاستدعاءات جوجل المدفوعة لكل زبون يومياً.',
   80, 0, 10000, 5, NULL),
  ('geocode_google_enabled', 'bool', 'geo',
   'Activer le recours Google (payant)', 'تفعيل اللجوء إلى جوجل (مدفوع)',
   'Kill-switch coût : si désactivé, AUCUN appel Google payant (seul le gratuit + le cache déjà payé servent).',
   'مفتاح إيقاف التكلفة: عند الإيقاف لا يتم أي استدعاء مدفوع لجوجل.',
   90, NULL, NULL, NULL, NULL),
  ('quote_ttl_s', 'number', 'geo',
   'Validité d''un devis de prix (s)', 'مدة صلاحية عرض السعر (ثانية)',
   'Durée pendant laquelle un devis signé (quote_id) reste valable avant de devoir re-demander une estimation.',
   'المدة التي يبقى فيها عرض السعر الموقّع صالحاً.',
   100, 30, 1800, 10, NULL),
  ('provider_priority', 'json', 'geo',
   'Ordre & activation des fournisseurs', 'ترتيب وتفعيل مزودي الخدمة',
   'Ordre d''essai des fournisseurs de géocodage et activation de chacun. « id » = identifiant, « enabled » = actif.',
   'ترتيب تجربة مزودي العنونة وتفعيل كل منهم.',
   110, NULL, NULL, NULL,
   '{"item_label_fr":"Fournisseur","fields":[{"name":"id","type":"number","label_fr":"Identifiant","label_ar":"المعرّف"},{"name":"enabled","type":"number","label_fr":"Actif (1/0)","label_ar":"مفعّل (1/0)"}]}'::jsonb),
  ('confidence_score_weights', 'json', 'geo',
   'Poids du score de confiance d''adresse', 'أوزان درجة الثقة في العنوان',
   'Pondération des composantes du score d''une adresse (précision, succès du fournisseur, qualité, validation). Somme ≈ 1.',
   'وزن مكونات درجة العنوان (الدقة، نجاح المزود، الجودة، التحقق).',
   120, NULL, NULL, NULL,
   '{"item_label_fr":"Poids","fields":[{"name":"precision","type":"rate","label_fr":"Précision","label_ar":"الدقة"},{"name":"provider_success","type":"rate","label_fr":"Succès fournisseur","label_ar":"نجاح المزود"},{"name":"quality","type":"rate","label_fr":"Qualité","label_ar":"الجودة"},{"name":"validation","type":"rate","label_fr":"Validation","label_ar":"التحقق"}]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Overrides PAR VILLE (wilaya/commune) — surcharge d'une clé.
--    Convention géographique alignée sur service_zone_rules (0169) :
--    wilaya_code TEXT + commune TEXT (nom). Résolution : commune > wilaya.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings_city_overrides (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        TEXT NOT NULL CHECK (scope IN ('wilaya', 'commune')),
  wilaya_code  TEXT NOT NULL,
  commune      TEXT,                         -- requis si scope='commune'
  key          TEXT NOT NULL REFERENCES public.platform_config_registry(key) ON DELETE CASCADE,
  value        JSONB NOT NULL,               -- valeur surchargée (typée comme la clé)
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID,
  CONSTRAINT settings_city_overrides_commune_needs_name
    CHECK (scope <> 'commune' OR (commune IS NOT NULL AND btrim(commune) <> ''))
);

-- Une seule surcharge par (périmètre exact, clé).
CREATE UNIQUE INDEX IF NOT EXISTS settings_city_overrides_unique
  ON public.settings_city_overrides
     (wilaya_code, COALESCE(lower(btrim(commune)), ''), key);

ALTER TABLE public.settings_city_overrides ENABLE ROW LEVEL SECURITY;

-- Lecture/écriture réservées au super-admin (le resolver ci-dessous est DEFINER
-- pour servir les Server Actions sans exposer la table).
DROP POLICY IF EXISTS settings_city_overrides_admin_all ON public.settings_city_overrides;
CREATE POLICY settings_city_overrides_admin_all ON public.settings_city_overrides
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 4. Resolver : valeur surchargée d'une clé pour un (wilaya, commune), ou NULL.
--    L'appelant retombe sur la valeur globale de platform_settings si NULL.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.setting_city_override(
  p_key     TEXT,
  p_wilaya  TEXT DEFAULT NULL,
  p_commune TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT value FROM public.settings_city_overrides o
   WHERE o.key = p_key
     AND p_wilaya IS NOT NULL
     AND o.wilaya_code = p_wilaya
     AND (
       (o.scope = 'commune' AND p_commune IS NOT NULL
        AND lower(btrim(o.commune)) = lower(btrim(p_commune)))
       OR o.scope = 'wilaya'
     )
   -- commune (2) prime sur wilaya (1)
   ORDER BY (CASE o.scope WHEN 'commune' THEN 2 ELSE 1 END) DESC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.setting_city_override(TEXT, TEXT, TEXT)
  TO authenticated, anon;

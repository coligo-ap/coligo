-- =============================================================================
-- 0209 — Éditeur de config générique : registre + 3 nouvelles clés
-- =============================================================================
-- Option B validée : un REGISTRE de métadonnées pilote une page /admin/config
-- générique. Les VALEURS restent dans platform_settings (déjà câblé partout ;
-- trigger 0012 → platform_settings_history archive chaque changement).
--
-- Périmètre ciblé (validé) : on inscrit les 7 clés « SQL seulement » + 3 nouvelles
-- clés (plafonds retrait journalier/glissant, délai dispatch prioritaire) + les
-- 2 clés d'abonnement Prioritaire. On NE touche PAS aux pages admin existantes.
-- EXCLUS volontairement : p2p_enabled (changement délibéré séparé), règle de base
-- du cashback (règle figée, pas un réglage).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Nouvelles colonnes de valeur dans platform_settings
-- ----------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS withdrawal_daily_cap_da     INTEGER NOT NULL DEFAULT 20000,
  ADD COLUMN IF NOT EXISTS withdrawal_sliding_cap_da   INTEGER NOT NULL DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS withdrawal_sliding_days     INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS dispatch_priority_delay_sec INTEGER NOT NULL DEFAULT 10;

-- ----------------------------------------------------------------------------
-- 2. Registre de métadonnées (la valeur vit dans platform_settings.<key>)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_config_registry (
  key         TEXT PRIMARY KEY,
  value_type  TEXT NOT NULL CHECK (value_type IN ('rate','number','da','json','bool')),
  group_key   TEXT NOT NULL,
  label_fr    TEXT NOT NULL, label_ar TEXT NOT NULL,
  help_fr     TEXT,          help_ar  TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  min_num     NUMERIC,
  max_num     NUMERIC,
  step_num    NUMERIC,
  json_shape  JSONB,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_config_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS config_registry_admin_read ON public.platform_config_registry;
CREATE POLICY config_registry_admin_read ON public.platform_config_registry
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 3. Seed des clés (groupes : commissions, cashback, livraison, recharge,
--    retrait, abonnements). Libellés FR/AR + aide.
-- ----------------------------------------------------------------------------
INSERT INTO public.platform_config_registry
  (key, value_type, group_key, label_fr, label_ar, help_fr, help_ar, sort_order, min_num, max_num, step_num, json_shape)
VALUES
  -- COMMISSIONS
  ('driver_fee_rate', 'rate', 'commissions',
   'Commission livraison express (livreur)', 'عمولة التوصيل السريع (السائق)',
   'Part prélevée sur les frais de livraison du livreur en express. Inchangée par l''abonnement.',
   'النسبة المقتطعة من رسوم التوصيل السريع للسائق.',
   10, 0, 0.5, 0.005, NULL),

  -- CASHBACK
  ('cashback_consumption_estimate', 'rate', 'cashback',
   'Estimation taux de consommation cashback', 'تقدير معدل استهلاك الكاش باك',
   'Sert UNIQUEMENT au reporting (provisionnement estimé). N''affecte aucun calcul réel.',
   'للتقارير فقط، لا يؤثر على أي حساب فعلي.',
   10, 0, 1, 0.05, NULL),

  -- LIVRAISON
  ('tour_discount_rate', 'rate', 'livraison',
   'Réduction tournée vs express', 'تخفيض الجولة مقابل السريع',
   'Réduction par défaut du prix de livraison tournée sous le barème express (clampé ≤ express).',
   'التخفيض الافتراضي لسعر توصيل الجولة مقارنة بالسريع.',
   10, 0, 0.9, 0.05, NULL),
  ('service_fee_tiers', 'json', 'livraison',
   'Frais de service (paliers panier)', 'رسوم الخدمة (حسب قيمة السلة)',
   'Frais de service client par tranche de panier. « up_to » = plafond du palier (DA), « fee » = frais (DA).',
   'رسوم الخدمة حسب شريحة السلة.',
   20, NULL, NULL, NULL,
   '{"item_label_fr":"Palier","fields":[{"name":"up_to","type":"da","label_fr":"Jusqu''à (panier DA)","label_ar":"حتى (دج)"},{"name":"fee","type":"da","label_fr":"Frais (DA)","label_ar":"رسوم (دج)"}]}'::jsonb),

  -- RECHARGE
  ('max_topup_da_per_30d', 'da', 'recharge',
   'Plafond de recharge client (30 j glissants)', 'سقف شحن الزبون (30 يوم متحركة)',
   'Montant maximum qu''un client peut recharger sur son solde Coligo Pay sur 30 jours glissants.',
   'الحد الأقصى لشحن رصيد الزبون خلال 30 يوماً.',
   10, 0, NULL, 1000, NULL),
  ('partner_recharge_rate', 'rate', 'recharge',
   'Rémunération agent sur recharge', 'مكافأة الوكيل على الشحن',
   'Part reversée à l''agent Coligo Pay sur chaque recharge espèces qu''il effectue.',
   'النسبة الممنوحة للوكيل على كل شحن نقدي.',
   20, 0, 0.2, 0.001, NULL),

  -- RETRAIT
  ('withdrawal_fee_tiers', 'json', 'retrait',
   'Paliers de frais de retrait (agent / Coligo)', 'شرائح رسوم السحب (الوكيل / كوليغو)',
   'Frais de retrait par tranche de montant. « up_to » (vide = au-delà), « fee_agent », « fee_coligo » en DA.',
   'رسوم السحب حسب شريحة المبلغ.',
   10, NULL, NULL, NULL,
   '{"item_label_fr":"Palier","fields":[{"name":"up_to","type":"da","label_fr":"Jusqu''à (DA, vide = au-delà)","label_ar":"حتى (دج)"},{"name":"fee_agent","type":"da","label_fr":"Part agent (DA)","label_ar":"حصة الوكيل"},{"name":"fee_coligo","type":"da","label_fr":"Part Coligo (DA)","label_ar":"حصة كوليغو"}]}'::jsonb),
  ('withdrawal_daily_cap_da', 'da', 'retrait',
   'Plafond de retrait journalier', 'سقف السحب اليومي',
   'Montant maximum qu''un partenaire peut retirer en une journée.',
   'الحد الأقصى للسحب في اليوم.',
   20, 0, NULL, 1000, NULL),
  ('withdrawal_sliding_cap_da', 'da', 'retrait',
   'Plafond de retrait glissant', 'سقف السحب المتحرك',
   'Montant maximum de retrait sur la fenêtre glissante ci-dessous.',
   'الحد الأقصى للسحب خلال النافذة المتحركة.',
   30, 0, NULL, 1000, NULL),
  ('withdrawal_sliding_days', 'number', 'retrait',
   'Fenêtre du plafond glissant (jours)', 'نافذة السقف المتحرك (أيام)',
   'Durée en jours de la fenêtre glissante du plafond de retrait.',
   'مدة النافذة المتحركة بالأيام.',
   40, 1, 365, 1, NULL),

  -- ABONNEMENTS
  ('sub_priority_monthly_da', 'da', 'abonnements',
   'Abonnement Prioritaire — prix mensuel', 'الاشتراك المميّز — السعر الشهري',
   'Prix mensuel de l''abonnement Prioritaire (livreur + chauffeur).',
   'السعر الشهري للاشتراك المميّز.',
   10, 0, NULL, 50, NULL),
  ('sub_priority_first_month_da', 'da', 'abonnements',
   'Abonnement Prioritaire — promo 1er mois', 'الاشتراك المميّز — عرض الشهر الأول',
   'Prix promotionnel appliqué au premier mois d''abonnement.',
   'السعر الترويجي للشهر الأول.',
   20, 0, NULL, 50, NULL),
  ('dispatch_priority_delay_sec', 'number', 'abonnements',
   'Délai priorité dispatch (secondes)', 'مهلة الأولوية في التوزيع (ثوانٍ)',
   'Durée pendant laquelle une offre est réservée aux abonnés Prioritaires. Passé ce délai, l''offre s''ouvre à tous (la priorité accélère mais ne bloque jamais).',
   'المدة التي تُحجز فيها العروض للمشتركين المميّزين قبل فتحها للجميع.',
   30, 5, 30, 1, NULL)
ON CONFLICT (key) DO NOTHING;

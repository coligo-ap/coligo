-- =============================================================================
-- 0430 — Le super-admin peut TOUT corriger sur une fiche commerçant.
--
-- Besoin réel : aider un commerçant qui n'y arrive pas seul (mauvais logo,
-- adresse fausse, horaires oubliés, rayon de livraison absurde, catégorie
-- erronée…). Aujourd'hui il fallait lui téléphoner et le guider.
--
-- Une seule RPC, `admin_update_merchant(id, patch jsonb)` :
--
--   • GARDE DE DOMAINE : `admin_can('commercants')`, comme l'annuaire ;
--   • LISTE BLANCHE de colonnes — tout le reste est IGNORÉ en silence. Un
--     `patch` malveillant ne peut donc pas toucher ce qui n'est pas prévu ;
--   • les colonnes d'ARGENT (commissions, cashback) et l'APPROBATION ne
--     passent PAS par ici : elles ont déjà leurs écrans et leurs garde-fous.
--     Mélanger « corriger une adresse » et « changer un taux » dans le même
--     geste est exactement comme ça qu'on se trompe de ligne ;
--   • MISE À JOUR PARTIELLE : seules les clés RÉELLEMENT présentes dans le
--     patch sont écrites. Un champ absent du formulaire ne doit jamais effacer
--     la valeur en base (piège vécu sur d'autres écrans du projet) ;
--   • JOURNALISATION : chaque modification est tracée dans `admin_audit_log`
--     si la table existe — un pouvoir pareil doit laisser une trace.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_merchant(
  p_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_keys   text[];
BEGIN
  IF NOT public.admin_can('commercants') THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs du domaine Commerçants.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_id IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Requête invalide' USING ERRCODE = 'check_violation';
  END IF;

  SELECT to_jsonb(m) INTO v_before FROM public.merchants m WHERE m.id = p_id;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'Commerçant introuvable' USING ERRCODE = 'no_data_found';
  END IF;

  -- Colonnes que le super-admin peut corriger. Volontairement SANS argent
  -- (commission_*, cashback_*) ni approval_status.
  v_keys := ARRAY[
    'name', 'slug', 'category', 'description_fr', 'description_ar',
    'logo_url', 'cover_url',
    'phone_public', 'manager_name',
    'address', 'commune', 'city', 'wilaya_code', 'latitude', 'longitude',
    'opening_hours', 'prep_time_min', 'min_order_da',
    'delivery_enabled', 'express_enabled', 'tours_enabled',
    'delivery_radius_km',
    'accepts_cash', 'accepts_online',
    'is_active', 'is_frozen', 'orders_paused',
    'auto_accept_orders', 'catalog_display', 'print_lang'
  ];

  UPDATE public.merchants m SET
    name              = COALESCE((p_patch->>'name')::text, m.name),
    slug              = COALESCE(NULLIF(p_patch->>'slug', ''), m.slug),
    category          = CASE WHEN p_patch ? 'category' THEN NULLIF(p_patch->>'category','') ELSE m.category END,
    description_fr    = CASE WHEN p_patch ? 'description_fr' THEN NULLIF(p_patch->>'description_fr','') ELSE m.description_fr END,
    description_ar    = CASE WHEN p_patch ? 'description_ar' THEN NULLIF(p_patch->>'description_ar','') ELSE m.description_ar END,
    logo_url          = CASE WHEN p_patch ? 'logo_url' THEN NULLIF(p_patch->>'logo_url','') ELSE m.logo_url END,
    cover_url         = CASE WHEN p_patch ? 'cover_url' THEN NULLIF(p_patch->>'cover_url','') ELSE m.cover_url END,
    phone_public      = CASE WHEN p_patch ? 'phone_public' THEN NULLIF(p_patch->>'phone_public','') ELSE m.phone_public END,
    manager_name      = CASE WHEN p_patch ? 'manager_name' THEN NULLIF(p_patch->>'manager_name','') ELSE m.manager_name END,
    address           = CASE WHEN p_patch ? 'address' THEN NULLIF(p_patch->>'address','') ELSE m.address END,
    commune           = CASE WHEN p_patch ? 'commune' THEN NULLIF(p_patch->>'commune','') ELSE m.commune END,
    city              = CASE WHEN p_patch ? 'city' THEN NULLIF(p_patch->>'city','') ELSE m.city END,
    wilaya_code       = CASE WHEN p_patch ? 'wilaya_code' THEN NULLIF(p_patch->>'wilaya_code','') ELSE m.wilaya_code END,
    latitude          = CASE WHEN p_patch ? 'latitude' THEN NULLIF(p_patch->>'latitude','')::double precision ELSE m.latitude END,
    longitude         = CASE WHEN p_patch ? 'longitude' THEN NULLIF(p_patch->>'longitude','')::double precision ELSE m.longitude END,
    opening_hours     = CASE WHEN p_patch ? 'opening_hours' THEN p_patch->'opening_hours' ELSE m.opening_hours END,
    prep_time_min     = CASE WHEN p_patch ? 'prep_time_min' THEN NULLIF(p_patch->>'prep_time_min','')::integer ELSE m.prep_time_min END,
    min_order_da      = CASE WHEN p_patch ? 'min_order_da' THEN NULLIF(p_patch->>'min_order_da','')::integer ELSE m.min_order_da END,
    delivery_enabled  = CASE WHEN p_patch ? 'delivery_enabled' THEN (p_patch->>'delivery_enabled')::boolean ELSE m.delivery_enabled END,
    express_enabled   = CASE WHEN p_patch ? 'express_enabled' THEN (p_patch->>'express_enabled')::boolean ELSE m.express_enabled END,
    tours_enabled     = CASE WHEN p_patch ? 'tours_enabled' THEN (p_patch->>'tours_enabled')::boolean ELSE m.tours_enabled END,
    delivery_radius_km= CASE WHEN p_patch ? 'delivery_radius_km' THEN NULLIF(p_patch->>'delivery_radius_km','')::numeric ELSE m.delivery_radius_km END,
    accepts_cash      = CASE WHEN p_patch ? 'accepts_cash' THEN (p_patch->>'accepts_cash')::boolean ELSE m.accepts_cash END,
    accepts_online    = CASE WHEN p_patch ? 'accepts_online' THEN (p_patch->>'accepts_online')::boolean ELSE m.accepts_online END,
    is_active         = CASE WHEN p_patch ? 'is_active' THEN (p_patch->>'is_active')::boolean ELSE m.is_active END,
    is_frozen         = CASE WHEN p_patch ? 'is_frozen' THEN (p_patch->>'is_frozen')::boolean ELSE m.is_frozen END,
    orders_paused     = CASE WHEN p_patch ? 'orders_paused' THEN (p_patch->>'orders_paused')::boolean ELSE m.orders_paused END,
    auto_accept_orders= CASE WHEN p_patch ? 'auto_accept_orders' THEN (p_patch->>'auto_accept_orders')::boolean ELSE m.auto_accept_orders END,
    catalog_display   = CASE WHEN p_patch ? 'catalog_display' THEN NULLIF(p_patch->>'catalog_display','') ELSE m.catalog_display END,
    print_lang        = CASE WHEN p_patch ? 'print_lang' THEN NULLIF(p_patch->>'print_lang','') ELSE m.print_lang END
  WHERE m.id = p_id;

  SELECT to_jsonb(m) INTO v_after FROM public.merchants m WHERE m.id = p_id;

  -- Trace : QUI a changé QUOI, et quelles valeurs avant/après (colonnes de la
  -- liste blanche uniquement — on ne recopie pas la fiche entière).
  BEGIN
    INSERT INTO public.admin_audit_log
      (admin_email, action, target_kind, target_id, note, old_value, new_value)
    VALUES (
      COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''), 'inconnu'),
      'merchant.update',
      'merchant',
      p_id,
      'Fiche commerçant corrigée par l''équipe Coligo',
      (SELECT jsonb_object_agg(k, v_before->k) FROM unnest(v_keys) AS k
        WHERE v_before->k IS DISTINCT FROM v_after->k),
      (SELECT jsonb_object_agg(k, v_after->k) FROM unnest(v_keys) AS k
        WHERE v_before->k IS DISTINCT FROM v_after->k)
    );
  EXCEPTION WHEN undefined_table THEN
    NULL; -- pas de journal dans cette base : la mise à jour reste valable
  END;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Appelée depuis la SESSION du super-admin (jamais en service_role) : sans son
-- JWT, la garde de domaine ci-dessus ne voudrait rien dire.
REVOKE ALL ON FUNCTION public.admin_update_merchant(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_merchant(uuid, jsonb)
  TO authenticated, service_role;

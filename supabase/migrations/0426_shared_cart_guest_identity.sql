-- ============================================================================
-- 0426 — Identité INVITÉ du panier partagé : rotation + révocation
-- (dernier point de l'audit sécurité du 31/07/2026).
--
-- Constat : `guest_token` était un porteur (bearer) généré côté navigateur et
-- gardé en localStorage — ni rotatif, ni révocable. Volé (XSS, appareil
-- partagé, capture d'écran d'un lien), il permettait d'agir comme ce membre
-- pendant toute la vie du panier (48 h).
--
-- Correctifs :
--   1. shared_cart_rotate_guest_token : le serveur RÉGÉNÈRE le jeton après
--      chaque écriture → la fenêtre d'exploitation d'un jeton volé se réduit à
--      une seule action, et l'usage d'un ancien jeton échoue (`not_member`).
--      Le jeton vit désormais dans un cookie httpOnly (illisible en JS).
--   2. shared_cart_revoke_member : le PROPRIÉTAIRE peut retirer un membre —
--      son jeton est invalidé immédiatement (les lignes déjà ajoutées
--      restent, elles appartiennent au panier du groupe).
-- ============================================================================

ALTER TABLE public.shared_cart_members
  ADD COLUMN IF NOT EXISTS token_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- 1) ROTATION — renvoie le NOUVEAU jeton, ou NULL si l'ancien n'est pas valide
--    (jeton révoqué / inconnu). Le capitaine (guest_token NULL) n'a rien à
--    faire tourner : sa session fait foi.
CREATE OR REPLACE FUNCTION public.shared_cart_rotate_guest_token(
  p_token       text,
  p_guest_token uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cart_id uuid;
  v_new     uuid;
BEGIN
  IF p_guest_token IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_cart_id FROM public.shared_carts WHERE share_token = p_token;
  IF v_cart_id IS NULL THEN RETURN NULL; END IF;

  v_new := gen_random_uuid();
  UPDATE public.shared_cart_members
     SET guest_token = v_new,
         token_rotated_at = now()
   WHERE cart_id = v_cart_id
     AND guest_token = p_guest_token
     AND revoked_at IS NULL
  RETURNING guest_token INTO v_new;

  RETURN v_new; -- NULL si aucune ligne (jeton périmé/révoqué)
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_rotate_guest_token(text, uuid)
  FROM PUBLIC, anon, authenticated;

-- 2) RÉVOCATION par le PROPRIÉTAIRE — invalide le jeton d'un membre invité.
--    Contrôle d'accès : l'appelant doit être le capitaine du panier.
CREATE OR REPLACE FUNCTION public.shared_cart_revoke_member(
  p_cart_id   uuid,
  p_member_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_is_captain boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.shared_carts sc
      JOIN public.customers c ON c.id = sc.captain_customer_id
     WHERE sc.id = p_cart_id AND c.user_id = auth.uid()
  ) INTO v_is_captain;
  IF NOT v_is_captain THEN RETURN false; END IF;

  UPDATE public.shared_cart_members
     SET guest_token = gen_random_uuid(),  -- l'ancien jeton ne vaut plus rien
         revoked_at = now()
   WHERE id = p_member_id
     AND cart_id = p_cart_id
     AND kind = 'guest';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.shared_cart_revoke_member(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shared_cart_revoke_member(uuid, uuid)
  TO authenticated;

-- 3) Un membre RÉVOQUÉ n'est plus un acteur valide : garde centrale, donc
--    toutes les RPC invité (add_item, set_qty, join…) le refusent d'un coup.
--    Redéfinie depuis la définition LIVE (0405) + condition revoked_at.
CREATE OR REPLACE FUNCTION public._shared_cart_actor(
  p_cart_id     uuid,
  p_guest_token uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member uuid;
BEGIN
  IF p_guest_token IS NOT NULL THEN
    SELECT id INTO v_member FROM public.shared_cart_members
     WHERE cart_id = p_cart_id
       AND guest_token = p_guest_token
       AND revoked_at IS NULL;
    RETURN v_member;
  END IF;
  -- Capitaine connecté (la page room est la même pour lui).
  SELECT m.id INTO v_member
    FROM public.shared_cart_members m
    JOIN public.shared_carts sc ON sc.id = m.cart_id
    JOIN public.customers c ON c.id = sc.captain_customer_id
   WHERE m.cart_id = p_cart_id AND m.kind = 'captain' AND c.user_id = auth.uid();
  RETURN v_member;
END;
$$;

REVOKE ALL ON FUNCTION public._shared_cart_actor(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

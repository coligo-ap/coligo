-- =============================================================================
-- 0033 — device_tokens : registre des tokens FCM (push notifications)
-- =============================================================================
-- Un token FCM est lié à un appareil + une installation d'app (pas à un user).
-- Si plusieurs comptes se connectent sur le même appareil, on RÉAFFECTE le
-- token au dernier user connecté (un seul user actif par token = unique).
--
-- Le serveur lit cette table avec service_role pour envoyer les push :
--   « tokens où user_id = <merchant_user_id> et role = 'merchant' »
-- Les tokens invalides (réponse FCM UNREGISTERED / INVALID_ARGUMENT) sont
-- supprimés par le helper d'envoi pour ne pas spammer FCM.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('merchant', 'customer', 'courier')),
  token         TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un token = un seul user (réaffectation par upsert ON CONFLICT(token)).
CREATE UNIQUE INDEX IF NOT EXISTS device_tokens_token_unique
  ON public.device_tokens (token);

-- Lookup principal côté serveur : « tous les tokens d'un user dans un rôle ».
CREATE INDEX IF NOT EXISTS device_tokens_user_role_idx
  ON public.device_tokens (user_id, role);

-- =============================================================================
-- RLS — chacun ne voit/gère QUE ses propres tokens.
-- L'envoi de push se fait côté serveur avec service_role (bypass RLS),
-- l'enregistrement client passe par /api/device-tokens qui valide la session
-- puis upsert via service_role (pour pouvoir réaffecter un token à un autre user).
-- =============================================================================
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_tokens_select_own" ON public.device_tokens;
CREATE POLICY "device_tokens_select_own"
  ON public.device_tokens FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "device_tokens_delete_own" ON public.device_tokens;
CREATE POLICY "device_tokens_delete_own"
  ON public.device_tokens FOR DELETE
  USING (user_id = auth.uid());

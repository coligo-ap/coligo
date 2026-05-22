-- =============================================================================
-- Coligo v3 - Migration 0006 : journal d'audit des commandes + Realtime
-- =============================================================================
-- Appliquée automatiquement via `npm run db:push` (pooler Supabase).
--
-- (NB : numérotée 0006 car 0005 = products_position. Le prompt la nommait
--  « 0005_order_events ».)
--
-- - Table order_events : journal append-only des changements de statut.
-- - client_operation_id (UUID UNIQUE) pour l'idempotency des Server Actions.
-- - Active Realtime sur public.orders (kanban temps réel).
-- =============================================================================

CREATE TABLE public.order_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status         public.order_status,
  to_status           public.order_status NOT NULL,
  client_operation_id UUID UNIQUE,
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_events_order_id ON public.order_events(order_id, created_at);

-- ============================================================================
-- RLS : le commerçant ne voit / n'écrit que les events de SES commandes.
-- ============================================================================
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_events_select_own_merchant" ON public.order_events
  FOR SELECT USING (
    order_id IN (
      SELECT o.id FROM public.orders o
      JOIN public.merchants m ON m.id = o.merchant_id
      WHERE m.user_id = auth.uid()
    )
  );

CREATE POLICY "order_events_insert_own_merchant" ON public.order_events
  FOR INSERT WITH CHECK (
    order_id IN (
      SELECT o.id FROM public.orders o
      JOIN public.merchants m ON m.id = o.merchant_id
      WHERE m.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Realtime : diffuser les changements de la table orders (INSERT/UPDATE).
-- Les events Realtime respectent la RLS : chaque commerçant ne reçoit que ses
-- commandes (filtre merchant_id côté client + policies SELECT).
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END $$;

"use client";

// =============================================================================
// Notifications in-app temps réel (cloche + badge) — client, chauffeur, livreur.
// =============================================================================
// Patron maison (cf. CLAUDE.md « arrière-plan → reprise ») :
//   Realtime INSERT = instantané · poll 60 s = filet · useResumeResync = reprise.
// Deux sources selon l'espace :
//   - `user_notifications` (mig 0363) filtrée par audience (client / chauffeur) ;
//   - `driver_notifications` (mig 0352) pour le livreur (table historique).
// Le badge tombe à zéro au marquage lu (RPC dédiée, optimiste côté UI).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  route: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotifSource =
  | { table: "user_notifications"; audience: "customer" | "chauffeur" }
  | { table: "driver_notifications" };

type Rpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

export function useAppNotifications(source: NotifSource, enabled = true) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [resyncNonce, setResyncNonce] = useState(0);
  useResumeResync(() => setResyncNonce((n) => n + 1));

  // user_id requis pour le filtre Realtime (RLS scope déjà la lecture).
  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, [enabled]);

  const audience =
    source.table === "user_notifications" ? source.audience : null;

  const poll = useCallback(async () => {
    const supabase = createClient();
    if (audience) {
      const { data } = await supabase
        .from("user_notifications")
        .select("id, kind, title, body, route, read_at, created_at")
        .eq("audience", audience)
        .order("created_at", { ascending: false })
        .limit(30);
      setItems((data ?? []) as AppNotification[]);
    } else {
      const { data } = await supabase
        .from("driver_notifications")
        .select("id, kind, title, body, route, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      setItems((data ?? []) as AppNotification[]);
    }
  }, [audience]);

  useEffect(() => {
    if (!enabled || !userId) return;
    void poll();
    const supabase = createClient();
    const table = audience ? "user_notifications" : "driver_notifications";
    const ch = supabase
      .channel(`notif-${table}-${userId}`)
      .on(
        "postgres_changes",
        audience
          ? {
              event: "INSERT",
              schema: "public",
              table,
              filter: `user_id=eq.${userId}`,
            }
          : { event: "INSERT", schema: "public", table },
        () => void poll()
      )
      .subscribe();
    const id = setInterval(() => void poll(), 60_000);
    return () => {
      clearInterval(id);
      void supabase.removeChannel(ch);
    };
    // resyncNonce : poll immédiat + ré-abonnement au retour d'arrière-plan.
  }, [enabled, userId, audience, poll, resyncNonce]);

  const unread = items.filter((n) => !n.read_at).length;

  // Marquage lu OPTIMISTE (badge à zéro tout de suite) + RPC serveur.
  const markingRef = useRef(false);
  const markAllRead = useCallback(async () => {
    if (markingRef.current || items.every((n) => n.read_at)) return;
    markingRef.current = true;
    const now = new Date().toISOString();
    setItems((old) => old.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    try {
      const supabase = createClient();
      // ⚠️ Toujours .bind(supabase) — extraire rpc sans bind casse this.rest.
      const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
      if (audience)
        await rpc("mark_user_notifications_read", {
          p_audience: audience,
          p_ids: null,
        });
      else await rpc("driver_mark_notifications_read", {});
    } catch {
      /* best-effort — le prochain poll remettra l'état serveur */
    } finally {
      markingRef.current = false;
    }
  }, [items, audience]);

  return { items, unread, markAllRead, refresh: poll };
}

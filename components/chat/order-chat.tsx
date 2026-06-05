"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Phone, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { sendOrderMessage } from "@/lib/chat/actions";
import {
  labelFor,
  quickFor,
  type ChatLocale,
  type ChatRole,
} from "@/lib/chat/messages";

/**
 * Chat in-app léger client ↔ livreur, attaché à UNE commande en livraison.
 *
 * - Messages PRÉDÉFINIS uniquement (boutons), pas de texte libre.
 * - Temps réel via Realtime sur `order_messages` + repli polling 10 s.
 * - L'envoi passe par l'action serveur `sendOrderMessage` (RPC + push au
 *   destinataire).
 * - Réutilisé des deux côtés via la prop `role` ("customer" | "courier").
 */

type Msg = {
  id: string;
  sender_role: "customer" | "courier";
  code: string;
  created_at: string;
};

function hhmm(iso: string): string {
  const d = new Date(iso);
  const h = `${d.getHours()}`.padStart(2, "0");
  const m = `${d.getMinutes()}`.padStart(2, "0");
  return `${h}:${m}`;
}

export function OrderChat({
  orderId,
  role,
  locale = "fr",
  phone,
  phoneLabel,
}: {
  orderId: string;
  role: ChatRole;
  locale?: ChatLocale;
  /** Numéro pour le bouton d'appel (optionnel). */
  phone?: string | null;
  phoneLabel?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const isRtl = locale === "ar";

  // Charge l'historique + s'abonne au temps réel.
  useEffect(() => {
    const supabase = createClient();
    let alive = true;

    const merge = (rows: Msg[]) => {
      if (!alive) return;
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const r of rows) byId.set(r.id, r);
        return [...byId.values()].sort((a, b) =>
          a.created_at < b.created_at ? -1 : 1
        );
      });
    };

    const load = async () => {
      const { data } = await supabase
        .from("order_messages")
        .select("id, sender_role, code, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (data) merge(data as Msg[]);
    };
    void load();

    const channel = supabase
      .channel(`order-chat-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_messages",
          filter: `order_id=eq.${orderId}`,
        },
        (payload) => merge([payload.new as Msg])
      )
      .subscribe();

    // Filet de sécurité si le websocket décroche.
    const poll = setInterval(load, 10_000);

    return () => {
      alive = false;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [orderId]);

  // Auto-scroll en bas à chaque nouveau message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = (code: string) => {
    setError(null);
    start(async () => {
      const r = await sendOrderMessage(orderId, code);
      if (!r.ok) {
        setError(
          r.reason === "not_active"
            ? "La livraison n'est plus active."
            : "Envoi impossible. Réessayez."
        );
      }
    });
  };

  const quick = quickFor(role);

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="border-border bg-surface overflow-hidden rounded-[18px] border shadow-sm"
    >
      {/* En-tête */}
      <div className="border-border flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <p className="text-foreground flex items-center gap-1.5 text-[13px] font-bold">
          <Send className="size-3.5" />
          {isRtl ? "الرسائل" : "Messages"}
        </p>
        {phone && (
          <a
            href={`tel:${phone}`}
            aria-label={phoneLabel ?? "Appeler"}
            className="bg-success-50 text-success-700 hover:bg-success-100 grid size-8 shrink-0 place-items-center rounded-[10px] transition-colors"
          >
            <Phone className="size-3.5" />
          </a>
        )}
      </div>

      {/* Fil de discussion */}
      <div
        ref={threadRef}
        className="flex max-h-[180px] min-h-[64px] flex-col gap-1.5 overflow-y-auto px-3.5 py-3"
      >
        {messages.length === 0 ? (
          <p className="text-muted py-2 text-center text-[12px]">
            {isRtl
              ? "أرسل رسالة سريعة أدناه."
              : "Envoyez un message rapide ci-dessous."}
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_role === role;
            return (
              <div
                key={m.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[78%] rounded-2xl px-3 py-1.5 text-[13px] font-semibold ${
                    mine
                      ? "bg-primary-600 rounded-br-md text-white"
                      : "bg-surface-2 text-foreground rounded-bl-md"
                  }`}
                >
                  <span>{labelFor(m.code, locale)}</span>
                  <span
                    className={`ml-2 align-middle text-[10px] font-medium ${
                      mine ? "text-white/70" : "text-muted"
                    }`}
                  >
                    {hhmm(m.created_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Réponses rapides */}
      <div className="border-border flex flex-wrap gap-1.5 border-t px-3 py-2.5">
        {quick.map((q) => (
          <button
            key={q.code}
            type="button"
            disabled={pending}
            onClick={() => send(q.code)}
            className="border-border bg-surface text-foreground hover:bg-surface-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors active:scale-95 disabled:opacity-50"
          >
            {locale === "ar" ? q.ar : q.fr}
          </button>
        ))}
        {pending && (
          <span className="text-muted inline-flex items-center gap-1 px-1 text-[12px]">
            <Loader2 className="size-3 animate-spin" />
          </span>
        )}
      </div>

      {error && (
        <p className="text-danger-700 bg-danger-50 px-3.5 py-1.5 text-[12px] font-semibold">
          {error}
        </p>
      )}
    </div>
  );
}

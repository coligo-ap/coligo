"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, CheckCheck, Loader2, Phone, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  markOrderMessagesRead,
  sendOrderMessage,
  sendOrderText,
} from "@/lib/chat/actions";
import {
  labelFor,
  quickFor,
  type ChatLocale,
  type ChatRole,
} from "@/lib/chat/messages";

/**
 * Chat in-app léger client ↔ livreur, attaché à UNE commande en livraison.
 *
 * - Messages PRÉDÉFINIS (boutons) + TEXTE LIBRE (≤ 300 caractères/message).
 * - Temps réel via Realtime sur `order_messages` + repli polling 10 s.
 * - L'envoi passe par les actions serveur `sendOrderMessage` (code) /
 *   `sendOrderText` (texte) — RPC + push au destinataire.
 * - La discussion se ferme automatiquement à la livraison (refus côté RPC).
 * - Réutilisé des deux côtés via la prop `role` ("customer" | "courier").
 */

/** Limite de caractères par message (alignée sur le RPC `send_order_text_message`). */
const MAX_CHARS = 300;

type Msg = {
  id: string;
  sender_role: "customer" | "courier";
  code: string | null;
  body: string | null;
  created_at: string;
  delivered_at?: string | null;
  read_at?: string | null;
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
        .select(
          "id, sender_role, code, body, created_at, delivered_at, read_at"
        )
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (data) merge(data as unknown as Msg[]);
      // Chat affiché = je lis : l'expéditeur voit « Lu » (mig 0363).
      void markOrderMessagesRead(orderId, true);
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
        (payload) => {
          const row = payload.new as unknown as Msg;
          merge([row]);
          // Message reçu pendant que le chat est affiché → lu immédiatement.
          if (row.sender_role !== role)
            void markOrderMessagesRead(orderId, true);
        }
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

  const [text, setText] = useState("");

  const reasonToMessage = (reason?: string): string => {
    if (reason === "not_active")
      return isRtl
        ? "لم يعد التوصيل نشطاً."
        : "La livraison n'est plus active.";
    if (reason === "too_many")
      return isRtl
        ? "وصلت المحادثة إلى الحد الأقصى."
        : "Discussion trop longue (limite atteinte).";
    if (reason === "too_long")
      return isRtl ? "الرسالة طويلة جداً." : "Message trop long.";
    return isRtl
      ? "تعذّر الإرسال. أعد المحاولة."
      : "Envoi impossible. Réessayez.";
  };

  const send = (code: string) => {
    setError(null);
    start(async () => {
      const r = await sendOrderMessage(orderId, code);
      if (!r.ok) setError(reasonToMessage(r.reason));
    });
  };

  const sendText = () => {
    const value = text.trim();
    if (value.length === 0 || value.length > MAX_CHARS) return;
    setError(null);
    start(async () => {
      const r = await sendOrderText(orderId, value);
      if (r.ok) setText("");
      else setError(reasonToMessage(r.reason));
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
                  <span className="break-words whitespace-pre-wrap">
                    {m.body ?? labelFor(m.code ?? "", locale)}
                  </span>
                  <span
                    className={`ms-2 inline-flex items-center gap-0.5 align-middle text-[10px] font-medium ${
                      mine ? "text-white/70" : "text-muted"
                    }`}
                  >
                    {hhmm(m.created_at)}
                    {/* Accusés Envoyé / Reçu / Lu (mig 0363) — mes messages. */}
                    {mine &&
                      (m.delivered_at || m.read_at ? (
                        <CheckCheck
                          className="size-3"
                          style={m.read_at ? { color: "#7CF0B2" } : undefined}
                        />
                      ) : (
                        <Check className="size-3" />
                      ))}
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

      {/* Saisie libre (≤ 300 caractères) */}
      <div className="border-border border-t px-3 py-2.5">
        <div className="bg-surface-2 focus-within:border-primary-400 border-border flex items-end gap-2 rounded-[14px] border px-3 py-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendText();
              }
            }}
            rows={1}
            placeholder={isRtl ? "اكتب رسالة…" : "Écrire un message…"}
            disabled={pending}
            className="text-foreground max-h-24 min-h-[24px] w-full resize-none bg-transparent text-[13px] outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={sendText}
            disabled={pending || text.trim().length === 0}
            aria-label={isRtl ? "إرسال" : "Envoyer"}
            className="bg-primary-600 hover:bg-primary-700 grid size-8 shrink-0 place-items-center rounded-full text-white transition-colors disabled:opacity-40"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </button>
        </div>
        {text.length > MAX_CHARS - 50 && (
          <p className="text-subtle mt-1 text-right text-[11px] tabular-nums">
            {text.length}/{MAX_CHARS}
          </p>
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

"use client";

// =============================================================================
// Conversation de course (client ↔ chauffeur) — feuille plein écran façon Bolt.
// =============================================================================
// UN SEUL composant pour les deux camps (anti-duplication, cf. CLAUDE.md) :
// les actions serveur (fetch / send / markRead) sont passées en props par
// l'écran hôte — côté client OU côté chauffeur. Fonctionnalités :
//   • temps réel (Realtime INSERT sur `ride_messages`) + poll filet 20 s ;
//   • accusés « Envoyé / Reçu / Lu » (mig 0175) sur ses propres messages ;
//   • tout est marqué LU tant que la feuille est ouverte (l'autre voit « Lu ») ;
//   • réponses rapides + texte libre, auto-scroll, safe-area.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, CheckCheck, Loader2, Send, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import { createClient } from "@/lib/supabase/client";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";

const VIOLET = "#6C2BD9";
const GO = "#16B364";

export type RideChatMessage = {
  id: string;
  sender: string;
  body: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
};

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
}

export function RideChatSheet({
  rideId,
  side,
  peerName,
  peerAvatar,
  fetchMessages,
  sendMessage,
  markRead,
  onClose,
}: {
  rideId: string;
  side: "customer" | "chauffeur";
  peerName: string;
  /** Avatar du correspondant (vignette d'en-tête) — repli initiale. */
  peerAvatar?: React.ReactNode;
  fetchMessages: (rideId: string) => Promise<RideChatMessage[]>;
  sendMessage: (
    rideId: string,
    body: string
  ) => Promise<{ ok: boolean; error?: string }>;
  markRead: (rideId: string, read: boolean) => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations("drive.chat");
  const [msgs, setMsgs] = useState<RideChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingQuick, setPendingQuick] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [resyncNonce, setResyncNonce] = useState(0);
  useResumeResync(() => setResyncNonce((n) => n + 1));

  const poll = useCallback(async () => {
    const m = await fetchMessages(rideId);
    setMsgs(m);
    setLoaded(true);
    // Feuille ouverte = je lis → l'expéditeur voit « Lu » en face.
    void markRead(rideId, true);
  }, [rideId, fetchMessages, markRead]);

  useEffect(() => {
    void poll();
    const supabase = createClient();
    // Topic suffixé par le nonce : `removeChannel` est ASYNCHRONE — au retour
    // d'arrière-plan, un topic identique renverrait le canal encore souscrit
    // (le `.on()` jetterait). Un nom neuf par (ré)abonnement écarte la course.
    const ch = supabase
      .channel(`ride-chat-${side}-${rideId}-${resyncNonce}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ride_messages",
          filter: `ride_id=eq.${rideId}`,
        },
        () => void poll()
      )
      .subscribe();
    const id = setInterval(() => void poll(), 20_000);
    return () => {
      clearInterval(id);
      void supabase.removeChannel(ch);
    };
    // resyncNonce : poll immédiat + ré-abonnement au retour d'arrière-plan.
  }, [rideId, side, poll, resyncNonce]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length]);

  const send = async (body: string, quick = false) => {
    const value = body.trim();
    if (sending || !value) return;
    setSending(true);
    setError(null);
    if (quick) setPendingQuick(body);
    try {
      const res = await sendMessage(rideId, value);
      if (res.ok) {
        if (!quick) setText("");
        setMsgs(await fetchMessages(rideId));
      } else setError(res.error ?? t("sendError"));
    } catch {
      setError(t("sendError"));
    } finally {
      setPendingQuick(null);
      setSending(false);
    }
  };

  const quick = t.raw(
    side === "customer" ? "quick" : "quickDriver"
  ) as string[];
  const lastMineId = [...msgs].reverse().find((m) => m.sender === side)?.id;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[130] flex items-end justify-center bg-[rgba(8,9,15,.45)] sm:items-center"
        onClick={onClose}
      >
        <div
          className="drive-up drive-jakarta flex h-[82vh] w-full flex-col rounded-t-[26px] bg-[var(--d-surface)] text-[var(--d-ink)] sm:h-[70vh] sm:max-w-md sm:rounded-[26px]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* En-tête : correspondant + confidentialité */}
          <div className="flex items-center gap-3 border-b border-[var(--d-line)] px-4 pt-3.5 pb-3">
            {peerAvatar ?? (
              <span
                className="drive-sora grid size-10 shrink-0 place-items-center rounded-full text-[15px] font-extrabold text-white"
                style={{
                  background: `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
                }}
              >
                {peerName[0]?.toUpperCase()}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <b className="drive-sora block truncate text-[15px] font-extrabold">
                {peerName}
              </b>
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--d-muted)]">
                <ShieldCheck className="size-3" style={{ color: GO }} />
                {t("sub")}
              </span>
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--d-soft)] text-[var(--d-muted)]"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Fil */}
          <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
            {!loaded ? (
              <div className="flex justify-center py-8">
                <Loader2
                  className="size-5 animate-spin"
                  style={{ color: VIOLET }}
                />
              </div>
            ) : msgs.length === 0 ? (
              <p className="py-8 text-center text-[12.5px] font-semibold text-[var(--d-muted)]">
                {t("empty")}
              </p>
            ) : (
              msgs.map((m) => {
                const mine = m.sender === side;
                const read = !!m.read_at;
                const delivered = !!m.delivered_at;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex",
                      mine ? "justify-end" : "justify-start"
                    )}
                  >
                    <div className={cn("max-w-[80%]", mine && "text-end")}>
                      <div
                        className={cn(
                          "inline-block rounded-[16px] px-3 py-2 text-start text-[13px] leading-snug font-medium break-words",
                          mine
                            ? "rounded-br-[5px] text-white"
                            : "rounded-bl-[5px] bg-[var(--d-soft)]"
                        )}
                        style={mine ? { background: VIOLET } : undefined}
                      >
                        {m.body}
                        <span
                          className={cn(
                            "ms-2 inline-flex items-center gap-0.5 align-baseline text-[9.5px] font-semibold",
                            mine ? "text-white/70" : "text-[var(--d-muted)]"
                          )}
                        >
                          {hhmm(m.created_at)}
                          {mine &&
                            (delivered || read ? (
                              <CheckCheck
                                className="size-3"
                                style={read ? { color: "#7CF0B2" } : undefined}
                              />
                            ) : (
                              <Check className="size-3" />
                            ))}
                        </span>
                      </div>
                      {/* Statut détaillé sous le DERNIER message envoyé. */}
                      {mine && m.id === lastMineId && (
                        <span
                          className="mt-0.5 block text-[9.5px] font-semibold"
                          style={{ color: read ? GO : "var(--d-muted)" }}
                        >
                          {read
                            ? t("read")
                            : delivered
                              ? t("delivered")
                              : t("sent")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* Réponses rapides */}
          <div className="flex scrollbar-none gap-1.5 overflow-x-auto px-4 pb-2">
            {quick.map((q) => (
              <button
                key={q}
                type="button"
                disabled={sending}
                onClick={() => void send(q, true)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-1.5 text-xs font-bold whitespace-nowrap active:scale-95 disabled:opacity-50"
              >
                {pendingQuick === q && (
                  <Loader2 className="size-3 animate-spin" />
                )}
                {q}
              </button>
            ))}
          </div>

          {error && (
            <p
              className="px-4 pb-1 text-[11.5px] font-bold"
              style={{ color: "#E5484D" }}
            >
              {error}
            </p>
          )}

          {/* Saisie */}
          <div className="flex items-center gap-2 border-t border-[var(--d-line)] px-4 pt-2.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 500))}
              onKeyDown={(e) => e.key === "Enter" && void send(text)}
              placeholder={t("ph")}
              className="h-11 min-w-0 flex-1 rounded-full border border-[var(--d-line)] bg-[var(--d-soft)] px-4 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]"
            />
            <button
              type="button"
              disabled={sending || !text.trim()}
              onClick={() => void send(text)}
              aria-label={t("sendLabel")}
              className="grid size-11 shrink-0 place-items-center rounded-full text-white transition-transform active:scale-95 disabled:opacity-40"
              style={{ background: VIOLET }}
            >
              {sending && !pendingQuick ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4 rtl:-scale-x-100" />
              )}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

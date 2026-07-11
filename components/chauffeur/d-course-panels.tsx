"use client";

import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Check,
  CheckCheck,
  Loader2,
  Send,
  Star,
  Zap,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  clearNavPref,
  getNavPref,
  NAV_APPS,
  openNav,
  setNavPref,
} from "@/lib/drive/nav";
import {
  GhostBtn,
  PrimaryBtn,
  Sheet,
  SheetTitle,
  ReportModal,
  GO,
  RED,
  VIOLET,
} from "@/components/customer/drive/drive-modals";
import { fmtPct } from "./d-ui";
import {
  getChauffeurLastDone,
  getChauffeurRideMessages,
  markChauffeurMessagesRead,
  rateClientAction,
  reportClientAction,
  sendChauffeurRideMessage,
  type B2BNext,
} from "@/app/(chauffeur)/actions";

/* ════════ Sélecteur d'application GPS (Google Maps / Waze / Plans) ════════ */

export function NavAppSheet({
  target,
  onClose,
}: {
  target: { lat: number; lng: number; label: string } | null;
  onClose: () => void;
}) {
  const [remember, setRemember] = useState(true);
  if (!target) return null;
  const pref = getNavPref();
  return (
    <Sheet open onClose={onClose}>
      <SheetTitle>Itinéraire vers {target.label}</SheetTitle>
      <p className="mb-3 text-[13px] text-[var(--d-muted)]">
        Choisissez votre application GPS — l&apos;itinéraire s&apos;ouvre
        directement.
      </p>
      <div className="space-y-2">
        {NAV_APPS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              if (remember) setNavPref(a.id);
              openNav(a.id, target.lat, target.lng);
              onClose();
            }}
            className="flex h-[52px] w-full items-center gap-3 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] px-4 text-[14px] font-bold"
          >
            <span className="text-xl">{a.emoji}</span> {a.label}
            <span className="ml-auto text-[var(--d-muted)]">›</span>
          </button>
        ))}
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-[var(--d-muted)]">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="size-4"
          style={{ accentColor: VIOLET }}
        />
        Se souvenir de mon choix
      </label>
      {pref && (
        <button
          type="button"
          onClick={() => {
            clearNavPref();
            onClose();
          }}
          className="mt-1 block w-full text-center text-[12px] font-bold"
          style={{ color: VIOLET }}
        >
          Réinitialiser l&apos;application par défaut
        </button>
      )}
      <GhostBtn onClick={onClose}>Annuler</GhostBtn>
    </Sheet>
  );
}

/* ════════ Chat chauffeur (messages rapides) ════════ */

type ChatRow = {
  id: string;
  sender: string;
  body: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
};

/** Accusé de lecture WhatsApp-like sous le message de l'utilisateur. */
function Receipt({ m, light }: { m: ChatRow; light?: boolean }) {
  const read = !!m.read_at;
  const delivered = !!m.delivered_at;
  const label = read ? "Lu" : delivered ? "Reçu" : "Envoyé";
  const color = read ? "#7CF0B2" : light ? "rgba(255,255,255,.8)" : "#9CA3AF";
  return (
    <span
      className="mt-0.5 flex items-center justify-end gap-0.5 text-[9.5px] font-semibold"
      style={{ color }}
    >
      {label}
      {delivered || read ? (
        <CheckCheck className="size-3" />
      ) : (
        <Check className="size-3" />
      )}
    </span>
  );
}

export function DChat({
  rideId,
  onClose,
}: {
  rideId: string;
  onClose: () => void;
}) {
  const [msgs, setMsgs] = useState<ChatRow[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const m = await getChauffeurRideMessages(rideId);
      if (stop) return;
      setMsgs(m);
      // Chat ouvert = je lis : marquer les messages du client comme lus.
      void markChauffeurMessagesRead(rideId, true);
    };
    void poll();
    // TEMPS RÉEL : nouveau message du client → instantané (`ride_messages` est
    // publiée Realtime). Le poll devient un FILET LENT (avant 3,5 s → 30 s) — on
    // ne martèle plus le serveur pour le chat.
    const supabase = createClient();
    const ch = supabase
      .channel(`ch-msg-${rideId}`)
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
    const id = setInterval(poll, 30000);
    return () => {
      stop = true;
      clearInterval(id);
      void supabase.removeChannel(ch);
    };
  }, [rideId]);

  const send = async (body: string) => {
    if (sending || !body.trim()) return;
    setSending(true);
    setPending(body);
    await sendChauffeurRideMessage(rideId, body);
    setMsgs(await getChauffeurRideMessages(rideId));
    setText("");
    setPending(null);
    setSending(false);
  };

  return (
    <Sheet open onClose={onClose}>
      <SheetTitle>Messages</SheetTitle>
      <p className="mb-2 text-[12px] text-[var(--d-muted)]">
        Messages rapides · numéros masqués
      </p>
      <div className="mb-2 max-h-[34vh] space-y-1.5 overflow-y-auto">
        {msgs.map((m) => {
          const mine = m.sender === "chauffeur";
          return (
            <div key={m.id} className={mine ? "ml-auto w-fit max-w-[80%]" : ""}>
              <div
                className="max-w-full rounded-[14px] px-3 py-2 text-[13px] font-medium"
                style={
                  mine
                    ? { background: VIOLET, color: "#fff" }
                    : { background: "var(--d-soft)" }
                }
              >
                {m.body}
              </div>
              {mine && <Receipt m={m} light />}
            </div>
          );
        })}
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {["J'arrive", "Je suis là", "Je suis garé devant", "2 minutes"].map(
          (q) => (
            <button
              key={q}
              type="button"
              disabled={sending}
              onClick={() => void send(q)}
              className="flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-1.5 text-xs font-bold disabled:opacity-50"
            >
              {pending === q && <Loader2 className="size-3 animate-spin" />}
              {q}
            </button>
          )
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send(text)}
          placeholder="Écrire un message…"
          className="h-11 flex-1 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 text-sm font-semibold outline-none"
        />
        <button
          type="button"
          disabled={sending || !text.trim()}
          onClick={() => void send(text)}
          className="grid size-11 shrink-0 place-items-center rounded-[14px] text-white disabled:opacity-40"
          style={{ background: VIOLET }}
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </div>
      <GhostBtn onClick={onClose}>Fermer</GhostBtn>
    </Sheet>
  );
}

/* ════════ Fin de course (s-ddone) ════════ */

export function DoneScreen({
  done,
  queued,
  onChainQueued,
  onRequests,
  onHome,
}: {
  done: NonNullable<Awaited<ReturnType<typeof getChauffeurLastDone>>>;
  queued: B2BNext | null;
  onChainQueued: () => Promise<void>;
  onRequests: () => void;
  onHome: () => void;
}) {
  const [rating, setRating] = useState(done.my_rating ?? 0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState<string | null>(null);
  const pct = done.commission_rate != null ? fmtPct(done.commission_rate) : "—";

  return (
    <div className="drive-jakarta drive-screen overflow-y-auto bg-[var(--d-surface)] px-5 pt-8 pb-8">
      <div className="mb-3 text-center">
        <span
          className="mx-auto mb-2.5 grid size-16 place-items-center rounded-full"
          style={{ background: "rgba(22,179,100,.12)" }}
        >
          <Check className="size-7" style={{ color: GO }} />
        </span>
        <h1 className="drive-sora text-[21px] font-extrabold">
          Course terminée
        </h1>
        <p className="text-[13px] text-[var(--d-muted)]">
          {done.pickup_text ?? "—"} → {done.dest_text ?? "—"}
        </p>
      </div>

      <div className="mb-3 rounded-[18px] border border-[var(--d-line)] p-4">
        <div className="flex items-center justify-between py-2 text-[13.5px]">
          <span className="text-[var(--d-muted)]">Prix de la course</span>
          <span>{formatDA(done.price_da)}</span>
        </div>
        <div className="flex items-center justify-between py-2 text-[13.5px]">
          <span className="text-[var(--d-muted)]">
            Commission Coligo ({pct})
          </span>
          <span style={{ color: RED }}>−{formatDA(done.commission_da)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-[var(--d-line)] pt-3 text-sm font-bold">
          <span className="text-[var(--d-muted)]">Votre gain net</span>
          <span className="drive-sora text-lg" style={{ color: GO }}>
            {formatDA(done.net_da)}
          </span>
        </div>
      </div>

      <div
        className="mb-3 flex items-center gap-3 rounded-[16px] p-3"
        style={{ background: "rgba(22,179,100,.12)" }}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--d-surface)]">
          <BadgeCheck className="size-5" style={{ color: GO }} />
        </span>
        <span>
          <b className="block text-[13.5px]" style={{ color: GO }}>
            {done.payment_method === "cash"
              ? "Espèces encaissées auprès du client"
              : done.cash_due_da > 0
                ? `${formatDA(done.cash_due_da)} encaissés en espèces · ${formatDA(done.price_da - done.cash_due_da)} via Coligo Pay, crédités sur votre solde`
                : "Prépayée · encaissée par Coligo, créditée sur votre solde"}
          </b>
          {done.commission_da > 0 && (
            <span className="text-[11px] text-[var(--d-muted)]">
              Avec Premium (0 %), vous auriez gardé{" "}
              <b>{formatDA(done.price_da)}</b>
            </span>
          )}
        </span>
      </div>

      {queued && (
        <div
          className="mb-3 flex items-center gap-3 rounded-[16px] p-3"
          style={{ background: "var(--d-accent)" }}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--d-surface)]">
            <Zap className="size-4.5" style={{ color: VIOLET }} />
          </span>
          <span>
            <b className="block text-[13.5px]" style={{ color: VIOLET }}>
              Course suivante : {queued.customer_name} ·{" "}
              {queued.proposed_price_da + queued.boost_amount_da} DA
            </b>
            <span className="text-[11px] text-[var(--d-muted)]">
              À{" "}
              {`${(Math.round(queued.pickup_dist_km * 10) / 10).toString().replace(".", ",")} km`}{" "}
              · le client vous attend
            </span>
          </span>
        </div>
      )}

      {reported ? (
        <div
          className="mb-2 flex items-start gap-2 rounded-[13px] px-3 py-2.5 text-[11.5px] leading-relaxed font-semibold"
          style={{ background: "rgba(22,179,100,.12)", color: GO }}
        >
          <BadgeCheck className="mt-0.5 size-4 shrink-0" />
          Signalement transmis (« {reported} »). Examen sous 24 h — le client
          peut être suspendu. Vous serez informé de la décision.
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="mb-2 block w-full text-center text-[12.5px] font-bold"
          style={{ color: RED }}
        >
          Signaler un problème avec ce client
        </button>
      )}

      <p className="mb-1 text-center text-sm font-semibold">Notez le client</p>
      <div className="mb-3 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={async () => {
              setRating(n);
              await rateClientAction(done.id, n);
            }}
          >
            <Star
              className="size-8"
              style={{
                color: "#E8B53C",
                fill: n <= rating ? "#E8B53C" : "transparent",
              }}
            />
          </button>
        ))}
      </div>

      <PrimaryBtn onClick={queued ? () => void onChainQueued() : onRequests}>
        {queued
          ? `Enchaîner · aller chercher ${queued.customer_name}`
          : "Voir les demandes suivantes"}
      </PrimaryBtn>
      <GhostBtn onClick={onHome}>Retour à l&apos;accueil</GhostBtn>

      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        side="driver"
        onConfirm={async (reason) => {
          setReportOpen(false);
          await reportClientAction(done.id, reason);
          setReported(reason);
        }}
      />
    </div>
  );
}

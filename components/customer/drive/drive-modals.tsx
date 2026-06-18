"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Copy,
  Crosshair,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Send,
  Share2,
  Smartphone,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import {
  getRideMessages,
  markRideMessagesRead,
  sendRideMessage,
  sosDriveRide,
  type RideMessage,
} from "@/app/(customer)/drive/actions";

/* Couleurs maquette (PROMPT-drive §0) */
export const VIOLET = "#5B5BE6";
export const GO = "#16B364";
export const ROSE = "#EC4899";
export const RED = "#E5484D";

/** Copie dans le presse-papiers (repli execCommand pour les WebViews). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* ─────────────── Base : overlay + feuille montante (maquette .ov/.md) ─────────────── */

export function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <Portal>
      <div
        className="fixed inset-0 z-[130] flex items-end bg-[rgba(8,9,15,.45)]"
        onClick={onClose}
      >
        <div
          className="drive-up w-full rounded-t-[26px] bg-[var(--d-surface)] px-5 pt-[18px] pb-6"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}

export function SheetTitle({
  children,
  danger,
}: {
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <h2
      className="drive-sora mb-1 text-[18px] font-extrabold tracking-[-0.5px]"
      style={danger ? { color: RED } : undefined}
    >
      {children}
    </h2>
  );
}

export function GhostBtn({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-0.5 flex h-11 w-full items-center justify-center text-sm font-semibold"
      style={{ color: danger ? RED : "var(--d-muted)" }}
    >
      {children}
    </button>
  );
}

export function PrimaryBtn({
  onClick,
  children,
  disabled,
  color = VIOLET,
  className,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  color?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "drive-sora mt-2 flex h-[54px] w-full items-center justify-center gap-2 rounded-[17px] text-base font-bold text-white disabled:pointer-events-none disabled:opacity-40",
        className
      )}
      style={{ background: color, boxShadow: `0 14px 28px -12px ${color}` }}
    >
      {children}
    </button>
  );
}

/* ─────────────── Annulation (modale commune, motifs contextuels) ─────────────── */

export type CancelCtx =
  | "client_search"
  | "client_enroute"
  | "driver_match"
  | "driver_pickup";

export function CancelModal({
  open,
  ctx,
  onClose,
  onConfirm,
}: {
  open: boolean;
  ctx: CancelCtx;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations("drive.cancel");
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (open) setSel(null);
  }, [open]);
  const reasons: string[] = t.raw(`${ctx}.reasons`) as string[];
  const warn = ctx === "client_search" ? null : t(`${ctx}.warn`);
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetTitle>{t(`${ctx}.title`)}</SheetTitle>
      {warn && (
        <div
          className="my-2.5 flex items-start gap-2 rounded-[13px] px-3 py-2.5 text-[11.5px] leading-snug font-semibold"
          style={{ background: "rgba(229,72,77,.1)", color: RED }}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {warn}
        </div>
      )}
      <div>
        {reasons.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setSel(r)}
            className="flex w-full items-center gap-3 border-b border-[var(--d-line)] px-1 py-3 text-left text-[13.5px] font-semibold last:border-b-0"
            style={sel === r ? { color: VIOLET } : undefined}
          >
            <span
              className="grid size-5 shrink-0 place-items-center rounded-full border-2"
              style={{ borderColor: sel === r ? VIOLET : "var(--d-line)" }}
            >
              {sel === r && (
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: VIOLET }}
                />
              )}
            </span>
            {r}
          </button>
        ))}
      </div>
      <PrimaryBtn
        color={RED}
        disabled={!sel}
        onClick={() => sel && onConfirm(sel)}
      >
        {t("confirm")}
      </PrimaryBtn>
      <GhostBtn onClick={onClose}>{t("keep")}</GhostBtn>
    </Sheet>
  );
}

/* ─────────────── SOS (les deux côtés) ─────────────── */

export type SosContact = { name: string; phone: string };

export function SOSModal({
  open,
  onClose,
  rideId,
  side,
  shareUrl,
  position,
  contacts = [],
  onManageContacts,
}: {
  open: boolean;
  onClose: () => void;
  rideId: string | null;
  side: "client" | "driver";
  shareUrl: string | null;
  position: { lat: number; lng: number } | null;
  /** Contacts d'urgence enregistrés (appel rapide + alerte SMS). */
  contacts?: SosContact[];
  /** Ouvre l'écran de gestion des contacts d'urgence. */
  onManageContacts?: () => void;
}) {
  const t = useTranslations("drive.sos");
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDone(null);
  }, [open]);

  const log = (kind: string) => {
    if (rideId)
      void sosDriveRide({
        rideId,
        kind,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
      });
  };
  // Position GPS jointe automatiquement (lien live + coordonnées brutes).
  const gps = position
    ? ` · GPS ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`
    : "";
  const alertContacts = () => {
    log("contacts");
    const txt = `${t("contactsMsg")} ${shareUrl ?? ""}${gps}`.trim();
    const nums = contacts.map((c) => c.phone.replace(/\s/g, "")).join(",");
    window.open(`sms:${nums}?body=${encodeURIComponent(txt)}`, "_self");
    setDone(t("contactsDone"));
  };

  const Item = ({
    icon,
    title,
    sub,
    red,
    onClick,
  }: {
    icon: React.ReactNode;
    title: string;
    sub: string;
    red?: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex w-full items-center gap-3 rounded-[15px] border-[1.5px] border-[var(--d-line)] p-3 text-left text-[13.5px] font-bold"
    >
      <span
        className="grid size-[38px] shrink-0 place-items-center rounded-[12px]"
        style={{
          background: red ? "rgba(229,72,77,.12)" : "#EEEEFD",
          color: red ? RED : VIOLET,
        }}
      >
        {icon}
      </span>
      <span>
        {title}
        <small className="mt-0.5 block text-[11px] font-medium text-[var(--d-muted)]">
          {sub}
        </small>
      </span>
    </button>
  );

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetTitle danger>{t("title")}</SheetTitle>
      <p className="mb-3 text-[13px] text-[var(--d-muted)]">{t("sub")}</p>
      <Item
        red
        icon={<Phone className="size-5" />}
        title={t("police")}
        sub={t("policeSub")}
        onClick={() => {
          log("police_17");
          window.open("tel:17", "_self");
        }}
      />
      {/* Appel RAPIDE de chaque contact d'urgence enregistré. */}
      {contacts.map((c) => (
        <Item
          key={c.phone}
          red
          icon={<Phone className="size-5" />}
          title={t("callContact", { name: c.name })}
          sub={c.phone}
          onClick={() => {
            log(`call_contact:${c.name}`);
            window.open(`tel:${c.phone.replace(/\s/g, "")}`, "_self");
          }}
        />
      ))}
      <Item
        icon={<Users className="size-5" />}
        title={t("contacts")}
        sub={
          contacts.length > 0
            ? contacts.map((c) => c.name).join(", ")
            : t("contactsSub")
        }
        onClick={alertContacts}
      />
      <Item
        icon={<MessageCircle className="size-5" />}
        title={t("support")}
        sub={t("supportSub")}
        onClick={() => {
          log("support");
          setDone(t("supportDone"));
        }}
      />
      {onManageContacts && (
        <button
          type="button"
          onClick={onManageContacts}
          className="mb-1.5 block w-full text-center text-[12px] font-bold"
          style={{ color: VIOLET }}
        >
          {t("manageContacts")}
        </button>
      )}
      {done ? (
        <p
          className="rounded-[13px] px-3 py-2.5 text-center text-xs font-bold"
          style={{ background: "rgba(22,179,100,.12)", color: GO }}
        >
          {done}
        </p>
      ) : (
        <p className="mt-1.5 text-center text-[11px] text-[var(--d-muted)]">
          {side === "driver" ? t("noteDriver") : t("noteClient")}
        </p>
      )}
      <GhostBtn onClick={onClose}>{t("close")}</GhostBtn>
    </Sheet>
  );
}

/* ─────────────── Partage de trajet ─────────────── */

export function ShareModal({
  open,
  onClose,
  shareUrl,
  chName,
  chRating,
  chCar,
  chPlate,
  emergencyContacts = [],
}: {
  open: boolean;
  onClose: () => void;
  shareUrl: string;
  chName: string;
  chRating: string | null;
  chCar: string | null;
  chPlate: string | null;
  /** Partage en un tap vers les contacts d'urgence enregistrés. */
  emergencyContacts?: SosContact[];
}) {
  const t = useTranslations("drive.share");
  const text = t("message", { name: chName, url: shareUrl });
  const [copied, setCopied] = useState(false);
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetTitle>{t("title")}</SheetTitle>
      <p className="mb-1 text-[13px] text-[var(--d-muted)]">{t("sub")}</p>
      <div className="my-3 rounded-[16px] bg-[var(--d-soft)] p-3.5">
        <div className="mb-2.5 flex items-center gap-3">
          <span
            className="drive-sora grid size-[42px] shrink-0 place-items-center rounded-full text-white"
            style={{ background: `linear-gradient(135deg,#7B7BF0,${VIOLET})` }}
          >
            {chName[0]?.toUpperCase()}
          </span>
          <span>
            <b className="block text-[13.5px]">
              {chName}
              {chRating ? ` · ★ ${chRating}` : ""}
            </b>
            <small className="text-[11px] text-[var(--d-muted)]">
              {[chCar, chPlate].filter(Boolean).join(" · ")}
            </small>
          </span>
        </div>
        <div className="overflow-hidden rounded-[11px] border border-dashed border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-2 font-mono text-[11px] whitespace-nowrap text-[var(--d-muted)]">
          {shareUrl.replace(/^https?:\/\//, "")} · {t("livePosition")}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="drive-sora flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] text-[13.5px] font-bold text-white"
          style={{ background: GO }}
          onClick={() =>
            window.open(
              `https://wa.me/?text=${encodeURIComponent(text)}`,
              "_blank"
            )
          }
        >
          <MessageCircle className="size-4" /> WhatsApp
        </button>
        <button
          type="button"
          className="drive-sora flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] bg-[var(--d-soft)] text-[13.5px] font-bold"
          onClick={() =>
            window.open(`sms:?body=${encodeURIComponent(text)}`, "_self")
          }
        >
          <Smartphone className="size-4" /> SMS
        </button>
      </div>
      {/* Copier le lien de suivi (partage libre : Telegram, e-mail…) */}
      <button
        type="button"
        className="drive-sora mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] text-[13.5px] font-bold"
        style={
          copied
            ? { borderColor: GO, color: GO }
            : { borderColor: "var(--d-line)" }
        }
        onClick={async () => {
          if (await copyText(shareUrl)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          }
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? t("copied") : t("copy")}
      </button>
      {/* Partage direct au CONTACT D'URGENCE enregistré (un tap). */}
      {emergencyContacts.length > 0 && (
        <button
          type="button"
          className="drive-sora mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] text-[13.5px] font-bold"
          style={{ borderColor: RED, color: RED }}
          onClick={() =>
            window.open(
              `sms:${emergencyContacts
                .map((c) => c.phone.replace(/\s/g, ""))
                .join(",")}?body=${encodeURIComponent(text)}`,
              "_self"
            )
          }
        >
          <Users className="size-4" />
          {t("toEmergency", {
            name: emergencyContacts.map((c) => c.name).join(", "),
          })}
        </button>
      )}
      <p className="mt-2 text-center text-[11px] text-[var(--d-muted)]">
        {t("note")}
      </p>
      <GhostBtn onClick={onClose}>{t("close")}</GhostBtn>
    </Sheet>
  );
}

/* ─────────────── Signalement (motifs précis, 2 côtés) ─────────────── */

export function ReportModal({
  open,
  onClose,
  side,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  side: "client" | "driver";
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations("drive.report");
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (open) setSel(null);
  }, [open]);
  const reasons = t.raw(
    side === "client" ? "clientReasons" : "driverReasons"
  ) as string[];
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetTitle>{t("title")}</SheetTitle>
      <p className="mb-1.5 text-[13px] text-[var(--d-muted)]">{t("sub")}</p>
      <div>
        {reasons.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setSel(r)}
            className="flex w-full items-center gap-3 border-b border-[var(--d-line)] px-1 py-3 text-left text-[13.5px] font-semibold last:border-b-0"
            style={sel === r ? { color: VIOLET } : undefined}
          >
            <span
              className="grid size-5 shrink-0 place-items-center rounded-full border-2"
              style={{ borderColor: sel === r ? VIOLET : "var(--d-line)" }}
            >
              {sel === r && (
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: VIOLET }}
                />
              )}
            </span>
            {r}
          </button>
        ))}
      </div>
      <PrimaryBtn
        color={RED}
        disabled={!sel}
        onClick={() => sel && onConfirm(sel)}
      >
        {t("send")}
      </PrimaryBtn>
      <GhostBtn onClick={onClose}>{t("cancelBtn")}</GhostBtn>
    </Sheet>
  );
}

/* ─────────────── Course pour un proche ─────────────── */

export function ProxModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string, phone: string) => void;
}) {
  const t = useTranslations("drive.prox");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetTitle>{t("title")}</SheetTitle>
      <p className="mb-2.5 text-[13px] text-[var(--d-muted)]">{t("sub")}</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("namePh")}
        className="mb-2 w-full rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]"
      />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        inputMode="tel"
        placeholder={t("phonePh")}
        className="mb-1 w-full rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]"
      />
      <p className="text-[11px] text-[var(--d-muted)]">{t("note")}</p>
      <PrimaryBtn
        disabled={!name.trim() || phone.trim().length < 9}
        onClick={() => onConfirm(name.trim(), phone.trim())}
      >
        {t("confirm")}
      </PrimaryBtn>
      <GhostBtn onClick={onClose}>{t("cancelBtn")}</GhostBtn>
    </Sheet>
  );
}

/* ─────────────── Point de départ (GPS / carte) ─────────────── */

export function DepModal({
  open,
  onClose,
  onGps,
  onMap,
}: {
  open: boolean;
  onClose: () => void;
  onGps: () => void;
  onMap: () => void;
}) {
  const t = useTranslations("drive.dep");
  return (
    <Sheet open={open} onClose={onClose}>
      <SheetTitle>{t("title")}</SheetTitle>
      <p className="mb-2.5 text-[13px] text-[var(--d-muted)]">{t("sub")}</p>
      <button
        type="button"
        onClick={onGps}
        className="mb-2 flex w-full items-center gap-3 rounded-[15px] border-[1.5px] border-[var(--d-line)] p-3 text-left text-[13.5px] font-bold"
      >
        <span
          className="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-[#EEEEFD]"
          style={{ color: VIOLET }}
        >
          <Crosshair className="size-5" />
        </span>
        <span>
          {t("gps")}
          <small className="mt-0.5 block text-[11px] font-medium text-[var(--d-muted)]">
            {t("gpsSub")}
          </small>
        </span>
      </button>
      <button
        type="button"
        onClick={onMap}
        className="mb-1 flex w-full items-center gap-3 rounded-[15px] border-[1.5px] border-[var(--d-line)] p-3 text-left text-[13.5px] font-bold"
      >
        <span
          className="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-[#EEEEFD]"
          style={{ color: VIOLET }}
        >
          <MapPin className="size-5" />
        </span>
        <span>
          {t("map")}
          <small className="mt-0.5 block text-[11px] font-medium text-[var(--d-muted)]">
            {t("mapSub")}
          </small>
        </span>
      </button>
      <GhostBtn onClick={onClose}>{t("close")}</GhostBtn>
    </Sheet>
  );
}

/* ─────────────── Messages rapides (client ↔ chauffeur) ─────────────── */

export function ChatModal({
  open,
  onClose,
  rideId,
  side,
}: {
  open: boolean;
  onClose: () => void;
  rideId: string;
  side: "customer" | "chauffeur";
}) {
  const t = useTranslations("drive.chat");
  const [msgs, setMsgs] = useState<RideMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    const poll = async () => {
      const m = await getRideMessages(rideId);
      if (stop) return;
      setMsgs(m);
      // Chat ouvert = je lis : marquer les messages reçus comme lus.
      void markRideMessagesRead(rideId, true);
    };
    void poll();
    const id = setInterval(poll, 3500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [open, rideId]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const quick = t.raw("quick") as string[];
  const send = async (body: string) => {
    if (sending || !body.trim()) return;
    setSending(true);
    setPending(body);
    const res = await sendRideMessage(rideId, body);
    if (res.ok) {
      setText("");
      setMsgs(await getRideMessages(rideId));
    }
    setPending(null);
    setSending(false);
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetTitle>{t("title")}</SheetTitle>
      <p className="mb-2 text-[12px] text-[var(--d-muted)]">{t("sub")}</p>
      <div className="mb-2 max-h-[34vh] space-y-1.5 overflow-y-auto">
        {msgs.map((m) => {
          const mine = m.sender === side;
          const read = !!m.read_at;
          const delivered = !!m.delivered_at;
          return (
            <div key={m.id} className={mine ? "ml-auto w-fit max-w-[80%]" : ""}>
              <div
                className={cn(
                  "max-w-full rounded-[14px] px-3 py-2 text-[13px] font-medium",
                  mine ? "text-white" : "bg-[var(--d-soft)]"
                )}
                style={mine ? { background: VIOLET } : undefined}
              >
                {m.body}
              </div>
              {mine && (
                <span
                  className="mt-0.5 flex items-center justify-end gap-0.5 text-[9.5px] font-semibold"
                  style={{
                    color: read ? "#16B364" : "var(--d-muted)",
                  }}
                >
                  {read ? t("read") : delivered ? t("delivered") : t("sent")}
                  {delivered || read ? (
                    <CheckCheck className="size-3" />
                  ) : (
                    <Check className="size-3" />
                  )}
                </span>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {quick.map((q) => (
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
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send(text)}
          placeholder={t("ph")}
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
      <GhostBtn onClick={onClose}>{t("close")}</GhostBtn>
    </Sheet>
  );
}

/* ─────────────── Petits éléments partagés ─────────────── */

export function ShareIcon() {
  return <Share2 className="size-4" />;
}

/* ─────────────── Contacts d'urgence : écran de gestion ─────────────── */

export function SosContactsSheet({
  open,
  onClose,
  contacts,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  contacts: SosContact[];
  /** Persistance (action serveur passée par le parent : client OU chauffeur). */
  onSave: (contacts: SosContact[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = useTranslations("drive.sosContacts");
  const [list, setList] = useState<SosContact[]>(contacts);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setList(contacts);
      setError(null);
    }
  }, [open, contacts]);

  const persist = async (next: SosContact[]) => {
    setSaving(true);
    setError(null);
    const res = await onSave(next);
    if (!res.ok) setError(res.error ?? t("error"));
    else setList(next);
    setSaving(false);
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetTitle>{t("title")}</SheetTitle>
      <p className="mb-2.5 text-[13px] text-[var(--d-muted)]">{t("sub")}</p>

      {list.map((c) => (
        <div
          key={c.phone}
          className="mb-2 flex items-center gap-3 rounded-[15px] border-[1.5px] border-[var(--d-line)] p-3"
        >
          <span className="min-w-0 flex-1">
            <b className="block text-[13.5px]">{c.name}</b>
            <small className="text-[11px] text-[var(--d-muted)] tabular-nums">
              {c.phone}
            </small>
          </span>
          {/* Bouton RAPIDE d'appel */}
          <a
            href={`tel:${c.phone.replace(/\s/g, "")}`}
            aria-label={t("call")}
            className="grid size-9 shrink-0 place-items-center rounded-full text-white"
            style={{ background: GO }}
          >
            <Phone className="size-4" />
          </a>
          <button
            type="button"
            aria-label={t("remove")}
            onClick={() =>
              void persist(list.filter((x) => x.phone !== c.phone))
            }
            disabled={saving}
            className="grid size-9 shrink-0 place-items-center rounded-full border-[1.5px]"
            style={{ borderColor: RED, color: RED }}
          >
            ✕
          </button>
        </div>
      ))}
      {list.length === 0 && (
        <p className="mb-2 rounded-[13px] bg-[var(--d-soft)] px-3 py-2.5 text-center text-xs font-semibold text-[var(--d-muted)]">
          {t("empty")}
        </p>
      )}

      {list.length < 3 && (
        <div className="mt-1 mb-1 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePh")}
            className="h-11 min-w-0 flex-1 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3 text-sm font-semibold outline-none"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder={t("phonePh")}
            className="h-11 min-w-0 flex-1 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3 text-sm font-semibold outline-none"
          />
          <button
            type="button"
            disabled={saving || !name.trim() || phone.trim().length < 9}
            onClick={async () => {
              await persist([
                ...list,
                { name: name.trim(), phone: phone.trim() },
              ]);
              setName("");
              setPhone("");
            }}
            className="grid size-11 shrink-0 place-items-center rounded-[14px] text-xl font-bold text-white disabled:opacity-40"
            style={{ background: VIOLET }}
          >
            +
          </button>
        </div>
      )}
      {error && (
        <p className="text-center text-xs font-bold" style={{ color: RED }}>
          {error}
        </p>
      )}
      <GhostBtn onClick={onClose}>{t("close")}</GhostBtn>
    </Sheet>
  );
}

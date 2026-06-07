"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bike, ChevronRight, KeyRound, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { setGlobalAvailability } from "@/app/(driver)/actions";
import { ZoneDispatch } from "@/components/driver/home/zone-dispatch";
import {
  getDriverMode,
  setDriverMode,
  type DriverMode,
} from "@/lib/driver/mode";

type MerchantRow = {
  mdId: string;
  name: string;
  commune: string | null;
  pending: number;
};
type PendingLink = { id: string; name: string };

const ONLINE_SINCE_KEY = "coligo_driver_online_since";

const nf = new Intl.NumberFormat("fr-FR");

/**
 * Bottom sheet de l'accueil livreur (style Uber, glissable).
 *
 * Quand le sheet est REPLIÉ, la zone visible (peek) montre l'essentiel pour
 * agir et motiver : le GAIN du jour + le bouton EN LIGNE / HORS LIGNE + le
 * sélecteur de mode (Tout / Express / Tournée). Le « Bonjour {prénom} » en
 * grand a été retiré (peu utile, distrayant). Le reste (stats détaillées,
 * commerçants…) se déplie en glissant vers le haut.
 *
 * Le mode est une préférence locale (localStorage) qui aide à basculer
 * facilement ; il ne change pas l'attribution serveur, seulement l'auto-pull
 * Express côté client (cf. lib/driver/mode + express-card).
 */
export function DriverHomeSheet({
  firstName,
  coursesToday,
  earnedToday,
  initialOnline,
  merchants,
  pending,
  blocked,
  bottomOffset = 0,
}: {
  firstName: string;
  coursesToday: number;
  earnedToday: number;
  initialOnline: boolean;
  merchants: MerchantRow[];
  pending: PendingLink[];
  blocked: PendingLink[];
  /** Décalage bas (px) pour laisser place à la nav livreur. */
  bottomOffset?: number;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [online, setOnline] = useState(initialOnline);
  const [onlineLabel, setOnlineLabel] = useState("0h00");
  const [mode, setMode] = useState<DriverMode>("all");

  useEffect(() => setMode(getDriverMode()), []);
  const pickMode = (m: DriverMode) => {
    setMode(m);
    setDriverMode(m);
  };

  // --- Bottom sheet glissable -----------------------------------------------
  const sheetRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null); // zone fixe (peek)
  const drag = useRef<{ startY: number; startTy: number } | null>(null);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Course de glissement = hauteur du sheet - hauteur du peek (zone fixe).
  const maxOffset = () =>
    Math.max(
      0,
      (sheetRef.current?.offsetHeight ?? 460) -
        (topRef.current?.offsetHeight ?? 250)
    );

  const onHandleDown = (e: ReactPointerEvent) => {
    drag.current = { startY: e.clientY, startTy: ty };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const d = e.clientY - drag.current.startY;
    setTy(Math.min(maxOffset(), Math.max(0, drag.current.startTy + d)));
  };
  const onHandleUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setTy((cur) => (cur > maxOffset() * 0.4 ? maxOffset() : 0));
  };
  const toggleSheet = () => setTy((cur) => (cur > 4 ? 0 : maxOffset()));

  // Mesure de session « en ligne » (localStorage).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (online) {
      if (!localStorage.getItem(ONLINE_SINCE_KEY)) {
        localStorage.setItem(ONLINE_SINCE_KEY, String(Date.now()));
      }
    } else {
      localStorage.removeItem(ONLINE_SINCE_KEY);
    }
  }, [online]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tick = () => {
      const raw = localStorage.getItem(ONLINE_SINCE_KEY);
      if (!online || !raw) {
        setOnlineLabel("0h00");
        return;
      }
      const mins = Math.max(0, Math.floor((Date.now() - Number(raw)) / 60000));
      setOnlineLabel(
        `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`
      );
    };
    tick();
    const i = setInterval(tick, 30_000);
    return () => clearInterval(i);
  }, [online]);

  const toggle = () => {
    const next = !online;
    setOnline(next); // optimiste
    start(async () => {
      const r = await setGlobalAvailability(next ? "available" : "offline");
      if (!r.ok) {
        setOnline(!next);
        toast.error(r.error ?? "Erreur");
        return;
      }
      toast.success(next ? "Tu es en ligne ⚡" : "Tu es hors ligne");
      router.refresh();
    });
  };

  return (
    <div
      ref={sheetRef}
      className="absolute inset-x-0 bottom-0 z-[60] rounded-t-[20px] bg-white pb-[max(18px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,.1)]"
      style={{
        bottom: bottomOffset,
        transform: `translateY(${ty}px)`,
        transition: dragging ? "none" : "transform .25s ease",
      }}
    >
      {/* Dispatch par zone piloté par l'INTENTION « en ligne » du livreur (state
          local), pas par la dispo serveur : un livreur SANS lien commerçant peut
          ainsi recevoir les courses express proches (auto-rattachement côté RPC). */}
      <ZoneDispatch online={online} />
      {/* Poignée draggable */}
      <div
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        className="cursor-grab touch-none pt-2 active:cursor-grabbing"
      >
        <button
          type="button"
          onClick={toggleSheet}
          aria-label="Déplier ou replier"
          className="mx-auto block h-1.5 w-11 rounded-full bg-[#d8d8d8]"
        />
      </div>

      {/* ===== Peek (zone fixe toujours visible) : gain + toggle + mode ===== */}
      <div ref={topRef} className="px-5 pt-3">
        {/* Gain du jour — motivation. */}
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-[0.5px] text-[#757575] uppercase">
              Gagné aujourd&apos;hui
            </p>
            <p className="mt-0.5 text-[32px] leading-none font-black tracking-[-1px] text-[#5c5ce0]">
              {nf.format(earnedToday)}
              <span className="ml-1 text-[15px] font-bold text-[#757575]">
                DA
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[20px] leading-none font-extrabold text-[#0a0a0a]">
              {coursesToday}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-[#757575]">
              course{coursesToday > 1 ? "s" : ""} · {onlineLabel}
            </p>
          </div>
        </div>

        {/* Bouton EN LIGNE / HORS LIGNE (connexion / déconnexion au service). */}
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="flex w-full items-center justify-between rounded-[14px] bg-[#0a0a0a] px-[18px] py-4 text-left text-white disabled:opacity-80"
        >
          <span className="flex items-center gap-3">
            <span className="grid size-[38px] place-items-center rounded-[11px] bg-white/[0.12]">
              <Bike className="size-[18px]" />
            </span>
            <span>
              <span className="block text-[16px] font-extrabold">
                {online ? "Vous êtes en ligne" : "Vous êtes hors ligne"}
              </span>
              <span className="mt-px block text-[11px] font-medium opacity-70">
                {online
                  ? "Disponible pour livrer"
                  : "Touchez pour passer en ligne"}
              </span>
            </span>
          </span>
          {busy ? (
            <Loader2 className="size-5 animate-spin opacity-80" />
          ) : (
            <span
              className={
                "relative h-[26px] w-[46px] rounded-full transition-colors " +
                (online ? "bg-[#00a86b]" : "bg-white/25")
              }
            >
              <span
                className={
                  "absolute top-[3px] size-5 rounded-full bg-white transition-all " +
                  (online ? "right-[3px]" : "left-[3px]")
                }
              />
            </span>
          )}
        </button>

        {/* Sélecteur de mode : Tout / Express / Tournée. */}
        <div className="mt-2.5 flex gap-1.5 rounded-[12px] bg-[#f2f2f2] p-1">
          <ModeBtn active={mode === "all"} onClick={() => pickMode("all")}>
            Tout
          </ModeBtn>
          <ModeBtn
            active={mode === "express"}
            onClick={() => pickMode("express")}
          >
            ⚡ Express
          </ModeBtn>
          <ModeBtn active={mode === "tour"} onClick={() => pickMode("tour")}>
            📅 Tournée
          </ModeBtn>
        </div>
      </div>

      {/* ===== Zone dépliable (scroll) ===== */}
      <div className="mt-3 max-h-[42vh] overflow-y-auto overscroll-contain px-4">
        <p className="px-1 pb-2 text-[13px] font-medium text-[#757575]">
          Bonjour {firstName} — prêt pour la prochaine course.
        </p>

        {/* Liste des commerçants */}
        {merchants.length > 0 ? (
          <ul>
            {merchants.map((m) => (
              <li key={m.mdId} className="mb-2.5">
                <Link
                  href={`/driver/m/${m.mdId}`}
                  className="flex items-center gap-3 rounded-[12px] border border-[#eee] bg-white px-3.5 py-3"
                >
                  <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-[#f5f5f5] text-sm font-extrabold text-[#0a0a0a]">
                    {m.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-[#0a0a0a]">
                      {m.name}
                    </span>
                    <span className="text-xs font-medium text-[#757575]">
                      {m.commune ? `${m.commune} · ` : ""}
                      {m.pending > 0
                        ? `${m.pending} commande${m.pending > 1 ? "s" : ""} en attente`
                        : "0 commande en attente"}
                    </span>
                  </span>
                  {m.pending > 0 && (
                    <span className="grid size-6 place-items-center rounded-full bg-[#0a0a0a] text-xs font-bold text-white">
                      {m.pending}
                    </span>
                  )}
                  <ChevronRight className="size-[18px] text-[#9e9e9e]" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Link
            href="/driver/codes"
            className="flex items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-[#d8d8f0] bg-[#f4f4fb] px-4 py-3 text-sm font-bold text-[#4a48c0]"
          >
            <KeyRound className="size-4" />
            Rejoindre un commerçant (saisir un code)
          </Link>
        )}

        {/* Demandes en attente / accès retirés */}
        {(pending.length > 0 || blocked.length > 0) && (
          <div className="space-y-2 pt-3">
            {pending.map((l) => (
              <div
                key={l.id}
                className="rounded-[12px] border border-[#F5E0A1] bg-[#FFF8E5] px-3.5 py-2.5 text-xs font-medium text-[#8B6500]"
              >
                <b className="font-bold">{l.name}</b> · en attente de validation
                du commerçant.
              </div>
            ))}
            {blocked.map((l) => (
              <div
                key={l.id}
                className="rounded-[12px] border border-[#f5c6c2] bg-[#FFF3F2] px-3.5 py-2.5 text-xs font-medium text-[#B22A1F]"
              >
                <b className="font-bold">{l.name}</b> · accès retiré. Resoumets
                un code si tu en as un nouveau.
              </div>
            ))}
          </div>
        )}

        {merchants.length > 0 && (
          <div className="pt-2.5">
            <Link
              href="/driver/codes"
              className="flex items-center justify-center gap-2 rounded-[12px] border border-[#eee] bg-[#f5f5f5] px-4 py-2.5 text-sm font-bold text-[#0a0a0a]"
            >
              <KeyRound className="size-4" />
              Rejoindre un autre commerçant
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 rounded-[9px] py-2 text-xs font-bold transition-colors " +
        (active ? "bg-white text-[#0a0a0a] shadow-sm" : "text-[#757575]")
      }
    >
      {children}
    </button>
  );
}

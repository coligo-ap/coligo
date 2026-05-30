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
 * Bottom sheet de l'accueil livreur. Greeting + 3 stats + interrupteur « en
 * ligne » (bascule TOUS les commerçants actifs via `setGlobalAvailability`) +
 * liste des commerçants.
 *
 * Les « heures en ligne » n'ont pas de source backend fiable (la table
 * `driver_availability` ne trace pas le début de session). On mesure donc la
 * session courante côté client via localStorage : démarrée quand on passe en
 * ligne, effacée quand on se met hors ligne. Affichage purement indicatif.
 */
export function DriverHomeSheet({
  firstName,
  coursesToday,
  earnedToday,
  initialOnline,
  merchants,
  pending,
  blocked,
}: {
  firstName: string;
  coursesToday: number;
  earnedToday: number;
  initialOnline: boolean;
  merchants: MerchantRow[];
  pending: PendingLink[];
  blocked: PendingLink[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [online, setOnline] = useState(initialOnline);
  const [onlineLabel, setOnlineLabel] = useState("0h00");

  // --- Bottom sheet glissable (déplier / replier) ---------------------------
  // On glisse le sheet vers le bas pour libérer la carte, vers le haut pour
  // tout revoir. `ty` = translation verticale en px ; 0 = déplié, maxOffset =
  // replié (on ne laisse dépasser que la poignée + le « Bonjour »).
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startTy: number } | null>(null);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const PEEK = 104; // hauteur visible quand replié (poignée + greeting).

  const maxOffset = () =>
    Math.max(0, (sheetRef.current?.offsetHeight ?? 420) - PEEK);

  const onHandleDown = (e: ReactPointerEvent) => {
    drag.current = { startY: e.clientY, startTy: ty };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    const d = e.clientY - drag.current.startY;
    const next = Math.min(maxOffset(), Math.max(0, drag.current.startTy + d));
    setTy(next);
  };
  const onHandleUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    // Snap : replié si on a dépassé 40 % de la course, sinon déplié.
    setTy((cur) => (cur > maxOffset() * 0.4 ? maxOffset() : 0));
  };
  const toggleSheet = () => setTy((cur) => (cur > 4 ? 0 : maxOffset()));

  // Démarre / arrête la mesure de session locale selon l'état en ligne.
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

  // Recalcule le libellé « En ligne » chaque minute.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tick = () => {
      const raw = localStorage.getItem(ONLINE_SINCE_KEY);
      if (!online || !raw) {
        setOnlineLabel("0h00");
        return;
      }
      const mins = Math.max(0, Math.floor((Date.now() - Number(raw)) / 60000));
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      setOnlineLabel(`${h}h${String(m).padStart(2, "0")}`);
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
        transform: `translateY(${ty}px)`,
        transition: dragging ? "none" : "transform .25s ease",
      }}
    >
      {/* Poignée draggable : grip + greeting (zone de saisie du glissement). */}
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
          className="mx-auto mb-3 block h-1.5 w-11 rounded-full bg-[#d8d8d8]"
        />
        <div className="px-5 pb-3">
          <h1 className="text-[24px] font-extrabold tracking-[-0.5px] text-[#0a0a0a]">
            Bonjour {firstName}
          </h1>
          <p className="mt-0.5 text-[13px] font-medium text-[#757575]">
            Prêt pour la prochaine course
          </p>
        </div>
      </div>

      <div className="max-h-[58vh] overflow-y-auto overscroll-contain">
        {/* 3 stats séparées par des fils verticaux */}
        <div className="flex border-b border-[#eee] px-5 pt-1.5 pb-3.5">
          <Stat value={String(coursesToday)} label="Courses" />
          <Stat value={nf.format(earnedToday)} unit="DA" label="Gagnés" sep />
          <Stat value={onlineLabel} label="En ligne" sep />
        </div>

        {/* Interrupteur en ligne (fond noir) */}
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="mx-4 mt-3.5 flex w-[calc(100%-32px)] items-center justify-between rounded-[14px] bg-[#0a0a0a] px-[18px] py-4 text-left text-white disabled:opacity-80"
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

        {/* Liste des commerçants */}
        {merchants.length > 0 ? (
          <ul className="px-4 pt-2">
            {merchants.map((m) => (
              <li key={m.mdId} className="mt-2.5">
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
          <div className="px-4 pt-3">
            <Link
              href="/driver/codes"
              className="flex items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-[#d8d8f0] bg-[#f4f4fb] px-4 py-3 text-sm font-bold text-[#4a48c0]"
            >
              <KeyRound className="size-4" />
              Rejoindre un commerçant (saisir un code)
            </Link>
          </div>
        )}

        {/* Demandes en attente / accès retirés (info fonctionnelle conservée) */}
        {(pending.length > 0 || blocked.length > 0) && (
          <div className="space-y-2 px-4 pt-3">
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
          <div className="px-4 pt-2.5">
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

function Stat({
  value,
  unit,
  label,
  sep,
}: {
  value: string;
  unit?: string;
  label: string;
  sep?: boolean;
}) {
  return (
    <div className={"flex-1 " + (sep ? "border-l border-[#eee] pl-3.5" : "")}>
      <div className="text-[20px] leading-[1.1] font-extrabold tracking-[-0.3px] text-[#0a0a0a]">
        {value}
        {unit && (
          <span className="ml-0.5 text-[11px] font-semibold text-[#757575]">
            {unit}
          </span>
        )}
      </div>
      <div className="mt-1 text-[11px] font-semibold text-[#757575]">
        {label}
      </div>
    </div>
  );
}

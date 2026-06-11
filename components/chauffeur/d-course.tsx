"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Copy,
  Loader2,
  MessageSquare,
  Send,
  Star,
  X,
  Zap,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { haversineKm } from "@/lib/delivery/distance";
import { DriveMap } from "@/components/customer/drive/drive-map";
import {
  CancelModal,
  copyText,
  GhostBtn,
  PrimaryBtn,
  Sheet,
  SheetTitle,
  SosContactsSheet,
  SOSModal,
  ReportModal,
  GO,
  RED,
  VIOLET,
  type SosContact,
} from "@/components/customer/drive/drive-modals";
import { fmtPct } from "./d-ui";
import {
  cancelRideAction,
  chauffeurHeartbeat,
  getChauffeurSosContacts,
  setChauffeurSosContacts,
  completeRideAction,
  getB2BNext,
  getChauffeurActiveRide,
  getChauffeurLastDone,
  getChauffeurRideMessages,
  offerRide,
  rateClientAction,
  reportClientAction,
  sendChauffeurRideMessage,
  setRideStatus,
  type B2BNext,
  type ChauffeurActiveRide,
} from "@/app/(chauffeur)/actions";

const fmtkm = (v: number) =>
  `${(Math.round(v * 10) / 10).toString().replace(".", ",")} km`;

/**
 * Course côté chauffeur (maquette s-dmatch → s-dpickup → s-dride → s-ddone) :
 * attribution, prise en charge (« je suis arrivé », règle 5 min client
 * absent), course (SOS, back-to-back 12 s, file de 1), fin (gain net,
 * upsell Premium, « Enchaîner », note client, signalement).
 */
export function DCourse() {
  const router = useRouter();
  const coords = useDriverPosition();
  const [ride, setRide] = useState<ChauffeurActiveRide | null>(null);
  const [booted, setBooted] = useState(false);
  const [matchSeen, setMatchSeen] = useState(false);
  const [done, setDone] =
    useState<Awaited<ReturnType<typeof getChauffeurLastDone>>>(null);
  const [cancelCtx, setCancelCtx] = useState<
    "driver_match" | "driver_pickup" | null
  >(null);
  const [sosOpen, setSosOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sosContacts, setSosContacts] = useState<SosContact[]>([]);
  const [contactsOpen, setContactsOpen] = useState(false);
  useEffect(() => {
    void getChauffeurSosContacts().then(setSosContacts);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endCode, setEndCode] = useState("");
  const [askCode, setAskCode] = useState(false);
  // Lien public de suivi t/{token} — copiable pour le partager librement.
  const [linkCopied, setLinkCopied] = useState(false);

  // Back-to-back
  const [nextOff, setNextOff] = useState<B2BNext | null>(null);
  const [nextCd, setNextCd] = useState(12);
  const [queued, setQueued] = useState<B2BNext | null>(null);
  const declined = useRef<Set<string>>(new Set());
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  const refresh = useCallback(async () => {
    const c = coordsRef.current;
    if (c) void chauffeurHeartbeat(c.latitude, c.longitude, true);
    const r = await getChauffeurActiveRide();
    setRide(r);
    setBooted(true);
    return r;
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [refresh]);

  // Back-to-back : proposition de course proche du POINT DE DÉPOSE (12 s).
  useEffect(() => {
    if (ride?.status !== "in_progress" || queued || nextOff) return;
    let stop = false;
    const find = async () => {
      const n = await getB2BNext(ride.id);
      if (stop || !n || declined.current.has(n.id)) return;
      setNextOff(n);
      setNextCd(12);
    };
    const id = setInterval(find, 15_000);
    const t = setTimeout(find, 2500);
    return () => {
      stop = true;
      clearInterval(id);
      clearTimeout(t);
    };
  }, [ride?.status, ride?.id, queued, nextOff]);
  useEffect(() => {
    if (!nextOff) return;
    if (nextCd <= 0) {
      declined.current.add(nextOff.id);
      setNextOff(null);
      return;
    }
    const t = setTimeout(() => setNextCd((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [nextOff, nextCd]);

  // Mig 0145 : le CODE PIN du client valide le DÉMARRAGE (courses en ligne,
  // séquestre) ; la complétion libère le séquestre sans code.
  const transition = async (
    status: "arriving" | "arrived" | "in_progress",
    pin?: string
  ) => {
    if (!ride || busy) return;
    if (status === "in_progress" && ride.prepaid && !pin) {
      setAskCode(true);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setRideStatus(ride.id, status, pin ?? null);
    if (!res.ok) {
      setError(
        res.error === "bad_pin"
          ? "Code PIN incorrect — demandez les 4 chiffres au client."
          : (res.error ?? "Action impossible")
      );
      setBusy(false);
      return;
    }
    if (status === "in_progress") setAskCode(false);
    await refresh();
    setBusy(false);
  };

  const complete = async () => {
    if (!ride || busy) return;
    setBusy(true);
    setError(null);
    const res = await completeRideAction(ride.id);
    if (!res.ok) {
      setError(res.error ?? "Impossible de terminer");
      setBusy(false);
      return;
    }
    const d = await getChauffeurLastDone();
    setDone(d);
    setRide(null);
    setBusy(false);
  };

  if (!booted) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--d-page)]">
        <Loader2 className="size-6 animate-spin" style={{ color: VIOLET }} />
      </div>
    );
  }

  /* ════════ FIN DE COURSE (s-ddone) ════════ */
  if (done) {
    return (
      <DoneScreen
        done={done}
        queued={queued}
        onChainQueued={async () => {
          if (!queued) return;
          await offerRide(
            queued.id,
            queued.proposed_price_da + queued.boost_amount_da
          );
          setQueued(null);
          setDone(null);
          router.replace("/chauffeur/demandes");
        }}
        onRequests={() => router.replace("/chauffeur/demandes")}
        onHome={() => router.replace("/chauffeur")}
      />
    );
  }

  if (!ride) {
    // Course annulée par le client pendant le flux → retour aux demandes.
    return (
      <div className="drive-jakarta drive-screen bg-[var(--d-surface)] px-5 pt-12">
        <div className="flex flex-col items-center text-center">
          <span
            className="mb-3 grid size-16 place-items-center rounded-full"
            style={{ background: "rgba(229,72,77,.1)" }}
          >
            <X className="size-7" style={{ color: RED }} />
          </span>
          <h1 className="drive-sora text-[21px] font-extrabold">
            Course annulée
          </h1>
          <p className="mt-1 max-w-[280px] text-[13px] text-[var(--d-muted)]">
            La course a été remise dans la liste des demandes. Aucun frais.
          </p>
        </div>
        <PrimaryBtn
          onClick={() => router.replace("/chauffeur/demandes")}
          className="mt-5"
        >
          Voir les autres demandes
        </PrimaryBtn>
      </div>
    );
  }

  const me = coords ? { lat: coords.latitude, lng: coords.longitude } : null;
  const shareUrl = ride.share_token
    ? `${typeof window !== "undefined" ? window.location.origin : "https://coligo.app"}/t/${ride.share_token}`
    : null;
  const pickup =
    ride.pickup_lat != null
      ? { lat: ride.pickup_lat, lng: ride.pickup_lng! }
      : null;
  const dest =
    ride.dest_lat != null ? { lat: ride.dest_lat, lng: ride.dest_lng! } : null;
  const pkKm = me && pickup ? haversineKm(me, pickup) : null;
  const pkMin = pkKm != null ? Math.max(2, Math.round(pkKm * 3)) : null;
  const rideMin =
    me && dest ? Math.max(1, Math.round(haversineKm(me, dest) * 2.2)) : null;

  /* ════════ ATTRIBUTION (s-dmatch) ════════ */
  if (ride.status === "accepted" && !matchSeen) {
    return (
      <div className="drive-jakarta drive-screen overflow-y-auto bg-[var(--d-surface)] px-5 pt-10 pb-8">
        <div className="text-center">
          <span
            className="mx-auto mb-3 grid size-16 place-items-center rounded-full"
            style={{ background: "rgba(22,179,100,.12)" }}
          >
            <Check className="size-7" style={{ color: GO }} />
          </span>
          <h1 className="drive-sora text-[21px] font-extrabold">
            {ride.customer_name} a accepté !
          </h1>
          <p className="text-[13px] text-[var(--d-muted)]">
            Course confirmée à <b>{formatDA(ride.agreed_price_da)}</b>
          </p>
        </div>
        <div className="mt-4 mb-2.5 flex flex-col gap-1.5 rounded-[12px] bg-[var(--d-soft)] px-3 py-2.5 text-[12.5px] font-semibold text-[var(--d-muted)]">
          <span className="flex items-center gap-2">
            <i
              className="size-[9px] shrink-0 rounded-full"
              style={{ background: VIOLET }}
            />
            Vous → client
            <b className="drive-sora ml-auto text-[var(--d-ink)]">
              {pkKm != null ? `${fmtkm(pkKm)} · ~${pkMin} min` : "…"}
            </b>
          </span>
          <span className="flex items-center gap-2">
            <i className="size-[9px] shrink-0 rounded-[2px] bg-[var(--d-ink)]" />
            Course
            <b className="drive-sora ml-auto text-[var(--d-ink)]">
              {fmtkm(ride.distance_km)} · ~
              {Math.max(4, Math.round(ride.distance_km * 2.2))} min
            </b>
          </span>
        </div>
        <p className="mb-4 text-xs font-semibold">
          {ride.pickup_text ?? "—"} → {ride.dest_text ?? "—"}
        </p>
        <PrimaryBtn
          onClick={async () => {
            setMatchSeen(true);
            await transition("arriving");
          }}
        >
          Démarrer · aller au client
        </PrimaryBtn>
        <GhostBtn onClick={() => setCancelCtx("driver_match")}>
          Annuler la course
        </GhostBtn>
        <CancelModal
          open={cancelCtx === "driver_match"}
          ctx="driver_match"
          onClose={() => setCancelCtx(null)}
          onConfirm={async (reason) => {
            setCancelCtx(null);
            await cancelRideAction(ride.id, reason);
            router.replace("/chauffeur/demandes");
          }}
        />
      </div>
    );
  }

  const inProgress = ride.status === "in_progress";

  /* ════════ PRISE EN CHARGE / COURSE (s-dpickup / s-dride) ════════ */
  return (
    <div className="drive-jakarta drive-screen bg-[var(--d-page)]">
      <DriveMap
        markers={[
          ...(me ? [{ id: "car", pos: me, kind: "car" as const }] : []),
          ...(pickup && !inProgress
            ? [{ id: "cli", pos: pickup, kind: "me" as const }]
            : []),
          ...(dest && inProgress
            ? [{ id: "dest", pos: dest, kind: "pin" as const }]
            : []),
        ]}
        approach={!inProgress && me && pickup ? [me, pickup] : null}
        route={inProgress && me && dest ? [me, dest] : null}
        padding={{ top: 90, bottom: 420, left: 60, right: 60 }}
      />
      <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--d-surface)] px-4 py-2 text-[13.5px] font-bold whitespace-nowrap shadow-lg">
        <span
          className="size-2 animate-pulse rounded-full"
          style={{ background: inProgress ? GO : VIOLET }}
        />
        <span className="drive-sora">
          {inProgress
            ? `Course en cours${rideMin != null ? ` · ${rideMin} min restantes` : ""}`
            : `Prise en charge · ${ride.customer_name}${pkMin != null ? ` à ${pkMin} min` : ""}`}
        </span>
      </div>

      {/* Back-to-back : course suivante près de la dépose (compteur 12 s) */}
      {inProgress && nextOff && (
        <div
          className="drive-up absolute top-16 right-2.5 left-2.5 z-30 overflow-hidden rounded-[20px] border-2 bg-[var(--d-surface)] shadow-xl"
          style={{ borderColor: VIOLET }}
        >
          <div
            className="drive-sora flex items-center gap-2 px-3.5 py-2 text-xs font-extrabold text-white"
            style={{ background: VIOLET }}
          >
            <Zap className="size-3.5" /> Course suivante près de votre dépose
            <span className="ml-auto">0:{String(nextCd).padStart(2, "0")}</span>
          </div>
          <div className="px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <span
                className="drive-sora grid size-[38px] shrink-0 place-items-center rounded-full font-extrabold text-white"
                style={{
                  background: `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
                }}
              >
                {nextOff.customer_name[0]?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[13.5px]">
                  {nextOff.customer_name}
                  {nextOff.customer_rating != null
                    ? ` · ★ ${String(nextOff.customer_rating).replace(".", ",")}`
                    : ""}
                </b>
                <span className="text-[11px] text-[var(--d-muted)]">
                  À {fmtkm(nextOff.pickup_dist_km)} de votre point de dépose ·
                  course {fmtkm(nextOff.distance_km)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <b className="drive-sora block text-lg">
                  {nextOff.proposed_price_da + nextOff.boost_amount_da} DA
                </b>
                <span className="text-[10px] text-[var(--d-muted)]">
                  prix client
                </span>
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--d-muted)]">
              {nextOff.pickup_text ?? "—"} → {nextOff.dest_text ?? "—"}
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                className="drive-sora h-[42px] flex-1 rounded-[12px] text-[13px] font-bold text-white"
                style={{ background: VIOLET }}
                onClick={() => {
                  setQueued(nextOff);
                  setNextOff(null);
                }}
              >
                Enchaîner
              </button>
              <button
                type="button"
                className="drive-sora h-[42px] flex-1 rounded-[12px] bg-[var(--d-soft)] text-[13px] font-bold text-[var(--d-muted)]"
                onClick={() => {
                  declined.current.add(nextOff.id);
                  setNextOff(null);
                }}
              >
                Non merci
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 max-h-[60vh] overflow-y-auto rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3.5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3.5 h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />

        {queued && (
          <div
            className="mb-2.5 flex items-center gap-2 rounded-[13px] px-3 py-2.5 text-[12.5px] font-bold"
            style={{ background: "#EEEEFD", color: VIOLET }}
          >
            <Check className="size-4 shrink-0" />
            Course suivante : {queued.customer_name} ·{" "}
            {queued.proposed_price_da + queued.boost_amount_da} DA
            <button
              type="button"
              className="ml-auto text-[11px] font-semibold text-[var(--d-muted)]"
              onClick={() => setQueued(null)}
            >
              Retirer
            </button>
          </div>
        )}

        {/* Fiche client */}
        <div className="mb-2.5 rounded-[22px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4 shadow-[0_14px_34px_-12px_rgba(20,22,40,.26)]">
          <div className="flex items-center gap-3">
            <span
              className="drive-sora grid size-[52px] shrink-0 place-items-center rounded-full text-xl font-extrabold text-white"
              style={{
                background: `linear-gradient(135deg,#7B7BF0,${VIOLET})`,
              }}
            >
              {ride.customer_name[0]?.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <b className="drive-sora block text-[17px] font-extrabold">
                {ride.customer_name}
              </b>
              <span className="mt-1 flex flex-wrap gap-1.5">
                {ride.customer_rating != null && (
                  <span className="rounded-full bg-[rgba(245,158,11,.16)] px-2.5 py-1 text-[11px] font-bold text-[#B45309]">
                    ★ {String(ride.customer_rating).replace(".", ",")}
                  </span>
                )}
                {ride.proxy_name && (
                  <span className="rounded-full bg-[var(--d-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--d-muted)]">
                    Pour un proche
                  </span>
                )}
              </span>
            </span>
          </div>
          <div className="mt-3 rounded-[13px] bg-[var(--d-soft)] px-3 py-2.5 text-[12.5px] font-bold">
            {inProgress
              ? `${ride.dest_text ?? "Destination"}`
              : `Vous attend · ${ride.pickup_text ?? "—"}`}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-[var(--d-soft)] text-[13.5px] font-bold"
            >
              <MessageSquare className="size-4" /> Message
            </button>
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[14px] text-[13.5px] font-bold text-white"
              style={{ background: VIOLET }}
            >
              <MessageSquare className="size-4" /> Contacter
            </button>
          </div>
        </div>

        <div
          className="mb-2.5 flex items-center justify-between rounded-[14px] px-4 py-3"
          style={{ background: "#EEEEFD" }}
        >
          <span className="text-xs font-bold" style={{ color: VIOLET }}>
            {inProgress
              ? ride.prepaid
                ? "Prépayée · rien à encaisser"
                : "À encaisser à l'arrivée"
              : "Prix convenu"}
          </span>
          <span
            className="drive-sora text-[17px] font-extrabold"
            style={{ color: VIOLET }}
          >
            {formatDA(ride.agreed_price_da)}
          </span>
        </div>

        {ride.prepaid && (
          <p
            className="mb-2.5 rounded-[13px] px-3 py-2.5 text-[12.5px] leading-relaxed font-bold"
            style={{ background: "rgba(22,179,100,.12)", color: GO }}
          >
            {inProgress ? (
              <>
                🔒 Course prépayée — montant en séquestre, versé sur votre solde
                à la fin de la course. Rien à encaisser.
              </>
            ) : (
              <>
                🔒 Course prépayée — à votre arrivée, demandez le{" "}
                <b>code PIN (4 chiffres)</b> au client : sa saisie démarre la
                course. Rien à encaisser.
              </>
            )}
          </p>
        )}

        {/* Partage du suivi : lien public t/{token}, copiable (sans compte) */}
        {shareUrl && (
          <button
            type="button"
            onClick={async () => {
              if (await copyText(shareUrl)) {
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2500);
              }
            }}
            className="mb-2.5 flex h-[46px] w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] text-[12.5px] font-bold"
            style={
              linkCopied
                ? { borderColor: GO, color: GO }
                : { borderColor: "var(--d-line)" }
            }
          >
            {linkCopied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {linkCopied
              ? "Lien copié ✓"
              : "Suivi de la course · copier le lien"}
          </button>
        )}

        {error && (
          <p
            className="mb-2 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
            style={{ background: "rgba(229,72,77,.1)", color: RED }}
          >
            {error}
          </p>
        )}

        {inProgress ? (
          <>
            <div className="mb-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-[12.5px] font-bold"
              >
                💬 Support live
              </button>
              <button
                type="button"
                onClick={() => setSosOpen(true)}
                className="flex h-[46px] w-[86px] items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] text-[12.5px] font-bold"
                style={{ borderColor: RED, color: RED }}
              >
                <AlertTriangle className="size-4" /> SOS
              </button>
            </div>
            <PrimaryBtn onClick={() => void complete()} disabled={busy}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : null}
              Terminer la course
            </PrimaryBtn>
          </>
        ) : (
          <>
            {ride.status !== "arrived" ? (
              <PrimaryBtn
                onClick={() => void transition("arrived")}
                disabled={busy}
              >
                Je suis arrivé · prévenir le client
              </PrimaryBtn>
            ) : (
              <p
                className="mb-1 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
                style={{ background: "rgba(22,179,100,.12)", color: GO }}
              >
                Le client est prévenu que vous êtes arrivé ✓
              </p>
            )}
            <PrimaryBtn
              onClick={() => void transition("in_progress")}
              disabled={busy}
            >
              Client à bord · démarrer la course
            </PrimaryBtn>
            <GhostBtn danger onClick={() => setCancelCtx("driver_pickup")}>
              Annuler · client absent
            </GhostBtn>
          </>
        )}
      </div>

      {/* Saisie du CODE PIN du client — DÉMARRE la course prépayée (séquestre
          maintenu jusqu'à la fin, mig 0145). */}
      <Sheet open={askCode} onClose={() => setAskCode(false)}>
        <SheetTitle>Code PIN du client</SheetTitle>
        <p className="mb-3 text-[13px] text-[var(--d-muted)]">
          À votre arrivée, demandez au client son <b>code PIN (4 chiffres)</b>.
          Sa validation démarre la course — le montant reste bloqué en séquestre
          et vous sera versé à la fin de la course.
        </p>
        <input
          value={endCode}
          onChange={(e) =>
            setEndCode(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          inputMode="numeric"
          placeholder="• • • •"
          className="drive-sora mb-1 w-full rounded-[14px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-center text-2xl font-extrabold tracking-[8px] outline-none"
        />
        {error && (
          <p className="text-center text-xs font-bold" style={{ color: RED }}>
            {error}
          </p>
        )}
        <PrimaryBtn
          disabled={endCode.length !== 4 || busy}
          onClick={() => void transition("in_progress", endCode)}
        >
          Valider le PIN · démarrer la course
        </PrimaryBtn>
        <GhostBtn onClick={() => setAskCode(false)}>Annuler</GhostBtn>
      </Sheet>

      <CancelModal
        open={cancelCtx === "driver_pickup"}
        ctx="driver_pickup"
        onClose={() => setCancelCtx(null)}
        onConfirm={async (reason) => {
          setCancelCtx(null);
          await cancelRideAction(ride.id, reason);
          router.replace("/chauffeur/demandes");
        }}
      />
      <SOSModal
        open={sosOpen}
        onClose={() => setSosOpen(false)}
        rideId={ride.id}
        side="driver"
        shareUrl={shareUrl}
        position={me}
        contacts={sosContacts}
        onManageContacts={() => {
          setSosOpen(false);
          setContactsOpen(true);
        }}
      />
      <SosContactsSheet
        open={contactsOpen}
        onClose={() => setContactsOpen(false)}
        contacts={sosContacts}
        onSave={async (next) => {
          const res = await setChauffeurSosContacts(next);
          if (res.ok) setSosContacts(next);
          return res;
        }}
      />
      {chatOpen && (
        <DChat rideId={ride.id} onClose={() => setChatOpen(false)} />
      )}
    </div>
  );
}

/* ════════ Chat chauffeur (messages rapides) ════════ */

function DChat({ rideId, onClose }: { rideId: string; onClose: () => void }) {
  const [msgs, setMsgs] = useState<
    { id: string; sender: string; body: string; created_at: string }[]
  >([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const m = await getChauffeurRideMessages(rideId);
      if (!stop) setMsgs(m);
    };
    void poll();
    const id = setInterval(poll, 3500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [rideId]);

  const send = async (body: string) => {
    if (sending || !body.trim()) return;
    setSending(true);
    await sendChauffeurRideMessage(rideId, body);
    setMsgs(await getChauffeurRideMessages(rideId));
    setText("");
    setSending(false);
  };

  return (
    <Sheet open onClose={onClose}>
      <SheetTitle>Messages</SheetTitle>
      <p className="mb-2 text-[12px] text-[var(--d-muted)]">
        Messages rapides · numéros masqués
      </p>
      <div className="mb-2 max-h-[34vh] space-y-1.5 overflow-y-auto">
        {msgs.map((m) => (
          <div
            key={m.id}
            className="max-w-[80%] rounded-[14px] px-3 py-2 text-[13px] font-medium"
            style={
              m.sender === "chauffeur"
                ? { marginLeft: "auto", background: VIOLET, color: "#fff" }
                : { background: "var(--d-soft)" }
            }
          >
            {m.body}
          </div>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {["J'arrive", "Je suis là", "Je suis garé devant", "2 minutes"].map(
          (q) => (
            <button
              key={q}
              type="button"
              onClick={() => void send(q)}
              className="rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-1.5 text-xs font-bold"
            >
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
          <Send className="size-4" />
        </button>
      </div>
      <GhostBtn onClick={onClose}>Fermer</GhostBtn>
    </Sheet>
  );
}

/* ════════ Fin de course (s-ddone) ════════ */

function DoneScreen({
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
          style={{ background: "#EEEEFD" }}
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

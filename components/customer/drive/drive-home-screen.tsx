"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  UsersRound,
  ArrowUpDown,
  Building2,
  Car,
  Clock,
  X,
  ContactRound,
  History,
  Pencil,
  Route,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { getPosition } from "@/lib/native/geolocation";
import { createClient } from "@/lib/supabase/client";
import { getHiddenDests, hideDest } from "@/lib/drive/hidden-suggestions";
import { reverseGeocode } from "@/app/(customer)/actions";
import {
  setSosContacts as saveSosContacts,
  type DriveContext,
} from "@/app/(customer)/drive/actions";
import type { DriveIntentDraft } from "@/app/(customer)/drive/ai-actions";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import type { LatLng } from "./drive-map";
import {
  DepModal,
  PrimaryBtn,
  SosContactsSheet,
  ROSE,
  VIOLET,
  type SosContact,
} from "./drive-modals";
import { WILAYA_CENTROIDS } from "@/lib/config/wilaya-centroids";
import { nearestWilayaCode } from "@/lib/drive/interwilaya";
import { wilayaName } from "@/components/shared/place-field";
import { CarpoolPanel } from "./carpool-view";
import { ZoneBlockNotice } from "./drive-ui";
import { DriveAiBar } from "./drive-ai-bar";
import { ThemeDecor } from "@/components/shared/theme-decor";
import type { Pt, Screen, TripMode } from "./drive-types";
import type { InterWilaya } from "@/lib/drive/interwilaya";

/**
 * Écran d'accueil Coligo Drive (choix du trajet) — extrait de `DriveView`.
 * Présentationnel pur : tout l'état (trajet, zone, contexte) et les handlers
 * qui alimentent le flux de demande vivent dans `DriveView` et sont passés en
 * props. Le composant ne détient AUCUNE logique de course.
 */
export function DriveHomeScreen({
  ctx,
  pickup,
  dest,
  zoneBlock,
  zoneJoined,
  // isDesktop / routePath : conservés dans le contrat (DriveView), plus
  // rendus ici depuis la suppression de la colonne carte desktop.
  isDesktop: _isDesktop,
  routePath: _routePath,
  aiConfirming,
  tripMode,
  setTripMode,
  inter,
  interFlag = null,
  carpoolOn = false,
  depOpen,
  contactsOpen,
  sosContacts,
  setPickup,
  setDest,
  setScreen,
  setMapPickFor,
  setAiConfirming,
  setDepOpen,
  setContactsOpen,
  setSosContactsState,
  swapPoints,
  joinDriveWaitlist,
  applyAiDraft,
}: {
  ctx: DriveContext;
  pickup: Pt | null;
  dest: Pt | null;
  zoneBlock: string | null;
  zoneJoined: boolean;
  isDesktop: boolean;
  /** Tracé routier RÉEL (OSRM) du trajet A→B — jamais une ligne droite. */
  routePath: LatLng[] | null;
  aiConfirming: boolean;
  /** Onglet Ville ⇄ Inter-wilayas (swipe ou tap sur la feuille trajet). */
  tripMode: TripMode;
  setTripMode: Dispatch<SetStateAction<TripMode>>;
  /** Trajet courant détecté inter-wilayas (badge « Alger → Béjaïa »). */
  inter: InterWilaya | null;
  /** Kill-switch inter-wilayas (super-admin) : hidden = onglet retiré ;
   *  coming_soon/maintenance = onglet grisé + demande inter bloquée. */
  interFlag?: {
    status: "active" | "hidden" | "coming_soon" | "maintenance";
    message_fr: string | null;
    message_ar: string | null;
  } | null;
  /** Covoiturage par places disponible (flag drive_carpool actif) → carte CTA
   *  sur l'onglet inter. */
  carpoolOn?: boolean;
  depOpen: boolean;
  contactsOpen: boolean;
  sosContacts: SosContact[];
  setPickup: Dispatch<SetStateAction<Pt | null>>;
  setDest: Dispatch<SetStateAction<Pt | null>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setMapPickFor: Dispatch<SetStateAction<"dep" | "dest">>;
  setAiConfirming: Dispatch<SetStateAction<boolean>>;
  setDepOpen: Dispatch<SetStateAction<boolean>>;
  setContactsOpen: Dispatch<SetStateAction<boolean>>;
  setSosContactsState: Dispatch<SetStateAction<SosContact[]>>;
  swapPoints: () => void;
  joinDriveWaitlist: () => void;
  applyAiDraft: (d: DriveIntentDraft) => void;
}) {
  const t = useTranslations("drive");
  const isAr = useLocale() === "ar";
  const router = useRouter();

  // ── Suggestions de destination masquées (par compte) ────────────────────
  // L'historique de courses reste intact : on masque seulement la LIGNE. Le
  // serveur remonte 6 destinations, l'écran en montre 3 après filtrage — ce
  // qui fait qu'écarter une suggestion en révèle une autre.
  const [uid, setUid] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void createClient()
      .auth.getSession()
      .then(({ data }) => {
        const id = data.session?.user.id ?? null;
        if (!alive) return;
        setUid(id);
        setHidden(getHiddenDests(id));
      });
    return () => {
      alive = false;
    };
  }, []);
  const visibleRecents = ctx.recents
    .filter((r) => !hidden.includes(r.text))
    .slice(0, 3);
  const hideRecent = (text: string) => {
    hideDest(uid, text);
    setHidden((h) => (h.includes(text) ? h : [text, ...h]));
  };

  // ── Disponibilité inter-wilayas (kill-switch super-admin, 0442) ─────────
  // hidden = onglet RETIRÉ ; coming_soon/maintenance = onglet grisé (« Bientôt »
  // / « Suspendu ») ; et si un trajet inter est DÉTECTÉ malgré tout (détection
  // automatique quel que soit l'onglet), la demande est bloquée avec un
  // message clair — l'enforcement réel restant le trigger DB.
  const interHidden = interFlag?.status === "hidden";
  const canInter = !interFlag || interFlag.status === "active";
  // Wilaya du départ (référentiel local) — exclue des destinations populaires.
  const pickupWilaya = pickup
    ? nearestWilayaCode(pickup.lat, pickup.lng)
    : null;
  const interBlockMsg =
    interFlag && interFlag.status !== "active" && inter
      ? ((isAr
          ? interFlag.message_ar || interFlag.message_fr
          : interFlag.message_fr) ?? t("mode.interBlocked"))
      : null;

  // Panneau covoiturage : monté à la 1ʳᵉ activation, puis conservé (hidden).
  const [covoitSeen, setCovoitSeen] = useState(false);
  useEffect(() => {
    if (tripMode === "covoit") setCovoitSeen(true);
  }, [tripMode]);

  // Swipe horizontal sur la feuille trajet → cycle Ville ⇄ Inter ⇄ Covoit
  // (les onglets restent tapables ; le swipe est un bonus de confort).
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onSheetTouchStart = (e: React.TouchEvent) => {
    const t0 = e.touches[0];
    touchStart.current = { x: t0.clientX, y: t0.clientY };
  };
  const onSheetTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t1 = e.changedTouches[0];
    const dx = t1.clientX - s.x;
    const dy = t1.clientY - s.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // Direction logique : balayer vers l'onglet suivant (miroir en RTL).
    const forward = isAr ? dx > 0 : dx < 0;
    const order: TripMode[] = [
      "ville",
      ...(canInter ? (["inter"] as TripMode[]) : []),
      ...(carpoolOn ? (["covoit"] as TripMode[]) : []),
    ];
    const idx = Math.max(0, order.indexOf(tripMode));
    const next =
      order[Math.min(order.length - 1, Math.max(0, idx + (forward ? 1 : -1)))];
    setTripMode(next);
  };

  return (
    <div className="drive-jakarta drive-screen z-40 flex min-h-[100dvh] flex-col bg-white">
      {/* HÉRO au thème « occasion » (vars posées sur <html>, mig 0415/0416) —
          MÊME langage que l'accueil marketplace / Compte / portefeuilles. PLUS
          DE CARTE EN FOND : l'écran s'ouvre instantanément, MapLibre n'est
          initialisé que sur les écrans choix-sur-carte / prix / course. */}
      <div
        className="relative overflow-hidden rounded-b-[28px] pb-14 text-white"
        style={{
          backgroundImage:
            "linear-gradient(140deg, var(--auth-g1,#6C2BD9) 0%, var(--auth-g2,#5B21B6) 55%, var(--auth-g3,#4C1B9B) 100%)",
        }}
      >
        <ThemeDecor />
        <header className="relative z-10 px-5 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2">
            <p className="drive-sora flex items-center gap-1.5 text-[13.5px] font-extrabold tracking-[0.5px] uppercase drop-shadow-sm">
              <Car className="size-[18px]" /> Coligo Drive
            </p>
            <div className="flex items-center gap-1.5">
              {/* <Link> PRÉFETCHÉ (règle « nav client ultra rapide ») : la route
                  + son loading.tsx sont déjà en cache au tap → écran instantané.
                  Un router.push sur onClick ne préfetche rien : premier tap =
                  aller-retour serveur complet, ressenti « le bouton bugue ». */}
              <Link
                href="/drive/historique"
                prefetch
                className="flex min-h-[36px] items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold text-white"
              >
                <History className="size-3.5" /> {t("history")}
              </Link>
              {/* Contacts d'urgence : pilule « personne + SOS » (le bouclier
                  seul n'était pas compris comme « ajouter mes proches »).
                  « SOS » = même mot en fr/ar/en, aucune traduction requise. */}
              <button
                type="button"
                onClick={() => setContactsOpen(true)}
                aria-label={t("sosContacts.title")}
                className="flex min-h-[36px] items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold text-white"
              >
                <ContactRound className="size-3.5" /> SOS
              </button>
            </div>
          </div>
        </header>
        <div className="relative z-10 mx-auto w-full max-w-6xl px-5">
          <h1 className="drive-sora mt-3 text-[27px] leading-tight font-extrabold tracking-[-0.6px] drop-shadow-sm">
            {t("home.title")}
          </h1>
        </div>
      </div>

      {/* Contenu — CHEVAUCHE le bas du héro (feuille, signature du design).
          UNE colonne PLEINE LARGEUR : la carte des modes (Ville · Inter ·
          Covoit) occupe tout le cadre, quasi bord-à-bord (gouttière 10px),
          pour respirer sur toutes les tailles d'écran. */}
      <main className="relative z-10 -mt-10 flex-1 overflow-y-auto px-2.5 pb-24">
        <div className="mx-auto grid w-full gap-6">
          <div className="min-w-0">
            {/* Assistant IA : réserver en langage naturel (darija / ar / fr) —
                pilule FLOTTANTE sur le dégradé, écho de la recherche accueil.
                Interrupteur super-admin (Config Drive, mig 0420) : masquée si
                désactivée — les actions serveur refusent aussi (bypass-proof). */}
            {ctx.aiEnabled && (
              <div className="rounded-[12px]">
                <DriveAiBar
                  pickup={pickup ? { lat: pickup.lat, lng: pickup.lng } : null}
                  onResolved={applyAiDraft}
                  onConfirmingChange={setAiConfirming}
                />
              </div>
            )}

            {!aiConfirming && (
              <>
                {/* Carte formulaire de trajet (départ / arrivée). */}
                <div
                  className="mt-3 rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4"
                  onTouchStart={onSheetTouchStart}
                  onTouchEnd={onSheetTouchEnd}
                >
                  {/* Onglets Ville ⇄ Inter-wilayas (tap ou swipe) — façon
                      InDrive/Yassir : les longs trajets entre wilayas ont leur
                      espace, sans changer le flux (mêmes écrans, même offre). */}
                  {/* Onglet inter RETIRÉ si masqué par l'équipe Coligo ; grisé
                      (« Bientôt » / « Suspendu ») si coupé temporairement. */}
                  {!interHidden && (
                    <div className="mb-3 flex gap-[3px] rounded-[12px] bg-[var(--d-soft)] p-1">
                      {(
                        [
                          ["ville", Building2, t("mode.city")],
                          ["inter", Route, t("mode.inter")],
                        ] as const
                      ).map(([m, Icon, label]) => {
                        const locked = m === "inter" && !canInter;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              if (locked) return;
                              setTripMode(m);
                            }}
                            aria-pressed={tripMode === m}
                            aria-disabled={locked || undefined}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] p-2 text-[12.5px] font-bold transition-colors"
                            style={
                              tripMode === m
                                ? {
                                    background: "var(--d-surface)",
                                    color: VIOLET,
                                  }
                                : {
                                    color: "var(--d-muted)",
                                    ...(locked ? { opacity: 0.55 } : null),
                                  }
                            }
                          >
                            <Icon className="size-3.5" />
                            {label}
                            {locked && (
                              <span className="rounded-full bg-[var(--d-surface)] px-1.5 py-0.5 text-[9px] font-extrabold text-[var(--d-muted)]">
                                {interFlag?.status === "coming_soon"
                                  ? t("mode.soon")
                                  : t("mode.suspended")}
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {/* 3ᵉ MODE covoiturage : INLINE dans la même feuille
                          (zéro redirection — le panneau se rend dessous,
                          exactement comme « Ville »). */}
                      {carpoolOn && (
                        <button
                          type="button"
                          onClick={() => setTripMode("covoit")}
                          aria-pressed={tripMode === "covoit"}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] p-2 text-[12.5px] font-bold transition-colors"
                          style={
                            tripMode === "covoit"
                              ? {
                                  background: "var(--d-surface)",
                                  color: VIOLET,
                                }
                              : { color: "var(--d-muted)" }
                          }
                        >
                          <UsersRound className="size-3.5" />
                          {t("mode.seatCard")}
                        </button>
                      )}
                    </div>
                  )}
                  {/* Panneau covoiturage MONTÉ en continu après la 1ʳᵉ visite
                      (masqué en `hidden`) → recherche/billets conservés quand
                      on bascule d'onglet (règle « panneaux montés »). */}
                  {covoitSeen && (
                    <div className={tripMode === "covoit" ? "" : "hidden"}>
                      <CarpoolPanel embedded />
                    </div>
                  )}
                  {tripMode !== "covoit" && (
                    <>
                      {/* Onglet inter = COURSE PRIVÉE longue distance (le
                      covoiturage a son PROPRE onglet ci-dessus — accès direct,
                      plus de cartes intermédiaires). Bandeau slim d'explication. */}
                      {tripMode === "inter" && (
                        <div
                          className="mb-2.5 flex items-center gap-2.5 overflow-hidden rounded-[12px] px-3.5 py-2.5 text-white"
                          style={{
                            backgroundImage: `linear-gradient(120deg, ${VIOLET} 0%, #4B1FA6 70%, #8E2F86 100%)`,
                          }}
                        >
                          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-white/15">
                            <Route className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <b className="drive-sora block text-[12.5px] font-extrabold">
                              {t("mode.interTitle")}
                            </b>
                            <span className="block truncate text-[10.5px] font-medium text-white/80">
                              {t("mode.privateCardHint")}
                            </span>
                          </span>
                        </div>
                      )}
                      <div className="mb-2.5 flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => setDepOpen(true)}
                            className="flex w-full items-center gap-3 rounded-[12px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-left"
                          >
                            <span
                              className="size-3 shrink-0 rounded-full"
                              style={{ background: VIOLET }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[10.5px] font-semibold tracking-[0.3px] text-[var(--d-muted)] uppercase">
                                {t("departure")}
                              </span>
                              <span className="block truncate text-[14.5px] font-bold">
                                {pickup?.gps
                                  ? t("myPosition")
                                  : (pickup?.text ?? t("home.locating"))}
                              </span>
                              {/* Nom du lieu résolu (reverse geocode) : le client voit que
                    le départ correspond bien à l'endroit où il se trouve. */}
                              {pickup?.gps && (
                                <span className="block truncate text-[11.5px] font-medium text-[var(--d-muted)]">
                                  {pickup.text ?? t("home.locating")}
                                </span>
                              )}
                            </span>
                            {pickup?.gps && (
                              <span
                                className="flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-bold"
                                style={{
                                  background: "var(--d-accent)",
                                  color: VIOLET,
                                }}
                              >
                                GPS
                              </span>
                            )}
                          </button>

                          {/* Connecteur pointillé A→B (langage visuel Bolt). */}
                          <span
                            aria-hidden
                            className="ms-[19px] block h-3.5 w-0 border-s-2 border-dashed border-[var(--d-line)]"
                          />

                          <button
                            type="button"
                            onClick={() => {
                              setMapPickFor("dest");
                              setScreen("mappick");
                            }}
                            className="flex w-full items-center gap-3 rounded-[12px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-left"
                          >
                            <span className="size-3 shrink-0 rounded-[3px] bg-[var(--d-ink)]" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[10.5px] font-semibold tracking-[0.3px] text-[var(--d-muted)] uppercase">
                                {t("destination")}
                              </span>
                              <span
                                className={cn(
                                  "block truncate text-[14.5px] font-bold",
                                  !dest && "font-semibold text-[var(--d-muted)]"
                                )}
                              >
                                {dest?.text ??
                                  (tripMode === "inter"
                                    ? t("mode.whereToInter")
                                    : t("home.whereTo"))}
                              </span>
                            </span>
                            <Pencil className="size-4 shrink-0 text-[var(--d-muted)]" />
                          </button>
                        </div>
                        {/* Inverser départ ↔ arrivée */}
                        <button
                          type="button"
                          onClick={swapPoints}
                          disabled={!pickup && !dest}
                          aria-label={t("swap")}
                          title={t("swap")}
                          className="grid size-10 shrink-0 place-items-center rounded-[12px] border border-[var(--d-line)] bg-[var(--d-surface)] disabled:opacity-40"
                          style={{ color: VIOLET }}
                        >
                          <ArrowUpDown className="size-[18px]" />
                        </button>
                      </div>

                      {/* Destinations POPULAIRES (inter) : la wilaya en un tap —
                      le client précise ensuite s'il veut, ou continue direct. */}
                      {tripMode === "inter" && !dest && (
                        <div className="mb-2 flex items-center gap-1.5 overflow-x-auto">
                          <span className="shrink-0 text-[9.5px] font-bold tracking-wide text-[var(--d-muted)] uppercase">
                            {t("mode.popularDest")}
                          </span>
                          {["16", "31", "25", "19", "06", "15", "09", "23"]
                            .filter((c) => c !== pickupWilaya)
                            .slice(0, 6)
                            .map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => {
                                  const ct = WILAYA_CENTROIDS[c];
                                  if (ct)
                                    setDest({
                                      lat: ct.lat,
                                      lng: ct.lng,
                                      text: wilayaName(c, isAr),
                                    });
                                }}
                                className="drive-sora flex h-7 shrink-0 items-center rounded-full border border-[var(--d-line)] px-2.5 text-[10.5px] font-bold whitespace-nowrap text-[var(--d-muted)] active:bg-[var(--d-soft)]"
                              >
                                {wilayaName(c, isAr)}
                              </button>
                            ))}
                        </div>
                      )}

                      {/* Trajet inter-wilayas DÉTECTÉ (auto, quel que soit
                      l'onglet) : badge de confirmation « Alger → Béjaïa ». */}
                      {inter && (
                        <span
                          className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                          style={{
                            background: "rgba(108,43,217,.10)",
                            color: VIOLET,
                          }}
                        >
                          <Route className="size-3.5 shrink-0" />
                          <span className="truncate">
                            {t("mode.inter")} ·{" "}
                            {isAr ? inter.labelAr : inter.label}
                          </span>
                        </span>
                      )}
                      {/* Zone indisponible (commune/wilaya/rayon bloqués) : message clair +
            « Prévenez-moi » AVANT le choix du prix, et « Continuer » bloqué. */}
                      {pickup && dest && zoneBlock && (
                        <ZoneBlockNotice
                          message={zoneBlock}
                          joined={zoneJoined}
                          onJoin={joinDriveWaitlist}
                          className="mt-1 mb-1"
                        />
                      )}
                      {/* Trajet inter DÉTECTÉ mais service suspendu : on le dit
                      AVANT le choix du prix, et « Continuer » est bloqué. */}
                      {pickup && dest && !zoneBlock && interBlockMsg && (
                        <p
                          className="mt-1 mb-1 rounded-[12px] px-3 py-2.5 text-[12px] font-semibold"
                          style={{
                            background: "rgba(108,43,217,.08)",
                            color: VIOLET,
                          }}
                        >
                          {interBlockMsg}
                        </p>
                      )}
                      <PrimaryBtn
                        onClick={() => setScreen("price")}
                        disabled={
                          !pickup || !dest || !!zoneBlock || !!interBlockMsg
                        }
                        className="!mt-1"
                      >
                        {t("home.continue")}
                      </PrimaryBtn>
                    </>
                  )}
                </div>

                {/* Destinations récentes — masquables une par une : le client
                    écarte celles qui ne l'intéressent plus et la suivante de
                    son historique prend la place (le serveur en remonte 6).
                    Masquées en mode covoit (le panneau a ses propres listes). */}
                {tripMode !== "covoit" && (
                  <div className="mt-3">
                    {visibleRecents.map((r) => (
                      <div
                        key={r.text}
                        className="flex w-full items-center gap-3 border-b border-[var(--d-line)] px-0.5 py-2.5 text-left text-[13.5px] font-semibold last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setDest({ lat: r.lat, lng: r.lng, text: r.text })
                          }
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
                            <Clock className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {r.text}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => hideRecent(r.text)}
                          aria-label={t("home.hideSuggestion")}
                          title={t("home.hideSuggestion")}
                          className="grid size-8 shrink-0 place-items-center rounded-full text-[var(--d-muted)] transition-colors active:bg-[var(--d-soft)]"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                    {ctx.lastRide && (
                      <div className="flex w-full items-center gap-3 px-0.5 py-2.5 text-left text-[13.5px] font-semibold">
                        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
                          <Car className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {ctx.lastRide.dest_text ?? "—"}
                          </span>
                          <small className="block text-[11px] font-medium text-[var(--d-muted)]">
                            {[
                              ctx.lastRide.chauffeur_name,
                              ctx.lastRide.price_da
                                ? formatDA(ctx.lastRide.price_da)
                                : null,
                              ctx.lastRide.completed
                                ? t("status.completed")
                                : t("status.cancelled"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Espace chauffeur — entrée discrète, sans carte. */}
                <button
                  type="button"
                  onClick={() => router.push("/chauffeur")}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] py-3 text-[13.5px] font-bold"
                >
                  <Car className="size-4" style={{ color: VIOLET }} />
                  {t("home.imDriver")}
                </button>
              </>
            )}
          </div>

          {/* (Ancienne colonne carte desktop supprimée : le cadre Drive est
              désormais un conteneur unique élargi — la carte vit sur les
              écrans mappick/prix/course.) */}
        </div>
      </main>

      <CustomerBottomNav />
      <DepModal
        open={depOpen}
        onClose={() => setDepOpen(false)}
        onGps={async () => {
          setDepOpen(false);
          try {
            const p = await getPosition({
              enableHighAccuracy: true,
              timeout: 8_000,
              maximumAge: 30_000,
            });
            const r = await reverseGeocode({
              latitude: p.latitude,
              longitude: p.longitude,
              precise: true,
            });
            setPickup({
              lat: p.latitude,
              lng: p.longitude,
              text: r?.display ?? null,
              gps: true,
            });
          } catch {
            /* ignore */
          }
        }}
        onMap={() => {
          setDepOpen(false);
          setMapPickFor("dep");
          setScreen("mappick");
        }}
      />
      <SosContactsSheet
        open={contactsOpen}
        onClose={() => setContactsOpen(false)}
        contacts={sosContacts}
        onSave={async (next) => {
          const res = await saveSosContacts(next);
          if (res.ok) setSosContactsState(next);
          return res;
        }}
      />
    </div>
  );
}

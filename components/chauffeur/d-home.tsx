"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  Car,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Home,
  Loader2,
  LocateFixed,
  Pencil,
  Power,
  Radio,
  Wallet,
  X,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import {
  useDriverPosition,
  refreshDriverPosition,
} from "@/lib/native/use-driver-position";
import { reverseGeocode } from "@/lib/geo/geocode";
import { createClient } from "@/lib/supabase/client";
import { DriveMap, type LatLng } from "@/components/customer/drive/drive-map";
import { ChauffeurDarkPill } from "@/components/chauffeur/chauffeur-dark-pill";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { MapPositionPicker } from "@/components/shared/map-position-picker";
import {
  VIOLET,
  GO,
  RED,
  PrimaryBtn,
} from "@/components/customer/drive/drive-modals";
import { PlanIcon, PLAN_LABEL, fmtPct } from "./d-ui";
import { Portal } from "@/components/ui/portal";
import { DIncoming } from "./d-incoming";
import { ChauffeurWorkZoneSheet } from "./work-zone-sheet";
import { useSearchRadius } from "@/lib/chauffeur/work-zone";
import {
  setChauffeurOnlineLocal,
  useChauffeurOnline,
} from "@/lib/chauffeur/online-store";
import {
  useHomeDirOn,
  setHomeDirOn,
  getHomeDirOn,
} from "@/lib/chauffeur/home-dir-store";
import { isOpenDemande } from "@/lib/chauffeur/dispatch-filter";
import { usePageVisible } from "@/lib/realtime/use-page-visible";
import { setDispatchActive } from "@/lib/realtime/dispatch-presence";
import { ensureRealtimeAuth } from "@/lib/realtime/ensure-auth";
import { getMyWalletState } from "@/app/wallet/recharge-actions";
import {
  activateHomeDir,
  deactivateHomeDir,
  chauffeurHeartbeat,
  declineRide,
  getChauffeurTick,
  offerRide,
  setChauffeurHome,
  setChauffeurOnline,
  type ChauffeurGate,
  type DriveHome,
  type NearbyRide,
} from "@/app/(chauffeur)/actions";

const GAMME_LABEL: Record<string, string> = {
  classic: "Classic",
  confort: "Confort",
  moto: "Moto",
};
const GAMME_RECEIVES: Record<string, string> = {
  classic: "Classic",
  confort: "Classic + Confort",
  moto: "Moto",
};

// Cache module (SWR) : dernières données d'accueil (gains, heatmap, plan…). Au
// RETOUR sur l'accueil, elles s'affichent INSTANTANÉMENT (plus d'attente du
// tick) ; le rafraîchissement se fait en arrière-plan.
let lastDriveHomeCache: DriveHome | null = null;

/**
 * Accueil chauffeur (maquette v13 « accueil chauffeur ») : carte + heatmap,
 * bouton GO animé (mise en ligne), finance bar (gains du jour + solde), prefs
 * (domicile / zone), abonnement, et RÉCEPTION DES COURSES en ligne via une
 * carte de notification entrante (DIncoming) qui apparaît en haut de l'écran.
 */
export function DHome({ gate }: { gate: ChauffeurGate }) {
  const router = useRouter();
  // Espace chauffeur FR par défaut ; traduction AR de l'accueil (le HTML passe
  // déjà en RTL via la locale racine). `tr(fr, ar)` = mini-helper local.
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  // Durée « en ligne » + libellé d'offre, traduits (évite « min en ligne » /
  // « Gratuit » en dur quand l'app est en arabe).
  const fmtOnline = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h === 0
      ? `${m} ${tr("min en ligne", "د متصل")}`
      : `${h} ${tr("h", "س")} ${String(m).padStart(2, "0")} ${tr("en ligne", "متصل")}`;
  };
  const planLabel = (plan: "free" | "pro" | "premium") =>
    isAr
      ? { free: "مجاني", pro: "Pro", premium: "Premium" }[plan]
      : PLAN_LABEL[plan];
  const coords = useDriverPosition();
  // Initialisé depuis le cache module → affichage instantané au retour (SWR).
  const [home, setHome] = useState<DriveHome | null>(lastDriveHomeCache);
  // Accueil COMPACT : feuille réduite par défaut (le chauffeur l'ouvre au choix).
  const [mini, setMini] = useState(true);
  // État RÉACTIF partagé (Accueil ⇄ Demandes) — plus de lecture localStorage
  // au montage qui désynchronisait les écrans.
  const dirOn = useHomeDirOn();
  // Le SERVEUR est la source de vérité (gate.homeDirActive, mig 0245) : on aligne
  // le store client dessus au montage pour éviter toute dérive (et donc que le
  // push respecte exactement l'état affiché).
  useEffect(() => {
    if (gate.homeDirActive !== getHomeDirOn()) setHomeDirOn(gate.homeDirActive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Filtre « je rentre chez moi » PARTAGÉ avec la page Demandes (compteur =
  // liste). Domicile + tolérance viennent du gate (config admin).
  const homeFilter = useMemo(
    () => ({
      on: dirOn,
      homeLat: gate.homeLat,
      homeLng: gate.homeLng,
      tolerance: gate.homeDirToleranceDeg,
    }),
    [dirOn, gate.homeLat, gate.homeLng, gate.homeDirToleranceDeg]
  );
  const [dirMsg, setDirMsg] = useState<string | null>(null);
  const [homeAddr, setHomeAddr] = useState(gate.homeAddr);
  // Rayon « autour de moi » — dispatch toujours centré sur la position live.
  const [zoneOpen, setZoneOpen] = useState(false);
  // Domicile : popup carte (recherche + repère) — déclaré tôt car le sélecteur
  // de course entrante (plus bas) s'en sert comme garde (pas de popup si ouvert).
  const [homeOpen, setHomeOpen] = useState(false);
  const [homePos, setHomePos] = useState<LatLng | null>(null);
  const [homeSaving, setHomeSaving] = useState(false);
  const [homeErr, setHomeErr] = useState<string | null>(null);
  const searchRadius = useSearchRadius();
  const radiusRef = useRef(searchRadius);
  radiusRef.current = searchRadius;
  const coordsRef = useRef(coords);
  coordsRef.current = coords;

  // Solde portefeuille opérateur (finance bar) — rafraîchi périodiquement.
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const s = await getMyWalletState();
      if (active) setBalance(s?.effectiveBalanceDa ?? 0);
    };
    void load();
    const id = setInterval(load, 20_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // En ligne / hors ligne : intention partagée (store, clé coligo-drive-online),
  // lue À L'IDENTIQUE par la page Demandes → elle ne poll/écoute QUE si en ligne.
  const online = useChauffeurOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  // Hygiène connexions (quota Realtime Free PARTAGÉ) : on n'ouvre le canal de
  // dispatch QUE au premier plan ; en arrière-plan, le FCM réveille l'app.
  const visible = usePageVisible();

  // Bascule OPTIMISTE et NON BLOQUANTE : le switch reflète l'intention
  // INSTANTANÉMENT (store local réactif), et la synchro serveur part en
  // arrière-plan (le heartbeat entretient l'état). Avant, on `await` la Server
  // Action — sérialisée par Next et parfois lente → le bouton « restait » en
  // attente longtemps alors que l'état avait déjà changé.
  const toggleOnline = () => {
    const next = !onlineRef.current;
    setChauffeurOnlineLocal(next); // UI instantanée
    onlineRef.current = next;
    if (!next) {
      // Hors ligne : on coupe la réception (popup + file).
      setNearby([]);
      setCurrent(null);
    }
    // Synchro serveur en tâche de fond (best-effort).
    void setChauffeurOnline(next).catch(() => {});
    const c = coordsRef.current;
    if (c) void chauffeurHeartbeat(c.latitude, c.longitude, next);
  };

  // ── Réception des courses (popup entrant) ──────────────────────────────
  // DIAG temporaire (débogage réception) : état réel du dernier tick client.
  const [dbg, setDbg] = useState<string>("…");
  const [nearby, setNearby] = useState<NearbyRide[]>([]);
  const [current, setCurrent] = useState<NearbyRide | null>(null);
  const [incBusy, setIncBusy] = useState(false);
  // Demandes déjà vues dans le popup (refus / accept / fermeture / expiration) :
  // ne re-poppent plus, mais restent disponibles dans l'écran Drive.
  const seenRef = useRef<Set<string>>(new Set());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Anti-chevauchement : pas de nouveau tick si le précédent n'est pas fini
  // (sinon, sous contention, les Server Actions sérialisées s'empilent → lag).
  const tickBusy = useRef(false);

  // Présence (en ligne) + rafraîchissement accueil + détection course active +
  // récupération des demandes proches (pour le popup + le compteur).
  const tick = useCallback(async () => {
    if (tickBusy.current) return;
    const live = coordsRef.current;
    // Repli sur la dernière position connue côté serveur (présence, via le gate)
    // quand le GPS du navigateur n'a pas encore de fix → le compteur et le popup
    // se peuplent quand même (un chauffeur qui a reçu une push a une présence).
    const c =
      live ??
      (gate.presenceLat != null && gate.presenceLng != null
        ? { latitude: gate.presenceLat, longitude: gate.presenceLng }
        : null);
    tickBusy.current = true;
    try {
      // UN SEUL POST (consolidé) au lieu de 3 Server Actions sérialisées.
      const {
        home: h,
        activeRide: active,
        nearby: list,
        dbg: serverDbg,
      } = await getChauffeurTick(
        c?.latitude ?? null,
        c?.longitude ?? null,
        radiusRef.current
      );
      if (active) {
        router.replace("/chauffeur/course");
        return;
      }
      lastDriveHomeCache = h; // alimente le cache SWR
      setHome(h);
      setNearby(onlineRef.current ? list : []);
      // DIAG temporaire : état client + vérité serveur du chemin réel.
      setDbg(`on=${onlineRef.current ? 1 : 0} | ${serverDbg}`);
    } catch (e) {
      // Sans ce catch, une seule sous-requête en échec cassait SILENCIEUSEMENT
      // toute la réception (nearby jamais mis à jour). On le rend visible.
      setDbg(`ERR ${String((e as Error)?.message ?? e)}`.slice(0, 90));
    } finally {
      tickBusy.current = false;
    }
  }, [router]);
  useEffect(() => {
    void tick();
    // Le dispatch push (broadcast ciblé) fait l'instantané ; ce poll est le FILET
    // FIABLE (broadcast raté, WebSocket tombé, retour de veille). 15 s = réception
    // garantie même si le broadcast échoue (la réception NE DOIT JAMAIS dépendre
    // du seul broadcast). Coût maîtrisé : 1 requête/15 s/chauffeur (≠ l'ancien
    // abonnement global O(courses×chauffeurs) qu'on a supprimé).
    const id = setInterval(tick, 15_000);
    // RATTRAPAGE au retour au premier plan : un broadcast émis pendant que l'app
    // était en arrière-plan (WebSocket suspendu) a pu être manqué → on resynchro
    // une fois, immédiatement, plutôt que d'attendre le filet 45 s.
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tick]);

  // HEARTBEAT dédié (présence + position pour le dispatch serveur), DÉCOUPLÉ du
  // refresh de données lourd : cadence stable 30 s, un seul upsert léger. C'est
  // lui qui garde `is_online` + `updated_at` frais pour le KNN serveur (fenêtre
  // 60 s, mig 0253). N'écrit qu'avec un VRAI fix GPS (ne pas réécrire un repli).
  useEffect(() => {
    const beat = () => {
      const live = coordsRef.current;
      if (live)
        void chauffeurHeartbeat(
          live.latitude,
          live.longitude,
          onlineRef.current
        );
    };
    beat();
    const id = setInterval(beat, 30_000);
    return () => clearInterval(id);
  }, []);

  // Temps réel CIBLÉ (dispatch push) : on n'écoute plus TOUS les INSERT de
  // `rides` (canal global = O(courses × chauffeurs), insoutenable). On écoute
  // SON canal perso `chauffeur:{userId}` :
  //   • event "new_ride"  → le serveur nous a poussé une demande éligible →
  //     on rafraîchit (peuple popup + compteur) sans attendre le filet 45 s ;
  //   • la redirection « offre acceptée » reste sur ride_offers (ciblé par id).
  // GATÉ sur l'état en ligne.
  useEffect(() => {
    if (!online || !visible) return;
    // Dispatch in-app actif → le push FCM web ne doublera pas la notif (dédup).
    setDispatchActive("chauffeur", true);
    const supabase = createClient();
    const chans: ReturnType<typeof supabase.channel>[] = [];
    let cancelled = false;
    void (async () => {
      // Garantir le JWT sur le socket AVANT le canal PRIVÉ (sinon CHANNEL_ERROR
      // → broadcast jamais reçu). Le canal offres (postgres_changes) n'en a pas
      // besoin mais profite du même socket authentifié.
      await ensureRealtimeAuth(supabase);
      if (cancelled) return;
      chans.push(
        supabase
          .channel(`chauffeur:${gate.userId}`, { config: { private: true } })
          .on("broadcast", { event: "new_ride" }, () => void tick())
          .subscribe(),
        supabase
          .channel(`home-my-offers-${gate.id}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "ride_offers",
              filter: `chauffeur_id=eq.${gate.id}`,
            },
            (payload) => {
              if ((payload.new as { status?: string }).status === "accepted")
                router.replace("/chauffeur/course");
            }
          )
          .subscribe()
      );
    })();
    return () => {
      cancelled = true;
      setDispatchActive("chauffeur", false);
      for (const c of chans) void supabase.removeChannel(c);
    };
  }, [tick, online, visible, gate.id, gate.userId, router]);

  // Passage EN LIGNE (bouton GO) → interroger TOUT DE SUITE les demandes, sans
  // attendre le prochain cycle de poll (l'effet `tick` ci-dessus ne dépend pas
  // de `online` ; sans ça, aller en ligne laissait le compteur à 0 jusqu'au
  // poll suivant). Le broadcast couvre les courses créées APRÈS.
  useEffect(() => {
    if (online) void tick();
  }, [online, tick]);

  // Dès la 1re position GPS connue : recharger immédiatement (sans attendre 15 s).
  const gotFirstFix = useRef(false);
  useEffect(() => {
    if (coords && !gotFirstFix.current) {
      gotFirstFix.current = true;
      void tick();
    }
  }, [coords, tick]);

  // Sélection de la prochaine course à présenter dans le popup : la plus proche
  // non encore vue (et non déjà proposée par moi). Pas de popup si un volet est
  // ouvert (domicile / zone) ni hors ligne.
  useEffect(() => {
    if (current || !online || homeOpen || zoneOpen) return;
    // Même filtre que le compteur/la liste : on ne fait PAS surgir un popup pour
    // une course qui n'apparaîtra pas dans « Demandes » (déjà proposée ou hors
    // « je rentre chez moi »).
    const cand = nearby
      .filter((r) => !seenRef.current.has(r.id) && isOpenDemande(r, homeFilter))
      .sort((a, b) => a.pickup_dist_km - b.pickup_dist_km);
    if (cand.length) setCurrent(cand[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, online, nearby, zoneOpen, homeFilter]);

  // Auto-masquage du popup après 12 s : la course reste disponible dans Drive.
  useEffect(() => {
    if (!current) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      seenRef.current.add(current.id);
      setCurrent(null);
    }, 12_000);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [current]);

  const closeInc = () => {
    if (current) seenRef.current.add(current.id);
    setCurrent(null);
  };
  const refuseInc = async () => {
    if (!current || incBusy) return;
    const r = current;
    setIncBusy(true);
    seenRef.current.add(r.id);
    setNearby((l) => l.filter((x) => x.id !== r.id));
    setCurrent(null);
    await declineRide(r.id);
    setIncBusy(false);
  };
  const acceptInc = async () => {
    if (!current || incBusy) return;
    const r = current;
    const price = r.proposed_price_da + r.boost_amount_da;
    setIncBusy(true);
    seenRef.current.add(r.id);
    const res = await offerRide(r.id, price);
    // Offre envoyée : la course passe en « proposition » (visible dans Drive).
    // La redirection vers /course se fait quand le client accepte (temps réel).
    setNearby((l) =>
      l.map((x) => (x.id === r.id ? { ...x, my_offer_da: price } : x))
    );
    setCurrent(null);
    setIncBusy(false);
    if (!res.ok) setNearby((l) => l.filter((x) => x.id !== r.id));
  };
  const seeAllInc = () => {
    if (current) seenRef.current.add(current.id);
    setCurrent(null);
    router.push("/chauffeur/demandes");
  };

  // Domicile : enregistrement (le changement d'adresse est LIMITÉ côté serveur
  // — 1×/semaine, anti-fraude). États déclarés plus haut (garde du popup).
  const saveHome = async () => {
    if (!homePos || homeSaving) return;
    setHomeSaving(true);
    setHomeErr(null);
    // Adresse lisible du repère (échec silencieux → libellé générique).
    const text =
      (await reverseGeocode(homePos.lat, homePos.lng).catch(() => null)) ??
      "Domicile (repère carte)";
    const res = await setChauffeurHome(text, homePos);
    setHomeSaving(false);
    if (!res.ok) {
      setHomeErr(res.error ?? "Enregistrement impossible.");
      return;
    }
    setHomeAddr(text);
    setHomeOpen(false);
  };

  // Recentrage de la carte sur la position actuelle du chauffeur.
  const [focusMe, setFocusMe] = useState<(LatLng & { zoom?: number }) | null>(
    null
  );
  const [locating, setLocating] = useState(false);
  // Quand on réduit/agrandit la feuille, la zone visible change → on re-centre
  // le point « moi » avec le nouveau padding (sinon il resterait décalé).
  useEffect(() => {
    const c = coordsRef.current;
    if (c) setFocusMe({ lat: c.latitude, lng: c.longitude, zoom: 16.5 });
  }, [mini]);
  const recenter = async () => {
    // 1) Recentrage INSTANTANÉ sur la dernière position connue (si on en a une).
    const known = coordsRef.current;
    if (known)
      setFocusMe({ lat: known.latitude, lng: known.longitude, zoom: 16.5 });
    // 2) Puis on force un fix frais (alimente AUSSI le store → le repère « moi »
    //    apparaît même si le watch n'avait encore rien livré) et on s'y cale.
    setLocating(true);
    const fresh = await refreshDriverPosition();
    setLocating(false);
    if (fresh)
      setFocusMe({ lat: fresh.latitude, lng: fresh.longitude, zoom: 16.5 });
  };

  const toggleDir = async () => {
    setDirMsg(null);
    if (dirOn) {
      setHomeDirOn(false);
      void deactivateHomeDir(); // retire le flag serveur (cohérence push)
      return;
    }
    const res = await activateHomeDir();
    if (res.ok) {
      setHomeDirOn(true);
      if (res.remaining != null)
        setDirMsg(
          `Activé · ${res.remaining} activation(s) restante(s) aujourd'hui`
        );
    } else {
      setDirMsg(res.error ?? "Activation impossible");
    }
  };

  const me = coords ? { lat: coords.latitude, lng: coords.longitude } : null;
  // Demandes RÉELLEMENT visibles = mêmes filtres que la page « Demandes »
  // (pas déjà proposées + filtre « je rentre chez moi »). Le compteur de
  // l'Accueil DOIT égaler la liste → plus de « 5 sur l'accueil, 0 dans Drive ».
  const openDemandes = useMemo(
    () => nearby.filter((r) => isOpenDemande(r, homeFilter)),
    [nearby, homeFilter]
  );
  const reqCount = online ? openDemandes.length : 0;
  const queueCount = Math.max(
    0,
    openDemandes.filter((r) => !seenRef.current.has(r.id)).length - 1
  );
  const lowBalance = balance != null && balance < 0;

  return (
    <div className="drive-jakarta drive-screen bg-[var(--d-page)]">
      {/* DIAG temporaire (débogage réception) — à retirer une fois résolu. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[200] bg-black/80 px-2 py-1 text-center font-mono text-[10px] text-lime-300">
        DIAG {dbg}
      </div>
      <DriveMap
        markers={me ? [{ id: "me", pos: me, kind: "me" }] : []}
        heatZones={home?.heatZones ?? []}
        focusTarget={focusMe}
        follow
        // Conserve l'instance MapLibre entre les visites de l'accueil : pas de
        // recréation du contexte WebGL → retour sur l'accueil immédiat.
        keepAlive
        // Réserve la zone basse occupée par la feuille → le point « moi » est
        // centré dans la partie VISIBLE de la carte (au-dessus de la feuille),
        // et s'ajuste quand on réduit/agrandit la feuille.
        padding={{ top: 96, bottom: mini ? 220 : 520, left: 56, right: 56 }}
      />

      {/* Bandeau haut (3 zones) : courses dispo (GAUCHE) · revenus (CENTRE) ·
          GPS (DROITE). Le centre reste centré quelles que soient les présences. */}
      <div className="absolute inset-x-3 top-3 z-10 grid grid-cols-3 items-start gap-2">
        {/* GAUCHE — courses disponibles (en ligne) → ouvre Drive */}
        <div className="flex justify-start">
          {online && (
            <button
              type="button"
              onClick={() => router.push("/chauffeur/demandes")}
              className="flex items-center gap-1.5 rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] py-1.5 pr-2 pl-3 shadow-lg"
            >
              <span className="flex flex-col items-start leading-none">
                <span
                  className="drive-sora text-[18px] font-extrabold"
                  style={{ color: VIOLET }}
                >
                  {reqCount}
                </span>
                <span className="mt-0.5 text-[9px] font-medium whitespace-nowrap text-[var(--d-muted)]">
                  {isAr ? "متوفرة" : "dispo."}
                </span>
              </span>
              <ChevronRight className="size-3.5 shrink-0 text-[var(--d-muted)]" />
            </button>
          )}
        </div>

        {/* CENTRE — revenu du jour (mode compact) — carte violette arrondie */}
        <div className="flex justify-center">
          {mini && (
            <button
              type="button"
              onClick={() => router.push("/chauffeur/gains")}
              className="flex items-center gap-1.5 rounded-[16px] border py-1.5 pr-2 pl-3.5 text-white shadow-lg"
              style={{ background: "#6315E8", borderColor: "#5009C9" }}
            >
              <span className="flex flex-col items-start leading-none">
                <span className="drive-sora text-[18px] font-extrabold tracking-[-0.5px]">
                  {formatDA(home?.todayNet ?? 0)}
                </span>
                <span className="mt-0.5 text-[9px] font-medium whitespace-nowrap opacity-85">
                  {tr("Revenu du jour", "دخل اليوم")}
                </span>
              </span>
              <ChevronRight className="size-3.5 shrink-0 text-white/80" />
            </button>
          )}
        </div>

        {/* DROITE — langue + thème + GPS (recentrer) */}
        <div className="flex flex-col items-end gap-2">
          <LanguageSwitcher compact />
          <ChauffeurDarkPill />
          <button
            type="button"
            onClick={() => void recenter()}
            disabled={locating}
            aria-label="Centrer sur ma position"
            className="grid size-[44px] place-items-center rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
          >
            {locating ? (
              <Loader2
                className="size-5 animate-spin"
                style={{ color: VIOLET }}
              />
            ) : (
              <LocateFixed className="size-5" style={{ color: VIOLET }} />
            )}
          </button>
        </div>
      </div>

      {/* RÉCEPTION : carte de course entrante (en ligne, accueil, hors volet). */}
      {current && online && (
        <DIncoming
          ride={current}
          queueCount={queueCount}
          pendingCount={reqCount}
          busy={incBusy}
          isAr={isAr}
          onAccept={() => void acceptInc()}
          onRefuse={() => void refuseInc()}
          onSeeAll={seeAllInc}
          onClose={closeInc}
        />
      )}

      {/* Feuille réductible — SCROLLABLE. */}
      <div
        className="absolute right-0 bottom-[66px] left-0 z-10 overflow-y-auto overscroll-contain rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-2 pb-6 transition-[max-height] duration-300"
        style={{ maxHeight: mini ? 118 : "min(580px, calc(100dvh - 140px))" }}
      >
        {/* Poignée + flèche INTÉGRÉE (dans le flux, centrée) — repliée ▲ « ouvrir »,
            dépliée ▼ « fermer ». Plus de pastille flottante qui déborde. */}
        <button
          type="button"
          onClick={() => setMini((m) => !m)}
          aria-label={mini ? tr("Ouvrir", "فتح") : tr("Fermer", "إغلاق")}
          className="mx-auto flex w-full flex-col items-center gap-1 py-1"
        >
          <span className="block h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />
          <ChevronUp
            className="size-4 text-[var(--d-muted)] transition-transform duration-300"
            style={{ transform: mini ? undefined : "rotate(180deg)" }}
          />
        </button>

        {/* ── Toggle « En ligne » — épuré (style Anthropic) ── */}
        <button
          type="button"
          role="switch"
          aria-checked={online}
          aria-label={tr("Disponibilité", "التوفر")}
          onClick={() => toggleOnline()}
          className="mt-1 flex w-full items-center gap-3 rounded-[16px] border px-4 py-3 text-start transition-colors"
          style={{
            borderColor: online ? "rgba(22,179,100,.35)" : "var(--d-line)",
            background: online ? "rgba(22,179,100,.06)" : "var(--d-surface)",
          }}
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full transition-colors"
            style={{
              background: online ? "rgba(22,179,100,.14)" : "var(--d-soft)",
            }}
          >
            {online ? (
              <Radio className="size-[18px]" style={{ color: GO }} />
            ) : (
              <Power
                className="size-[18px]"
                style={{ color: "var(--d-muted)" }}
              />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="drive-sora block text-[14px] font-bold tracking-[-0.2px]">
              {online ? tr("En ligne", "متصل") : tr("Hors ligne", "غير متصل")}
            </span>
            <span className="block truncate text-[11.5px] text-[var(--d-muted)]">
              {online
                ? tr("En recherche des courses…", "البحث عن الطلبات…")
                : tr(
                    "Activez pour recevoir les courses",
                    "فعّل لاستقبال الطلبات"
                  )}
            </span>
          </span>
          {/* Switch iOS-like (RTL-safe) */}
          <span
            className="relative h-[28px] w-[48px] shrink-0 rounded-full transition-colors"
            style={{ background: online ? GO : "#D6D9E2" }}
          >
            <span
              className="absolute top-[3px] size-[22px] rounded-full bg-white shadow-sm transition-all"
              style={{ insetInlineStart: online ? 23 : 3 }}
            />
          </span>
        </button>

        {/* ── Finance : gains du jour + solde (2 cartes épurées) ── */}
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => router.push("/chauffeur/gains")}
            className="flex flex-col gap-0.5 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3 text-left"
          >
            <span className="text-[11px] font-medium text-[var(--d-muted)]">
              {tr("Gains du jour", "أرباح اليوم")}
            </span>
            <span className="drive-sora text-[18px] leading-none font-extrabold tracking-[-0.5px]">
              {formatDA(home?.todayNet ?? 0)}
            </span>
            <span className="mt-0.5 text-[10px] text-[var(--d-muted)]">
              {home?.todayRides ?? 0} {tr("courses", "رحلة")} ·{" "}
              {fmtOnline(home?.todayOnlineMin ?? 0)}
            </span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/chauffeur/recharger")}
            className="flex flex-col gap-0.5 rounded-[14px] border p-3 text-left"
            style={{
              borderColor: lowBalance ? "rgba(229,72,77,.25)" : "var(--d-line)",
              background: lowBalance
                ? "rgba(229,72,77,.05)"
                : "var(--d-surface)",
            }}
          >
            <span
              className="flex items-center gap-1.5 text-[11px] font-medium"
              style={{ color: lowBalance ? RED : "var(--d-muted)" }}
            >
              <Wallet className="size-3.5" />
              {tr("Solde", "الرصيد")}
            </span>
            <span
              className="drive-sora text-[18px] leading-none font-extrabold tracking-[-0.5px]"
              style={{ color: lowBalance ? RED : "var(--d-ink)" }}
            >
              {balance == null ? "…" : formatDA(balance)}
            </span>
            <span
              className="mt-0.5 text-[10px]"
              style={{ color: lowBalance ? RED : "var(--d-muted)" }}
            >
              {lowBalance
                ? tr("Recharger le portefeuille", "اشحن المحفظة")
                : tr("Portefeuille opérateur", "محفظة المشغّل")}
            </span>
          </button>
        </div>

        {/* ── Options — liste épurée (icône · libellé · valeur) ── */}
        <div className="mt-2.5 overflow-hidden rounded-[14px] border border-[var(--d-line)]">
          {/* Rentrer chez moi (+ filtre direction) */}
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
              <Home className="size-4" style={{ color: VIOLET }} />
            </span>
            <button
              type="button"
              onClick={() => {
                setHomeErr(null);
                setHomePos(null);
                setHomeOpen(true);
              }}
              className="min-w-0 flex-1 text-start"
            >
              <b className="block text-[13px] font-semibold">
                {tr("Rentrer chez moi", "العودة للمنزل")}
              </b>
              <span className="flex items-center gap-1 truncate text-[11px] text-[var(--d-muted)]">
                <span className="truncate">
                  {homeAddr ?? tr("Définir l'adresse", "تحديد العنوان")}
                </span>
                <Pencil className="size-2.5 shrink-0" />
              </span>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={dirOn}
              aria-label={tr("Filtre domicile", "فلتر المنزل")}
              onClick={toggleDir}
              className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
              style={{ background: dirOn ? VIOLET : "#D6D9E2" }}
            >
              <span
                className="absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-all"
                style={{ insetInlineStart: dirOn ? 18 : 2 }}
              />
            </button>
          </div>

          <div className="mx-3.5 h-px bg-[var(--d-line)]" />

          {/* Ma zone */}
          <button
            type="button"
            onClick={() => setZoneOpen(true)}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-start"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
              <Crosshair className="size-4" style={{ color: VIOLET }} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[13px] font-semibold">
                {tr("Ma zone", "منطقتي")}
              </b>
              <span className="block truncate text-[11px] text-[var(--d-muted)]">
                {searchRadius} km · {tr("autour de moi", "حولي")}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-[var(--d-muted)]" />
          </button>

          <div className="mx-3.5 h-px bg-[var(--d-line)]" />

          {/* Abonnement */}
          <button
            type="button"
            onClick={() => router.push("/chauffeur/abonnement")}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-start"
          >
            <PlanIcon plan={home?.plan ?? "free"} />
            <span className="min-w-0 flex-1">
              <b className="block text-[13px] font-semibold">
                {tr("Abonnement", "الاشتراك")} ·{" "}
                {planLabel(home?.plan ?? "free")}
              </b>
              <span className="block truncate text-[11px] text-[var(--d-muted)]">
                {home?.plan === "premium"
                  ? tr(
                      "0 % de commission · priorité dispatch",
                      "0٪ عمولة · أولوية في التوزيع"
                    )
                  : home?.plan === "pro"
                    ? `${tr("Commission", "عمولة")} ${fmtPct(home.planRate)} · 1 500 DA/${tr("mois", "شهر")}`
                    : tr(
                        "Commission 8 % · passez en Premium = 0 %",
                        "عمولة 8٪ · انتقل إلى بريميوم = 0٪"
                      )}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-[var(--d-muted)]" />
          </button>

          <div className="mx-3.5 h-px bg-[var(--d-line)]" />

          {/* Gamme (info, non cliquable) */}
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
              <Car className="size-4" style={{ color: VIOLET }} />
            </span>
            <span className="min-w-0 flex-1 text-[11.5px] text-[var(--d-muted)]">
              {tr("Gamme", "الفئة")}{" "}
              <b className="text-[var(--d-ink)]">{GAMME_LABEL[gate.gamme]}</b> ·{" "}
              {tr("reçoit", "يستقبل")} {GAMME_RECEIVES[gate.gamme]}
            </span>
          </div>
        </div>

        {/* Retour d'activation du filtre domicile (compte d'activations). */}
        {dirMsg && (
          <p className="mt-2 px-1 text-[11px] text-[var(--d-muted)]">
            {dirMsg}
          </p>
        )}

        {/* Voir les demandes (raccourci quand en ligne) */}
        {online && (
          <PrimaryBtn
            onClick={() => router.push("/chauffeur/demandes")}
            className={reqCount > 0 ? "drive-attn" : ""}
          >
            {reqCount > 0
              ? isAr
                ? `عرض ${reqCount} ${reqCount > 1 ? "طلبات" : "طلب"}`
                : `Voir les ${reqCount} demande${reqCount > 1 ? "s" : ""}`
              : tr("Voir les demandes", "عرض الطلبات")}
          </PrimaryBtn>
        )}
      </div>

      {/* Popup domicile : recherche d'adresse + repère sur la carte. */}
      {homeOpen && (
        <Portal>
          <div className="fixed inset-0 z-[130] flex flex-col justify-end bg-black/45">
            <div className="drive-jakarta rounded-t-[24px] bg-[var(--d-surface)] p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
              <div className="mb-2 flex items-center justify-between">
                <b className="drive-sora text-[16px] font-extrabold">
                  {tr("Mon domicile", "منزلي")}
                </b>
                <button
                  type="button"
                  onClick={() => setHomeOpen(false)}
                  aria-label="Fermer"
                  className="grid size-9 place-items-center rounded-full bg-[var(--d-soft)]"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="mb-2 text-[12px] text-[var(--d-muted)]">
                {tr(
                  "Cherchez votre adresse ou déplacez la carte pour placer le repère sur votre domicile.",
                  "ابحث عن عنوانك أو حرّك الخريطة لوضع المؤشر على منزلك."
                )}
              </p>
              <MapPositionPicker
                initial={null}
                defaultCenter={me ?? undefined}
                autoLocate={!me}
                searchEnabled
                height={300}
                gpsLabel={tr("Ma position", "موقعي")}
                onChange={(p) => setHomePos(p)}
              />
              <p className="mt-2 text-[11px] text-[var(--d-muted)]">
                {tr(
                  "⚠️ Anti-fraude : l'adresse domicile est modifiable 3 fois par semaine (correction libre pendant 15 min après un changement).",
                  "⚠️ لمكافحة الاحتيال: عنوان المنزل قابل للتعديل 3 مرات في الأسبوع (تصحيح حر خلال 15 دقيقة بعد التغيير)."
                )}
              </p>
              {homeErr && (
                <p
                  className="mt-2 rounded-[12px] px-3 py-2 text-center text-xs font-bold"
                  style={{ background: "rgba(229,72,77,.1)", color: RED }}
                >
                  {homeErr}
                </p>
              )}
              <PrimaryBtn
                onClick={() => void saveHome()}
                disabled={homeSaving || !homePos}
                className="!mt-3"
              >
                {homeSaving ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : null}
                {tr("Enregistrer mon domicile", "حفظ منزلي")}
              </PrimaryBtn>
            </div>
          </div>
        </Portal>
      )}

      <ChauffeurWorkZoneSheet
        open={zoneOpen}
        onClose={() => setZoneOpen(false)}
      />
      {/* PushRegistrar est désormais monté dans la coque (app)/layout (commun à
          toutes les pages chauffeur authentifiées) → le tap sur notification est
          capté partout, plus seulement sur l'accueil. */}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  BarChart3,
  Car,
  ChevronRight,
  Clock,
  Crosshair,
  FileText,
  Home,
  Loader2,
  LocateFixed,
  LogOut,
  Pencil,
  Power,
  Radio,
  ShieldCheck,
  User,
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
import {
  PartnerDrawer,
  PartnerMenuButton,
  DrawerSection,
  DrawerRow,
  DrawerDivider,
  type DrawerTheme,
} from "@/components/shared/partner-drawer";
import { useSearchRadius } from "@/lib/chauffeur/work-zone";
import {
  setChauffeurOnlineLocal,
  useChauffeurOnline,
} from "@/lib/chauffeur/online-store";
import { useNetworkOffline } from "@/lib/connectivity/network-store";
import {
  useHomeDirOn,
  setHomeDirOn,
  getHomeDirOn,
} from "@/lib/chauffeur/home-dir-store";
import { isOpenDemande } from "@/lib/chauffeur/dispatch-filter";
import { registerChauffeurCacheReset } from "@/lib/chauffeur/client-cache";
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
  chauffeurLogout,
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
// Vidange au changement de compte (anti-fuite sur appareil partagé).
registerChauffeurCacheReset(() => {
  lastDriveHomeCache = null;
});

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
  // Tiroir latéral gauche (toutes les options regroupées). L'accueil ne garde
  // QUE le bouton de mise en ligne ; le reste vit dans ce menu (style Uber).
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutErr, setLogoutErr] = useState<string | null>(null);
  // Recentrage / vol de la caméra vers la position du chauffeur. Déclaré tôt
  // car le 1er fix GPS (plus haut) s'en sert pour garantir le centrage.
  const [focusMe, setFocusMe] = useState<(LatLng & { zoom?: number }) | null>(
    null
  );
  const [locating, setLocating] = useState(false);
  // Thème du tiroir mappé sur la palette chauffeur (`--d-*` + violet).
  const drawerTheme: DrawerTheme = {
    surface: "var(--d-surface)",
    line: "var(--d-line)",
    ink: "var(--d-ink)",
    muted: "var(--d-muted)",
    soft: "var(--d-soft)",
    accent: VIOLET,
  };
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
  // Réseau confirmé (garde de connexion) : pas de mise en ligne sans Internet.
  const netOffline = useNetworkOffline();
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
    // Hors ligne : mise en ligne refusée (le dispatch a besoin d'Internet). Le
    // passage HORS LIGNE reste permis. Le bouton est déjà désactivé dans ce cas.
    if (next && netOffline) return;
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
    } catch {
      // Filet : un tick en échec ne casse pas la réception (le prochain réessaie).
      // Filet : un tick en échec ne doit pas casser la réception (le prochain
      // poll réessaie). Sans ce catch, une exception laissait `nearby` figé.
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

  // Au montage : forcer un fix GPS FRAIS (déclenche le prompt de permission au
  // besoin) → la carte ne reste pas bloquée sur le centre par défaut (Alger) en
  // attendant le 1er relevé du watch (qui peut tarder 15-30 s).
  useEffect(() => {
    void refreshDriverPosition();
  }, []);

  // Dès la 1re position GPS connue : recharger immédiatement (sans attendre 15 s)
  // ET centrer la carte sur la vraie position (garantit le recadrage même si le
  // fit interne tardait — fin du « toujours sur Alger »).
  const gotFirstFix = useRef(false);
  useEffect(() => {
    if (coords && !gotFirstFix.current) {
      gotFirstFix.current = true;
      setFocusMe({ lat: coords.latitude, lng: coords.longitude, zoom: 16.5 });
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

  // Si une position est déjà connue au montage, centrer tout de suite.
  useEffect(() => {
    const c = coordsRef.current;
    if (c) setFocusMe({ lat: c.latitude, lng: c.longitude, zoom: 16.5 });
  }, []);
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

  // Déconnexion (depuis le tiroir) : le serveur refuse tant qu'une course est
  // active (message inline, pas de toast — règle produit).
  const doLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutErr(null);
    setChauffeurOnlineLocal(false);
    const res = await chauffeurLogout(); // redirige si OK
    if (res?.error) {
      setLoggingOut(false);
      setLogoutErr(res.error);
    }
  };

  const me = coords ? { lat: coords.latitude, lng: coords.longitude } : null;
  // Centre de secours = dernière position connue côté serveur (présence) → la
  // carte démarre PRÈS du chauffeur (sa wilaya), jamais sur Alger par défaut,
  // même avant le 1er fix GPS du navigateur.
  const presenceCenter =
    gate.presenceLat != null && gate.presenceLng != null
      ? { lat: gate.presenceLat, lng: gate.presenceLng }
      : null;
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
      <DriveMap
        // Vagues radar sur ma position quand je suis EN LIGNE sans course en
        // cours (style Bolt) : la recherche de demandes est visiblement active.
        markers={
          me
            ? [{ id: "me", pos: me, kind: "me", radar: online && !current }]
            : []
        }
        heatZones={home?.heatZones ?? []}
        focusTarget={focusMe}
        fallbackCenter={presenceCenter}
        follow
        // Conserve l'instance MapLibre entre les visites de l'accueil : pas de
        // recréation du contexte WebGL → retour sur l'accueil immédiat.
        keepAlive
        // Réserve la zone basse occupée par la barre de mise en ligne → le point
        // « moi » est centré dans la partie VISIBLE de la carte (au-dessus).
        padding={{ top: 96, bottom: 220, left: 56, right: 56 }}
      />

      {/* Bandeau haut épuré : menu (GAUCHE) · revenu du jour (CENTRE) · GPS
          (DROITE). Toutes les options sont désormais dans le tiroir → l'accueil
          reste dégagé sur la carte (style Uber). */}
      {/* Zone sûre : sans elle, le bandeau passe SOUS la barre de statut sur
          l'app Android (viewport-fit=cover, WebView à ras bord). */}
      <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+12px)] z-10 grid grid-cols-3 items-start gap-2">
        {/* GAUCHE — bouton menu (ouvre le tiroir). Pas de pastille de comptage
            ici : les demandes en attente sont déjà signalées par la carte de
            réception et la barre « Voir N demandes » → on évite le doublon de
            chiffre rouge qui se chevauchait avec la notification. */}
        <div className="flex justify-start">
          <PartnerMenuButton
            onClick={() => setMenuOpen(true)}
            theme={drawerTheme}
            label={tr("Menu", "القائمة")}
          />
        </div>

        {/* CENTRE — revenu du jour → ouvre Gains. Masqué pendant qu'une course
            entrante est affichée (la carte de réception occupe le haut). */}
        <div className="flex justify-center">
          {!current && (
            <button
              type="button"
              onClick={() => router.push("/chauffeur/gains")}
              className="flex items-center gap-1.5 rounded-[16px] border py-1.5 pr-2 pl-3.5 text-white shadow-lg"
              style={{ background: "#6C2BD9", borderColor: "#4B1FA6" }}
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

        {/* DROITE — GPS (recentrer) */}
        <div className="flex justify-end">
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

      {/* ── Barre de mise en ligne docké (SEUL contrôle conservé sur l'accueil) ──
          Toutes les options sont passées dans le tiroir gauche. Ici, on ne garde
          que le bouton de disponibilité — large, lisible, façon Uber. */}
      <div className="above-nav absolute inset-x-3 z-10 flex flex-col gap-2">
        {/* Raccourci « Voir les demandes » (en ligne + demandes en attente). */}
        {online && reqCount > 0 && (
          <button
            type="button"
            onClick={() => router.push("/chauffeur/demandes")}
            className="drive-attn flex items-center justify-center gap-2 rounded-[16px] px-4 py-2.5 text-[13.5px] font-bold text-white shadow-lg"
            style={{ background: VIOLET }}
          >
            {isAr
              ? `عرض ${reqCount} ${reqCount > 1 ? "طلبات" : "طلب"}`
              : `Voir les ${reqCount} demande${reqCount > 1 ? "s" : ""}`}
            <ChevronRight className="size-4" />
          </button>
        )}

        <button
          type="button"
          role="switch"
          aria-checked={online}
          aria-label={tr("Disponibilité", "التوفر")}
          onClick={() => toggleOnline()}
          disabled={!online && netOffline}
          className="flex w-full items-center gap-3 rounded-[20px] border px-4 py-3.5 text-start shadow-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            borderColor: online ? "rgba(22,179,100,.35)" : "var(--d-line)",
            background: online ? "rgba(22,179,100,.07)" : "var(--d-surface)",
          }}
        >
          <span
            className="grid size-11 shrink-0 place-items-center rounded-full transition-colors"
            style={{
              background: online ? "rgba(22,179,100,.16)" : "var(--d-soft)",
            }}
          >
            {online ? (
              <Radio className="size-5" style={{ color: GO }} />
            ) : (
              <Power className="size-5" style={{ color: "var(--d-muted)" }} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="drive-sora block text-[15.5px] font-extrabold tracking-[-0.2px]">
              {online ? tr("En ligne", "متصل") : tr("Hors ligne", "غير متصل")}
            </span>
            <span className="block truncate text-[12px] text-[var(--d-muted)]">
              {online
                ? tr("En recherche des courses…", "البحث عن الطلبات…")
                : netOffline
                  ? tr(
                      "Reconnexion nécessaire pour passer en ligne",
                      "الاتصال بالإنترنت مطلوب للاتصال"
                    )
                  : tr(
                      "Activez pour recevoir les courses",
                      "فعّل لاستقبال الطلبات"
                    )}
            </span>
          </span>
          {/* Switch iOS-like (RTL-safe) */}
          <span
            className="relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors"
            style={{ background: online ? GO : "#D6D9E2" }}
          >
            <span
              className="absolute top-[3px] size-[24px] rounded-full bg-white shadow-sm transition-all"
              style={{ insetInlineStart: online ? 25 : 3 }}
            />
          </span>
        </button>
      </div>

      {/* ── Tiroir latéral gauche : toutes les options (style Uber/Claude) ── */}
      <PartnerDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        theme={drawerTheme}
        header={
          <div className="space-y-3">
            {/* Profil */}
            <div className="flex items-center gap-3">
              <span
                className="drive-sora grid size-12 shrink-0 place-items-center rounded-[16px] text-[18px] font-extrabold text-white"
                style={{ background: VIOLET }}
              >
                {(gate.firstName || "C").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <b className="drive-sora truncate text-[15px] font-extrabold text-[var(--d-ink)]">
                    {gate.fullName || gate.firstName}
                  </b>
                  {gate.isVerified && (
                    <ShieldCheck
                      className="size-4 shrink-0"
                      style={{ color: GO }}
                    />
                  )}
                </div>
                <span className="block truncate text-[12px] text-[var(--d-muted)]">
                  {tr("Chauffeur", "سائق")} · {planLabel(home?.plan ?? "free")}{" "}
                  · {GAMME_LABEL[gate.gamme]}
                </span>
              </div>
            </div>
            {/* Finance : gains du jour + solde */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  router.push("/chauffeur/gains");
                }}
                className="flex flex-col gap-0.5 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3 text-left"
              >
                <span className="text-[11px] font-medium text-[var(--d-muted)]">
                  {tr("Gains du jour", "أرباح اليوم")}
                </span>
                <span className="drive-sora text-[17px] leading-none font-extrabold tracking-[-0.5px]">
                  {formatDA(home?.todayNet ?? 0)}
                </span>
                <span className="mt-0.5 text-[10px] text-[var(--d-muted)]">
                  {home?.todayRides ?? 0} {tr("courses", "رحلة")} ·{" "}
                  {fmtOnline(home?.todayOnlineMin ?? 0)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  router.push("/chauffeur/recharger");
                }}
                className="flex flex-col gap-0.5 rounded-[14px] border p-3 text-left"
                style={{
                  borderColor: lowBalance
                    ? "rgba(229,72,77,.25)"
                    : "var(--d-line)",
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
                  className="drive-sora text-[17px] leading-none font-extrabold tracking-[-0.5px]"
                  style={{ color: lowBalance ? RED : "var(--d-ink)" }}
                >
                  {balance == null ? "…" : formatDA(balance)}
                </span>
                <span
                  className="mt-0.5 text-[10px]"
                  style={{ color: lowBalance ? RED : "var(--d-muted)" }}
                >
                  {lowBalance
                    ? tr("Recharger", "اشحن")
                    : tr("Portefeuille opérateur", "محفظة المشغّل")}
                </span>
              </button>
            </div>
          </div>
        }
        footer={
          <div className="space-y-2">
            {logoutErr && (
              <p
                className="rounded-[12px] px-3 py-2 text-center text-[12px] font-bold"
                style={{ background: "rgba(229,72,77,.1)", color: RED }}
              >
                {logoutErr}
              </p>
            )}
            <button
              type="button"
              onClick={() => void doLogout()}
              disabled={loggingOut}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] border py-3 text-[13.5px] font-bold"
              style={{ borderColor: "rgba(229,72,77,.3)", color: RED }}
            >
              {loggingOut ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}
              {tr("Se déconnecter", "تسجيل الخروج")}
            </button>
          </div>
        }
      >
        {/* Préférences de réception */}
        <DrawerSection title={tr("Préférences", "التفضيلات")}>
          {/* Rentrer chez moi (édition adresse + filtre direction) */}
          <DrawerRow
            icon={<Home className="size-4" />}
            label={tr("Rentrer chez moi", "العودة للمنزل")}
            sublabel={
              <span className="flex items-center gap-1">
                <span className="truncate">
                  {homeAddr ?? tr("Définir l'adresse", "تحديد العنوان")}
                </span>
                <Pencil className="size-2.5 shrink-0" />
              </span>
            }
            onClick={() => {
              setHomeErr(null);
              setHomePos(null);
              setMenuOpen(false);
              setHomeOpen(true);
            }}
            trailing={
              <span
                role="switch"
                aria-checked={dirOn}
                aria-label={tr("Filtre domicile", "فلتر المنزل")}
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleDir();
                }}
                className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
                style={{ background: dirOn ? VIOLET : "#D6D9E2" }}
              >
                <span
                  className="absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-all"
                  style={{ insetInlineStart: dirOn ? 18 : 2 }}
                />
              </span>
            }
          />
          <DrawerDivider />
          {/* Ma zone */}
          <DrawerRow
            icon={<Crosshair className="size-4" />}
            label={tr("Ma zone", "منطقتي")}
            sublabel={`${searchRadius} km · ${tr("autour de moi", "حولي")}`}
            onClick={() => {
              setMenuOpen(false);
              setZoneOpen(true);
            }}
          />
          <DrawerDivider />
          {/* Abonnement */}
          <DrawerRow
            icon={<PlanIcon plan={home?.plan ?? "free"} />}
            label={`${tr("Abonnement", "الاشتراك")} · ${planLabel(home?.plan ?? "free")}`}
            sublabel={
              // ADAPTATIF : reflète la commission RÉELLE du plan (0 % au
              // lancement), sans référence à un plan inactif.
              (home?.planRate ?? 0) <= 0
                ? tr(
                    "0 % de commission — vous gardez tout",
                    "0٪ عمولة — كل شيء لك"
                  )
                : `${tr("Commission", "عمولة")} ${fmtPct(home?.planRate ?? 0)}`
            }
            onClick={() => {
              setMenuOpen(false);
              router.push("/chauffeur/abonnement");
            }}
          />
          <DrawerDivider />
          {/* Gamme (info) */}
          <DrawerRow
            icon={<Car className="size-4" />}
            label={`${tr("Gamme", "الفئة")} · ${GAMME_LABEL[gate.gamme]}`}
            sublabel={`${tr("reçoit", "يستقبل")} ${GAMME_RECEIVES[gate.gamme]}`}
            trailing={<span />}
          />
        </DrawerSection>

        {dirMsg && (
          <p className="px-6 pb-1 text-[11px] text-[var(--d-muted)]">
            {dirMsg}
          </p>
        )}

        {/* Activité & compte */}
        <DrawerSection title={tr("Mon activité", "نشاطي")}>
          <DrawerRow
            icon={<BarChart3 className="size-4" />}
            label={tr("Mes gains", "أرباحي")}
            href="/chauffeur/gains"
            onClick={() => setMenuOpen(false)}
          />
          <DrawerDivider />
          <DrawerRow
            icon={<Clock className="size-4" />}
            label={tr("Historique", "السجل")}
            href="/chauffeur/historique"
            onClick={() => setMenuOpen(false)}
          />
          <DrawerDivider />
          <DrawerRow
            icon={<Wallet className="size-4" />}
            label={tr("Coligo Pay", "كوليغو باي")}
            href="/chauffeur/recharger"
            onClick={() => setMenuOpen(false)}
          />
          <DrawerDivider />
          <DrawerRow
            icon={<FileText className="size-4" />}
            label={tr("Mes documents", "وثائقي")}
            href="/chauffeur/documents"
            onClick={() => setMenuOpen(false)}
          />
          <DrawerDivider />
          <DrawerRow
            icon={<User className="size-4" />}
            label={tr("Mon compte", "حسابي")}
            href="/chauffeur/compte"
            onClick={() => setMenuOpen(false)}
          />
        </DrawerSection>

        {/* Apparence & langue */}
        <DrawerSection title={tr("Apparence & langue", "المظهر واللغة")}>
          <div className="flex items-center justify-between gap-3 px-3.5 py-3">
            <span className="text-[13px] font-semibold text-[var(--d-ink)]">
              {tr("Thème & langue", "السمة واللغة")}
            </span>
            <div className="flex items-center gap-2">
              <LanguageSwitcher compact />
              <ChauffeurDarkPill />
            </div>
          </div>
        </DrawerSection>
      </PartnerDrawer>

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

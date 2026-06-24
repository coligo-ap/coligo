"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowUpDown,
  BellRing,
  CalendarClock,
  Car,
  ChevronLeft,
  Clock,
  History,
  Loader2,
  MapPin,
  Pencil,
  Route,
  Search,
  ShieldAlert,
  Snowflake,
  Star,
  User,
  Users,
  Zap,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { getPosition, watchPosition } from "@/lib/native/geolocation";
import { haversineKm } from "@/lib/delivery/distance";
import { readStoredLocation } from "@/lib/customer/location-store";
import {
  geocodeSearch,
  listFavoritePlaces,
  recordPlacePick,
  reverseGeocode,
  routeEstimate,
  toggleFavoritePlace,
  type FavPlace,
} from "@/app/(customer)/actions";
import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";
import { DriveMap, type LatLng } from "./drive-map";
import {
  DepModal,
  GhostBtn,
  PrimaryBtn,
  ProxModal,
  SosContactsSheet,
  GO,
  ROSE,
  VIOLET,
  type SosContact,
} from "./drive-modals";
import { DriveRide } from "./drive-ride";
import {
  clearPendingRide,
  getPendingRide,
  queueRideRequest,
} from "@/lib/drive/offline-db";
import {
  cancelDriveRide,
  createRideCardCheckout,
  getDriveActiveRide,
  getDriveContext,
  getDriveQuotes,
  getFirstRideOffer,
  getSosContacts,
  issueDriveQuote,
  precheckDriveRoute,
  requestDriveRide,
  requestScheduledRide,
  setSosContacts as saveSosContacts,
  type DriveActiveRide,
  type DriveQuote,
} from "@/app/(customer)/drive/actions";
import { joinZoneWaitlist } from "@/lib/zones/actions";
import { useGeoClientConfig } from "@/lib/geo/use-geo-client-config";
import { AvailabilityNotice } from "@/components/zones/availability-notice";
import { DriveAiBar } from "./drive-ai-bar";
import type { DriveIntentDraft } from "@/app/(customer)/drive/ai-actions";

/**
 * Coligo Drive — parcours client conforme à MAQUETTE-vtc-coligo.html :
 * trajet (GPS / épingle carte) → gammes + paiement + options (boost, femme
 * au volant, pour un proche) → offres des chauffeurs → course → fin.
 */

export type Pt = {
  lat: number;
  lng: number;
  text: string | null;
  gps?: boolean;
};
type Gamme = "classic" | "confort" | "moto";
type Screen = "home" | "mappick" | "price" | "ride";

const GAMME_IMG: Record<Gamme, string> = {
  classic: "/drive/gamme-classic.png",
  confort: "/drive/gamme-confort.png",
  moto: "/drive/gamme-moto.png",
};

const rnd5 = (v: number) => Math.round(v / 5) * 5;

/**
 * Devis de REPLI calculés CÔTÉ CLIENT — utilisés UNIQUEMENT si la Server Action
 * `getDriveQuotes` échoue (réseau, action périmée après déploiement, etc.). But :
 * ne JAMAIS rester bloqué en loading et permettre quand même de lancer la
 * recherche. Barème simple aligné sur platform_settings (base 100 + 30/km, min
 * 150) × multiplicateur de gamme. Le prix RÉEL reste revalidé côté serveur au
 * moment de `requestRide` (devis signé) — ce repli n'est qu'une estimation.
 */
function fallbackQuotes(distanceKm: number): Record<Gamme, DriveQuote> {
  const make = (mult: number): DriveQuote => {
    const reco = Math.max(
      150,
      rnd5((100 + 30 * Math.max(0, distanceKm)) * mult)
    );
    return {
      recommended: reco,
      floor: rnd5(reco * 0.85),
      mini: rnd5(reco * 0.85),
      fast: rnd5(reco * 1.1),
      low: rnd5(reco * 0.9),
      high: rnd5(reco * 1.2),
    };
  };
  return { classic: make(1), confort: make(1.3), moto: make(0.85) };
}

export function DriveView() {
  const t = useTranslations("drive");
  const router = useRouter();
  // Contexte Drive (solde, récents, dernière course, options) CACHÉ via TanStack
  // dans le QueryClient persistant du groupe client : au retour sur /drive le
  // contexte est DÉJÀ là (re-affichage instantané, comme /commandes) au lieu
  // d'être re-fetché à chaque montage → plus de « rechargement » de l'écran.
  const { data: ctx = null } = useQuery({
    queryKey: ["drive-context"],
    queryFn: getDriveContext,
    staleTime: 60_000,
  });
  const [screen, setScreen] = useState<Screen>("home");
  // Assistant : carte de confirmation affichée → on masque le reste du trajet.
  const [aiConfirming, setAiConfirming] = useState(false);

  // Trajet
  const [pickup, setPickup] = useState<Pt | null>(null);
  const [dest, setDest] = useState<Pt | null>(null);
  const [mapPickFor, setMapPickFor] = useState<"dep" | "dest">("dest");

  // Choix course (écran prix)
  const [quotes, setQuotes] = useState<Record<Gamme, DriveQuote> | null>(null);
  const [gamme, setGamme] = useState<Gamme>("classic");
  const [price, setPrice] = useState(0);
  // Anti-prix-périmé (Partie D) : `pricing` = un recalcul est en cours après un
  // changement d'adresse → on désactive « Demander » tant qu'il n'est pas fini.
  // `quoteId` = devis signé serveur lié aux adresses courantes (anti-rejeu/TTL).
  const [pricing, setPricing] = useState(false);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  // Dernier trajet (adresses) pour lequel les devis ont été calculés → distingue
  // un NOUVEAU trajet (loader + remise au recommandé) d'un raffinement OSRM de la
  // distance sur le MÊME trajet (recalcul silencieux, prix jamais figé).
  const lastTrajRef = useRef<string>("");
  // Dernier prix recommandé servi : si le prix courant lui est égal, le client
  // n'a pas ajusté → un raffinement OSRM peut suivre le recommandé affiné.
  const lastRecoRef = useRef<number>(0);
  // Miroir SYNCHRONE du prix courant : lu dans les calculs ASYNCHRONES (devis
  // serveur en différé) pour décider de suivre le recommandé affiné SANS
  // dépendre d'une valeur `price` capturée (périmée) dans la closure de l'effet.
  const priceRef = useRef(0);
  useEffect(() => {
    priceRef.current = price;
  }, [price]);
  // Desktop (≥ lg) : on affiche une CARTE à côté du formulaire pour visualiser
  // le trajet. La carte n'est MONTÉE qu'en desktop (pas d'init MapLibre sur
  // mobile → accueil instantané conservé).
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const [payMode, setPayMode] = useState<"cash" | "card" | "coligo_pay">(
    "cash"
  );
  const [boostOn, setBoostOn] = useState(false);
  const [boostAmt, setBoostAmt] = useState(10);
  const [femaleOnly, setFemaleOnly] = useState(false);
  const [prox, setProx] = useState<{ name: string; phone: string } | null>(
    null
  );

  // Course active (recherche / en route / fin)
  const [active, setActive] = useState<DriveActiveRide | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Verrou SYNCHRONE anti-double-tap : `submitting` (useState) n'est posé qu'APRÈS
  // le 1ᵉʳ await (reverse-géocode), donc deux taps rapides passaient tous les deux.
  // Ce ref se ferme IMMÉDIATEMENT au 1ᵉʳ tap → le 2ᵉ est ignoré (jamais en file).
  const inFlightRef = useRef(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [offlineQueued, setOfflineQueued] = useState(false);
  // Couverture de zone (départ + arrivée) — pré-check UX avant la demande
  // (l'enforcement réel reste dans request_ride, mig 0169).
  const [zoneBlock, setZoneBlock] = useState<string | null>(null);
  const [zoneJoined, setZoneJoined] = useState(false);

  // Modales
  const [depOpen, setDepOpen] = useState(false);
  const [proxOpen, setProxOpen] = useState(false);
  // Contacts d'urgence (gérables dès l'accueil — sécurité).
  const [sosContacts, setSosContactsState] = useState<SosContact[]>([]);
  const [contactsOpen, setContactsOpen] = useState(false);
  useEffect(() => {
    void getSosContacts().then(setSosContactsState);
  }, []);

  /* ───────── Boot : contexte + course active + GPS ───────── */
  useEffect(() => {
    void (async () => {
      // Retour Chargily (?card=failed / ?card=success) : l'URL n'est jamais
      // crue seule — on vérifie l'état réel de la course (webhook fait foi).
      const params = new URLSearchParams(window.location.search);
      const cardReturn = params.get("card");
      if (cardReturn) {
        params.delete("card");
        const qs = params.toString();
        window.history.replaceState(
          null,
          "",
          window.location.pathname + (qs ? `?${qs}` : "")
        );
      }
      // Le contexte vient du cache TanStack (ci-dessus). Ici on ne vérifie que
      // la course active (pour restaurer l'écran course / le retour Chargily).
      const ride = await getDriveActiveRide();
      // Paiement carte échoué : la demande (jamais diffusée) est annulée et
      // le client revient à l'écran de CHOIX DE GAMME, trajet restauré,
      // avec un message inline — pas d'annulation manuelle à faire.
      if (
        cardReturn === "failed" &&
        ride &&
        ride.payment_method === "card" &&
        !ride.online_paid &&
        ride.status === "searching"
      ) {
        await cancelDriveRide(ride.id, "Paiement carte échoué");
        if (ride.pickup_lat != null && ride.dest_lat != null) {
          setPickup({
            lat: ride.pickup_lat,
            lng: ride.pickup_lng!,
            text: ride.pickup_text,
            gps: false,
          });
          setDest({
            lat: ride.dest_lat,
            lng: ride.dest_lng!,
            text: ride.dest_text,
          });
          setGamme((ride.gamme as Gamme) ?? "classic");
          setPrice(ride.proposed_price_da);
          setPayMode("card");
          setRequestError(t("price.cardFailed"));
          setScreen("price");
        }
      } else if (ride) {
        setActive(ride);
        setScreen("ride");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Départ = position actuelle (GPS) par défaut. Quasi instantané : un fix
  // « rapide » (cache OS / réseau) s'affiche tout de suite, puis le GPS haute
  // précision affine en arrière-plan tant que le départ reste « Ma position ».
  useEffect(() => {
    let cancelled = false;
    let bestAcc = Infinity;
    let lastFix: { lat: number; lng: number } | null = null;
    let lastRev: { lat: number; lng: number } | null = null;
    // Amorçage INSTANTANÉ du départ depuis la dernière position connue
    // (localStorage, partagée avec la marketplace) → au re-montage, le départ
    // s'affiche tout de suite au lieu de « Localisation… », puis le GPS RÉEL
    // (position actuelle) prend le dessus.
    const stored = readStoredLocation();
    if (stored?.latitude != null && stored?.longitude != null) {
      setPickup((prev) =>
        prev
          ? prev
          : {
              lat: stored.latitude!,
              lng: stored.longitude!,
              text: stored.address,
              gps: true,
            }
      );
    }
    const apply = (lat: number, lng: number, accuracy: number) => {
      if (cancelled) return;
      // On accepte un fix s'il est PLUS précis OU s'il est nettement AILLEURS que
      // la position affichée (cache périmé / on a bougé). → on ne reste jamais
      // bloqué sur une vieille position en cache (ex. « Alger ») jugée « plus
      // précise » : la position ACTUELLE du client gagne toujours.
      const moved = lastFix != null && haversineKm(lastFix, { lat, lng }) > 0.2;
      if (accuracy >= bestAcc && !moved) return;
      bestAcc = moved ? accuracy : Math.min(bestAcc, accuracy);
      lastFix = { lat, lng };
      setPickup((prev) =>
        prev && !prev.gps
          ? prev
          : // On a bougé → on EFFACE le libellé périmé le temps du re-géocodage
            // (jamais une vieille adresse « Alger » sur une autre position).
            {
              lat,
              lng,
              text: moved ? null : prev?.gps ? prev.text : null,
              gps: true,
            }
      );
      // Reverse géocode seulement si on a bougé de plus de ~120 m.
      if (lastRev && haversineKm(lastRev, { lat, lng }) < 0.12) return;
      lastRev = { lat, lng };
      void reverseGeocode({ latitude: lat, longitude: lng, precise: true })
        .then((r) => {
          if (cancelled || !r?.display) return;
          setPickup((prev) =>
            prev?.gps ? { ...prev, text: r.display ?? null } : prev
          );
        })
        .catch(() => {});
    };
    // maximumAge COURT : on veut la position ACTUELLE, pas un fix en cache de
    // plusieurs minutes (qui renvoyait parfois une vieille position type Alger).
    void getPosition({
      enableHighAccuracy: false,
      timeout: 4_000,
      maximumAge: 15_000,
    })
      .then((p) => apply(p.latitude, p.longitude, p.accuracy ?? 9_999))
      .catch(() => {
        /* géoloc refusée : le client choisira sur la carte */
      });
    const watch = watchPosition(
      (p) => apply(p.latitude, p.longitude, p.accuracy ?? 9_999),
      undefined,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    );
    const stopId = setTimeout(() => watch?.stop(), 15_000);
    return () => {
      cancelled = true;
      clearTimeout(stopId);
      watch?.stop();
    };
  }, []);

  const crowKm = useMemo(
    () =>
      pickup && dest
        ? Math.max(
            0.1,
            Number(
              haversineKm(
                { lat: pickup.lat, lng: pickup.lng },
                { lat: dest.lat, lng: dest.lng }
              ).toFixed(2)
            )
          )
        : 0,
    [pickup, dest]
  );

  // Itinéraire routier réel (OSRM) : distance et durée fiables. En attendant
  // la réponse (ou si l'API est indisponible) : vol d'oiseau × 1,25 ≈ route.
  const [route, setRoute] = useState<{
    km: number;
    min: number;
    path?: LatLng[];
  } | null>(null);
  useEffect(() => {
    setRoute(null);
    if (!pickup || !dest) return;
    let cancelled = false;
    void routeEstimate({
      from: { lat: pickup.lat, lng: pickup.lng },
      to: { lat: dest.lat, lng: dest.lng },
    })
      .then((r) => {
        if (!cancelled && r.ok)
          setRoute({
            km: r.distance_km,
            min: r.duration_min,
            path: r.geometry,
          });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pickup, dest]);

  const distanceKm =
    route?.km ?? (crowKm > 0 ? Number((crowKm * 1.25).toFixed(2)) : 0);
  const etaMin = route?.min ?? Math.max(2, Math.round((distanceKm / 26) * 60));
  // Distance affichée TOUT DE SUITE (vol d'oiseau × détour) puis affinée en
  // silence par OSRM — plus d'attente/loader sur la distance et la durée.
  const distanceLabel = distanceKm.toFixed(1).replace(".", ",");

  /* ───────── Devis par gamme — UN SEUL prix affiché (le prix FINAL) ───────── */
  useEffect(() => {
    // PRÉ-CHARGE : on calcule les devis DÈS que départ + arrivée sont connus,
    // SANS attendre l'écran prix → en arrivant sur l'écran prix, les prix par
    // gamme sont DÉJÀ là.
    if (distanceKm <= 0 || !pickup || !dest) return;
    const trajKey = `${pickup.lat.toFixed(5)},${pickup.lng.toFixed(5)},${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}`;
    const isNewTraj = trajKey !== lastTrajRef.current;

    // PRIX FINAL DIRECT — le client ne doit voir QU'UNE valeur, jamais un
    // « premier prix » remplacé ensuite. On n'affiche donc AUCUNE estimation
    // locale intermédiaire : sur un nouveau trajet on montre un loader bref, puis
    // UNIQUEMENT le devis SERVEUR autoritaire (affiché une seule fois). Et si le
    // prix est DÉJÀ calculé pour ce trajet, le raffinement OSRM de la distance ne
    // déclenche AUCUN recalcul visible (le serveur revérifie la distance au
    // moment de la demande de toute façon).
    if (!isNewTraj && quotes != null) return;
    lastTrajRef.current = trajKey;
    setPricing(true);
    setQuoteId(null);
    // Nouveau trajet → on vide les anciens prix : les cartes gammes affichent
    // « … » le temps du devis final, plutôt que les prix de l'ancien trajet
    // remplacés ensuite (pas de changement visible).
    if (isNewTraj) setQuotes(null);

    let cancelled = false;
    // Debounce court : coalesce le passage distance « vol d'oiseau » → OSRM
    // (route réelle) pour ne calculer le devis QU'UNE fois, sur la distance
    // stabilisée → aucun clignotement ni recalcul du prix.
    const timer = setTimeout(async () => {
      // Devis intelligent SERVEUR (mig 0235 : demande/offre locale + retard
      // trafic réel). BORNÉ à 3,5 s : au-delà (fonction serverless FROIDE / réseau
      // lent) on bascule sur l'estimation locale, affichée STABLEMENT (jamais
      // corrigée ensuite). Ainsi le client n'attend jamais 8-10 s ET ne voit
      // jamais le prix changer ; le serveur revérifie le prix à la demande de
      // toute façon. Chaud : ~0,5-1 s → prix serveur exact (souvent DÉJÀ
      // pré-calculé depuis l'accueil). Pas de retry (il doublerait l'attente).
      let q: Record<Gamme, DriveQuote> | null = null;
      try {
        q = await Promise.race([
          getDriveQuotes(
            distanceKm,
            { lat: pickup.lat, lng: pickup.lng },
            etaMin
          ),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), 3500)
          ),
        ]);
      } catch {
        q = null; // serveur lent/indispo → repli local stable ci-dessous
      }
      if (cancelled) return; // une réponse en retard ne doit pas écraser la neuve
      if (q == null) q = fallbackQuotes(distanceKm); // jamais bloqué
      setQuotes(q);
      const reco = q[gamme]?.recommended ?? q.classic.recommended;
      // Prix initialisé au recommandé tant que le client n'a pas ajusté (priceRef
      // = valeur courante, pas une closure périmée).
      if (
        isNewTraj ||
        priceRef.current === lastRecoRef.current ||
        priceRef.current <= 0
      ) {
        setPrice(reco);
        if (boostOn) setBoostAmt(defBoost(reco));
      }
      lastRecoRef.current = reco;
      setPricing(false);
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Déclenché par la DISTANCE (dès que départ+arrivée sont posés, puis au
    // raffinement OSRM — coalescé par le debounce et la garde ci-dessus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distanceKm]);

  const quote = quotes?.[gamme] ?? null;

  /* Offre « Bienvenue » 1ʳᵉ course (ancrage cosmétique, coût plateforme 0). */
  const [welcome, setWelcome] = useState<{
    isNew: boolean;
    anchor: number;
    pay: number;
    save: number;
    code: string | null;
  } | null>(null);
  useEffect(() => {
    if (screen !== "price" || !quote || quote.recommended <= 0) return;
    void (async () => {
      try {
        setWelcome(await getFirstRideOffer(quote.recommended));
      } catch {
        setWelcome(null);
      }
    })();
  }, [screen, quote?.recommended]);

  /* Devis SIGNÉ serveur lié aux adresses courantes (Partie D). Émis quand le
     prix est stabilisé (départ + arrivée connus, recalcul fini). Repassé à
     requestRide, qui le vérifie+consomme → réservation impossible sur un prix
     périmé / des adresses changées. Re-émis à chaque changement d'adresse. */
  useEffect(() => {
    if (screen !== "price" || pricing || !pickup || !dest || price <= 0) return;
    let cancelled = false;
    void (async () => {
      const q = await issueDriveQuote({
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_text: pickup.text ?? null,
        dest_lat: dest.lat,
        dest_lng: dest.lng,
        dest_text: dest.text ?? null,
        price_da: price,
        gamme,
      });
      if (!cancelled) setQuoteId(q?.quoteId ?? null);
    })();
    return () => {
      cancelled = true;
    };
    // Re-émission liée aux ADRESSES + gamme (le prix n'est pas figé : enchère).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, pricing, pickup?.lat, pickup?.lng, dest?.lat, dest?.lng, gamme]);

  /* Réservation programmée (gated super-admin — masquée si désactivée). */
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedAt, setSchedAt] = useState("");
  const [schedBusy, setSchedBusy] = useState(false);
  const [schedMsg, setSchedMsg] = useState<string | null>(null);
  const [schedDone, setSchedDone] = useState(false);
  const submitSchedule = useCallback(async () => {
    if (!pickup || !dest || !schedAt) return;
    setSchedBusy(true);
    setSchedMsg(null);
    try {
      const res = await requestScheduledRide({
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_text: pickup.text ?? null,
        dest_lat: dest.lat,
        dest_lng: dest.lng,
        dest_text: dest.text ?? null,
        distance_km: distanceKm,
        gamme,
        scheduled_at: new Date(schedAt).toISOString(),
        operation_id: `sched-${Date.now()}`,
      });
      if (res.ok) {
        setSchedDone(true);
        setTimeout(() => setSchedOpen(false), 1800);
      } else {
        setSchedMsg(t("price.schedError"));
      }
    } catch {
      setSchedMsg(t("price.schedError"));
    } finally {
      setSchedBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup, dest, schedAt, distanceKm, gamme]);
  const defBoost = useCallback(
    (forPrice: number) =>
      Math.max(
        ctx?.boostMin ?? 10,
        rnd5(forPrice * (ctx?.boostDefaultRate ?? 0.1))
      ),
    [ctx]
  );
  const offerPrice = price + (boostOn ? boostAmt : 0);
  // Prix PÉRIMÉ : recalcul en cours OU les quotes ne correspondent plus au
  // trajet courant (adresse modifiée puis retour à l'écran prix) → on n'affiche
  // jamais l'ancien prix, on montre un loader.
  // « Périmé » = uniquement pendant le calcul d'un NOUVEAU trajet. Un raffinement
  // OSRM met à jour les devis en silence → le prix ne repasse jamais en loader.
  const priceStale = pricing;

  const pickGamme = (g: Gamme) => {
    setGamme(g);
    const q = quotes?.[g];
    if (q) {
      setPrice(q.recommended);
      if (boostOn) setBoostAmt(defBoost(q.recommended));
    }
  };
  const stepPrice = (dir: 1 | -1) => {
    const step = ctx?.priceStep ?? 20;
    const floor = quote?.floor ?? 0;
    setPrice((p) => {
      const np = Math.max(floor, p + dir * step);
      if (boostOn) setBoostAmt(defBoost(np));
      return np;
    });
  };

  /* ───────── Demande (+ file hors-ligne, maquette offbanner) ───────── */
  const buildPayload = useCallback(
    (pickupTextOverride?: string | null) => {
      if (!pickup || !dest) return null;
      // Le chauffeur doit voir la VRAIE adresse de départ — jamais « Ma position
      // actuelle ». On privilégie l'adresse résolue (override ou texte du repère) ;
      // repli neutre seulement si le géocodage est indisponible (hors ligne).
      const pickupText = pickup.gps
        ? (pickupTextOverride ?? pickup.text ?? "Point de départ (GPS)")
        : pickup.text;
      return {
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_text: pickupText,
        dest_lat: dest.lat,
        dest_lng: dest.lng,
        dest_text: dest.text,
        distance_km: distanceKm,
        proposed_price_da: price,
        payment_method: payMode,
        gamme,
        boost_da: boostOn ? boostAmt : 0,
        female_only: femaleOnly,
        proxy_name: prox?.name ?? null,
        proxy_phone: prox?.phone ?? null,
        operation_id: `drv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        quote_id: quoteId,
      };
    },
    [
      pickup,
      dest,
      distanceKm,
      price,
      payMode,
      gamme,
      boostOn,
      boostAmt,
      femaleOnly,
      prox,
      quoteId,
    ]
  );

  const refreshActive = useCallback(async () => {
    const ride = await getDriveActiveRide();
    setActive(ride);
    return ride;
  }, []);

  // Reprise du TRAJET depuis une course : quand la page est rechargée alors
  // qu'une course « searching » est en cours, le trajet n'est pas en mémoire
  // côté composant. En revenant à l'écran prix (annulation / échec carte) on
  // re-remplit départ/arrivée/gamme/paiement à partir de la course → on atterrit
  // sur l'écran PRIX (et pas sur l'accueil). Le prix se ré-estime pour le trajet.
  const restoreTrajectoryFrom = useCallback((r: DriveActiveRide) => {
    if (r.pickup_lat == null || r.dest_lat == null) return;
    setPickup({
      lat: r.pickup_lat,
      lng: r.pickup_lng!,
      text: r.pickup_text,
      gps: false,
    });
    setDest({ lat: r.dest_lat, lng: r.dest_lng!, text: r.dest_text });
    setGamme((r.gamme as Gamme) ?? "classic");
    setPrice(r.proposed_price_da);
    setPayMode((r.payment_method as "cash" | "card" | "coligo_pay") ?? "cash");
  }, []);

  const submitRequest = async () => {
    // Garde synchrone : un 2ᵉ tap pendant que le 1ᵉʳ est en vol est ignoré.
    if (!pickup || !dest || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      setRequestError(null);
      // Départ GPS sans adresse encore résolue : on géocode MAINTENANT pour que le
      // chauffeur reçoive la vraie adresse (jamais « Ma position actuelle »).
      let pickupText = pickup.text;
      if (
        pickup.gps &&
        !pickupText &&
        typeof navigator !== "undefined" &&
        navigator.onLine
      ) {
        const r = await reverseGeocode({
          latitude: pickup.lat,
          longitude: pickup.lng,
          precise: true,
        }).catch(() => null);
        if (r?.ok && r.display) pickupText = r.display;
      }
      const payload = buildPayload(pickupText);
      if (!payload) return;
      // Hors connexion : demande en file Dexie, envoi auto au retour réseau (C8).
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await queueRideRequest(payload.operation_id, payload);
        setOfflineQueued(true);
        setScreen("ride");
        return;
      }
      setSubmitting(true);
      const res = await requestDriveRide(payload);
      if (!res.ok) {
        setRequestError(res.error ?? t("requestFailed"));
        return;
      }
      // CARTE : payer AVANT que la demande soit diffusée (Chargily Pay existant).
      if (payMode === "card" && res.rideId) {
        const checkout = await createRideCardCheckout(res.rideId);
        if (checkout.ok && checkout.url) {
          window.open(checkout.url, "_blank");
        } else {
          setRequestError(checkout.error ?? t("requestFailed"));
          await cancelDriveRide(res.rideId, "Paiement carte indisponible");
          return;
        }
      }
      await refreshActive();
      setScreen("ride");
    } catch {
      // Exception (réseau, Server Action en échec, action périmée après
      // déploiement…) : le bouton ne doit JAMAIS rester bloqué en chargement.
      // Message inline + bouton réactivé (le `finally` libère tout) → réessai.
      setRequestError(t("requestFailed"));
    } finally {
      // Libère le chargement ET le verrou dans TOUS les cas (succès, erreur,
      // exception, retour anticipé) → plus de spinner infini, ré-essai possible.
      setSubmitting(false);
      inFlightRef.current = false;
    }
  };

  // Pré-check de couverture (départ + arrivée) DÈS que les deux points sont
  // connus — pas seulement sur l'écran prix : le client doit voir « zone
  // indisponible » AVANT de choisir un prix, et le bouton « Continuer » est
  // bloqué. L'enforcement réel reste dans request_ride (mig 0169/0174).
  // Debounce 400 ms : le départ GPS s'affine plusieurs fois au démarrage.
  useEffect(() => {
    if (!pickup || !dest) {
      setZoneBlock(null);
      return;
    }
    let alive = true;
    setZoneJoined(false);
    const id = setTimeout(() => {
      void precheckDriveRoute({
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dest_lat: dest.lat,
        dest_lng: dest.lng,
      }).then((r) => {
        if (alive) setZoneBlock(r.ok ? null : (r.error ?? null));
      });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [pickup, dest]);

  // Rejoindre la liste d'attente pour la zone visée (l'arrivée). Le serveur
  // reverse-géocode wilaya/commune → l'admin voit la VRAIE zone, pas un point.
  const joinDriveWaitlist = useCallback(async () => {
    if (dest)
      await joinZoneWaitlist({
        service: "drive",
        lat: dest.lat,
        lng: dest.lng,
      });
    setZoneJoined(true);
  }, [dest]);

  // Envoi auto de la demande en file (Dexie) dès le retour du réseau.
  useEffect(() => {
    const flush = async () => {
      const pending = await getPendingRide();
      if (!pending) return;
      // Demande PÉRIMÉE : une course mise en file hors-ligne ne doit JAMAIS être
      // envoyée « longtemps après » (le client a changé d'avis, de position, de
      // plan). Au-delà de 3 min on l'ABANDONNE silencieusement au lieu de la
      // diffuser à un chauffeur 10 min plus tard. (Le serveur reste idempotent
      // via operation_id, mais on ne veut même pas tenter une demande obsolète.)
      const STALE_AFTER_MS = 3 * 60_000;
      if (Date.now() - pending.createdAt > STALE_AFTER_MS) {
        await clearPendingRide();
        setOfflineQueued(false);
        return;
      }
      setOfflineQueued(true);
      try {
        const res = await requestDriveRide(
          pending.payload as Parameters<typeof requestDriveRide>[0]
        );
        if (res.ok) {
          await clearPendingRide();
          setOfflineQueued(false);
          await refreshActive();
          setScreen("ride");
        }
      } catch {
        /* réessaiera au prochain retour réseau */
      }
    };
    if (typeof navigator !== "undefined" && navigator.onLine) void flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [refreshActive]);

  const resetAll = useCallback(() => {
    setActive(null);
    setScreen("home");
    setDest(null);
    setPrice(0);
    setQuotes(null);
    setBoostOn(false);
    setFemaleOnly(false);
    setProx(null);
    setPayMode("cash");
    setGamme("classic");
    setOfflineQueued(false);
  }, []);

  /* ───────── Assistant : trajet confirmé → écran prix ─────────
     Le lieu a déjà été confirmé dans la barre (DriveAiBar). Ici on pré-remplit
     le trajet + les options et on passe à l'écran prix, où le client choisit
     prix/paiement et déclenche lui-même la demande (rien ne part au réseau
     automatiquement). Gamme appliquée directement ; « femme au volant »
     seulement si la cliente est éligible (sinon request_ride rejette). */
  const applyAiDraft = useCallback(
    (d: DriveIntentDraft) => {
      setPickup((cur) =>
        d.pickup.text
          ? { lat: d.pickup.lat, lng: d.pickup.lng, text: d.pickup.text }
          : (cur ?? {
              lat: d.pickup.lat,
              lng: d.pickup.lng,
              text: null,
              gps: true,
            })
      );
      setDest({
        lat: d.destination.lat,
        lng: d.destination.lng,
        text: d.destination.text,
      });
      setGamme(d.gamme);
      setFemaleOnly(
        d.female_only && !!ctx?.femaleFilterEnabled && !!ctx?.isFemaleVerified
      );
      setPrice(0);
      setRequestError(null);
      setScreen("price");
    },
    [ctx]
  );

  // On n'attend QUE le contexte (cache TanStack → instantané au retour). La
  // course active est vérifiée en arrière-plan : l'écran d'accueil s'affiche
  // tout de suite et bascule sur la course si une est en cours.
  if (!ctx) {
    return (
      <div className="grid min-h-[70vh] place-items-center bg-[var(--d-page)]">
        <Loader2 className="size-6 animate-spin" style={{ color: VIOLET }} />
      </div>
    );
  }

  /* ════════════════ ÉCRAN COURSE (recherche → fin) ════════════════ */
  if (screen === "ride") {
    return (
      <DriveRide
        ctx={ctx}
        active={active}
        offlineQueued={offlineQueued}
        refreshActive={refreshActive}
        onExit={resetAll}
        onBackToPrice={() => {
          // Course reprise (trajet pas en mémoire) → on restaure le trajet exact
          // pour revenir à l'écran PRIX plutôt qu'à l'accueil.
          if (!dest && active) restoreTrajectoryFrom(active);
          setActive(null);
          setScreen("price");
        }}
        onCardFailed={() => {
          // Webhook Chargily : paiement échoué → demande déjà annulée côté
          // serveur. Retour direct au choix de gamme, trajet conservé (restauré
          // depuis la course si on l'avait perdu après un rechargement).
          if (!dest && active) restoreTrajectoryFrom(active);
          setActive(null);
          setRequestError(t("price.cardFailed"));
          setScreen("price");
        }}
      />
    );
  }

  /* ════════════════ CHOIX SUR LA CARTE (épingle centrale) ════════════════ */
  if (screen === "mappick") {
    return (
      <MapPickScreen
        forWhat={mapPickFor}
        recents={ctx.recents}
        initial={
          mapPickFor === "dep"
            ? (pickup ?? undefined)
            : (dest ?? pickup ?? undefined)
        }
        onBack={() => setScreen(dest || mapPickFor === "dep" ? "home" : "home")}
        onConfirm={(p) => {
          if (mapPickFor === "dep") setPickup({ ...p, gps: false });
          else setDest(p);
          setScreen("home");
        }}
      />
    );
  }

  /* ════════════════ PRIX + GAMMES + OPTIONS ════════════════ */
  if (screen === "price" && pickup && dest) {
    const floorLabel = !quote
      ? null
      : price === quote.mini
        ? t("price.tierMiniHint")
        : price === quote.fast
          ? t("price.tierFastHint")
          : price < quote.recommended
            ? t("price.belowReco", { reco: quote.recommended })
            : price === quote.recommended
              ? t("price.atReco")
              : t("price.aboveReco", { reco: quote.recommended });
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-[var(--d-surface)]">
        {/* Carte du trajet (haut d'écran, maquette s-price) */}
        <div className="relative h-[196px] shrink-0 bg-[var(--d-page)]">
          <DriveMap
            markers={[
              { id: "me", pos: pickup, kind: "me", label: "A" },
              { id: "dest", pos: dest, kind: "pin", label: "B" },
            ]}
            route={route?.path ?? [pickup, dest]}
            padding={{ top: 40, bottom: 30, left: 50, right: 50 }}
            className="absolute inset-0"
          />
          <button
            type="button"
            onClick={() => setScreen("home")}
            className="absolute top-3 left-4 z-10 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
            aria-label={t("back")}
          >
            <ChevronLeft className="size-5" />
          </button>
        </div>

        <div className="drive-jakarta -mt-4 flex-1 overflow-y-auto rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3.5 pb-8">
          <div className="mx-auto mb-4 h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />
          {/* Départ / destination (rail pointillé) */}
          <Leg
            label={t("departure")}
            value={
              pickup.gps
                ? `${t("myPosition")}${pickup.text ? ` · ${pickup.text}` : ""}`
                : (pickup.text ?? "—")
            }
            start
          />
          <Leg label={t("destination")} value={dest.text ?? "—"} />

          {/* Offre « Bienvenue » 1ʳᵉ course : ancre barrée + code appliqué.
              Ancrage cosmétique (le client paie le prix réel = ce que touche
              le chauffeur ; coût plateforme nul). Désactivable côté super-admin. */}
          {welcome?.isNew && welcome.save > 0 && (
            <div className="mt-3 flex items-center gap-3 rounded-[16px] border-[1.5px] border-[#FF2D7A]/30 bg-[#FFF0F6] px-3.5 py-2.5">
              <span className="text-[20px]">🎁</span>
              <div className="flex-1">
                <p className="text-[12.5px] font-extrabold text-[#FF2D7A]">
                  {t("price.welcomeTitle", { code: welcome.code ?? "" })}
                </p>
                <p className="text-[11px] font-semibold text-[var(--d-muted)]">
                  <span className="line-through">
                    {formatDA(welcome.anchor)}
                  </span>{" "}
                  → <b>{formatDA(welcome.pay)}</b> ·{" "}
                  {t("price.welcomeSave", { save: formatDA(welcome.save) })}
                </p>
              </div>
            </div>
          )}

          {/* Réservation programmée — masquée tant que le super-admin ne l'a pas
              activée (drive_scheduled_enabled). */}
          {ctx.scheduledEnabled && (
            <button
              type="button"
              onClick={() => {
                setSchedDone(false);
                setSchedMsg(null);
                setSchedOpen(true);
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-[var(--d-line)] py-2.5 text-[13px] font-bold"
              style={{ color: VIOLET }}
            >
              <CalendarClock className="size-4" />
              {t("price.scheduleCta")}
            </button>
          )}
          {schedOpen && (
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
              onClick={() => !schedBusy && setSchedOpen(false)}
            >
              <div
                className="w-full max-w-md rounded-t-[24px] bg-[var(--d-surface)] p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="mb-1 text-[15px] font-extrabold">
                  {t("price.scheduleTitle")}
                </p>
                <p className="mb-3 text-[12px] text-[var(--d-muted)]">
                  {t("price.scheduleHint")}
                </p>
                {schedDone ? (
                  <p className="py-4 text-center text-[14px] font-bold text-[var(--d-go,#16A34A)]">
                    {t("price.scheduleOk")}
                  </p>
                ) : (
                  <>
                    <input
                      type="datetime-local"
                      value={schedAt}
                      min={new Date(
                        Date.now() +
                          (ctx.scheduledLeadMin + 1) * 60_000 -
                          new Date().getTimezoneOffset() * 60_000
                      )
                        .toISOString()
                        .slice(0, 16)}
                      onChange={(e) => setSchedAt(e.target.value)}
                      className="w-full rounded-[12px] border-[1.5px] border-[var(--d-line)] bg-[var(--d-soft)] px-3 py-2.5 text-[14px] font-semibold"
                    />
                    {schedMsg && (
                      <p className="mt-2 text-[12px] font-semibold text-[#E5484D]">
                        {schedMsg}
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={!schedAt || schedBusy}
                      onClick={submitSchedule}
                      className="mt-3 w-full rounded-[14px] py-3 text-[14px] font-extrabold text-white disabled:opacity-50"
                      style={{ background: VIOLET }}
                    >
                      {schedBusy ? "…" : t("price.scheduleConfirm")}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="mt-1 mb-3.5 flex gap-2">
            {/* Affichage INSTANTANÉ : estimation à vol d'oiseau tout de suite,
                affinée en silence par OSRM (jamais de loader d'attente). */}
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--d-soft)] px-3 py-1.5 text-[12.5px] font-bold">
              <Route className="size-3.5" /> {distanceLabel} km
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--d-soft)] px-3 py-1.5 text-[12.5px] font-bold">
              <Clock className="size-3.5" /> ~{etaMin} min
            </span>
          </div>

          {/* Gammes : cards carrées défilables (photos maquette) */}
          <div className="-mx-1 mb-3 flex [scrollbar-width:none] gap-2 overflow-x-auto px-1 pb-1.5">
            {(["classic", "confort", "moto"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => pickGamme(g)}
                className="relative flex w-[108px] shrink-0 flex-col items-center rounded-[18px] border-[1.5px] px-2 pt-3 pb-2.5 text-center"
                style={
                  gamme === g
                    ? {
                        borderColor: VIOLET,
                        background: "var(--d-accent)",
                        boxShadow: "0 8px 20px -10px rgba(91,91,230,.42)",
                      }
                    : { borderColor: "var(--d-line)", background: "#fff" }
                }
              >
                {g === "confort" && (
                  /* Climatisation incluse dans la gamme Confort */
                  <span className="absolute top-1.5 right-1.5 flex size-[22px] items-center justify-center rounded-full bg-[#E3F1FF]">
                    <Snowflake className="size-3.5 text-[#1E88E5]" />
                  </span>
                )}
                {g === "moto" && (
                  /* Moto : éclair = vitesse, gain de temps dans la circulation */
                  <span className="absolute top-1.5 right-1.5 flex size-[22px] items-center justify-center rounded-full bg-[#FFF0E0]">
                    <Zap className="size-3.5 fill-[#F97316] text-[#F97316]" />
                  </span>
                )}
                <Image
                  src={GAMME_IMG[g]}
                  alt={t(`gammes.${g}`)}
                  width={88}
                  height={62}
                  className="pointer-events-none h-[62px] w-[88px] object-contain"
                />
                <b className="drive-sora mt-1 text-[13px]">
                  {t(`gammes.${g}`)}
                </b>
                <span className="mt-0.5">
                  <b className="text-[12px]" style={{ color: VIOLET }}>
                    {quotes ? formatDA(quotes[g].recommended) : "…"}
                  </b>
                  <span className="block text-[9px] font-semibold text-[var(--d-muted)]">
                    {t("price.recommended")}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* Moyen de paiement — choisi ICI (maquette §2.2). Coligo Pay
              affiche le SOLDE ; vide → désactivé ; partiel → accepté, le
              complément se règle en espèces au chauffeur (mig 0163). */}
          <p className="mb-2 text-[13.5px] font-bold">{t("price.payTitle")}</p>
          <div className="mb-3 flex gap-2">
            {(
              [
                ["cash", t("pay.cash")],
                ["card", t("pay.card")],
                ["coligo_pay", "Coligo Pay"],
              ] as const
            ).map(([m, label]) => {
              const cpayEmpty = m === "coligo_pay" && ctx.walletBalance <= 0;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={cpayEmpty}
                  onClick={() => setPayMode(m)}
                  className="flex-1 rounded-[12px] border-[1.5px] px-1.5 py-2.5 text-[12px] font-bold disabled:opacity-50"
                  style={
                    payMode === m
                      ? {
                          borderColor: VIOLET,
                          background: "var(--d-accent)",
                          color: VIOLET,
                        }
                      : {
                          borderColor: "var(--d-line)",
                          color: "var(--d-muted)",
                        }
                  }
                >
                  {label}
                  {m === "coligo_pay" && (
                    <span
                      className="block text-[10.5px] font-extrabold"
                      style={cpayEmpty ? { color: "#E5484D" } : { color: GO }}
                    >
                      {formatDA(ctx.walletBalance)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Solde Coligo Pay partiel : le complément ira en ESPÈCES au
              chauffeur — ou recharger pour couvrir toute la course. */}
          {payMode === "coligo_pay" && ctx.walletBalance < offerPrice && (
            <div className="mb-3 rounded-[14px] border-[1.5px] border-dashed border-[var(--d-line)] bg-[var(--d-soft)] px-3 py-2.5">
              <p className="text-[12px] leading-relaxed font-semibold">
                {t("price.cpayPartial", {
                  wallet: ctx.walletBalance,
                  cash: Math.max(0, offerPrice - ctx.walletBalance),
                })}
              </p>
              <button
                type="button"
                onClick={() => router.push("/coligo-pay")}
                className="mt-1.5 text-[12px] font-extrabold underline underline-offset-2"
                style={{ color: VIOLET }}
              >
                {t("price.cpayRecharge")}
              </button>
            </div>
          )}

          {/* Votre offre (prix recommandé pré-rempli, ± pas de 20) */}
          <div className="mb-3 rounded-[18px] bg-[var(--d-soft)] p-4 text-center">
            <p className="text-xs font-semibold text-[var(--d-muted)]">
              {t("price.offerLabel")}
            </p>
            {/* Fourchette intelligente : mini / recommandé / rapide (mig 0149) */}
            {quote && (
              <div className="mt-2 flex gap-1.5">
                {(
                  [
                    ["mini", quote.mini, t("price.tierMini")],
                    ["reco", quote.recommended, t("price.tierReco")],
                    ["fast", quote.fast, t("price.tierFast")],
                  ] as const
                ).map(([k, v, label]) => {
                  const on = price === v;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setPrice(v);
                        if (boostOn) setBoostAmt(defBoost(v));
                      }}
                      className="flex flex-1 flex-col items-center rounded-[12px] border-[1.5px] px-1 py-2"
                      style={
                        on
                          ? {
                              borderColor: VIOLET,
                              background: "#fff",
                              color: VIOLET,
                            }
                          : {
                              borderColor: "var(--d-line)",
                              background: "var(--d-surface)",
                              color: "var(--d-muted)",
                            }
                      }
                    >
                      <span className="text-[10px] font-bold">{label}</span>
                      <b className="drive-sora text-[13px] font-extrabold">
                        {v} DA
                      </b>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="my-1.5 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => stepPrice(-1)}
                disabled={priceStale}
                className="grid size-[46px] place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-2xl font-bold disabled:opacity-40"
                style={{ color: VIOLET }}
              >
                −
              </button>
              <div
                className="drive-sora flex min-w-[140px] items-center justify-center text-[38px] font-extrabold tracking-[-1.5px]"
                style={boostOn ? { color: GO } : undefined}
              >
                {/* Anti-prix-périmé : pendant le recalcul (adresse changée), on
                    EFFACE l'ancien prix et on montre un loader — jamais un prix
                    qui ne correspond plus au trajet courant. */}
                {priceStale ? (
                  <Loader2 className="size-7 animate-spin text-[var(--d-muted)]" />
                ) : (
                  <>
                    {offerPrice}{" "}
                    <small className="text-[17px] text-[var(--d-muted)]">
                      DA
                    </small>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => stepPrice(1)}
                disabled={priceStale}
                className="grid size-[46px] place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-2xl font-bold disabled:opacity-40"
                style={{ color: VIOLET }}
              >
                +
              </button>
            </div>
            <p className="text-[11.5px] text-[var(--d-muted)]">
              {floorLabel}
              {boostOn && (
                <span className="font-bold" style={{ color: GO }}>
                  {" "}
                  · ⚡ {t("price.boostIncluded", { amount: boostAmt })}
                </span>
              )}
            </p>
            {quote && quote.high > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-1 text-[11px] font-bold text-[var(--d-muted)]">
                {t("price.similar")}{" "}
                <b className="text-[var(--d-ink)]">
                  {quote.low}–{quote.high} DA
                </b>
              </p>
            )}
          </div>

          {/* Booster (vert) */}
          <OptRow
            color={GO}
            soft="rgba(22,179,100,.12)"
            icon={<Zap className="size-[18px]" />}
            title={t("boost.title")}
            sub={t("boost.sub")}
            on={boostOn}
            onToggle={() => {
              setBoostOn((b) => {
                if (!b) setBoostAmt(defBoost(price));
                return !b;
              });
            }}
          />
          {boostOn && (
            <div className="flex items-center justify-between py-2 pl-11">
              <span className="text-xs font-semibold text-[var(--d-muted)]">
                {t("boost.amount")}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setBoostAmt((a) =>
                      Math.max(ctx.boostMin, a - ctx.boostStep)
                    )
                  }
                  className="grid size-10 place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-xl font-bold"
                  style={{ color: VIOLET }}
                >
                  −
                </button>
                <span className="min-w-[74px] text-center text-[13px] font-semibold text-[var(--d-muted)]">
                  <b className="drive-sora text-[20px] text-[var(--d-ink)]">
                    {boostAmt}
                  </b>{" "}
                  DA
                </span>
                <button
                  type="button"
                  onClick={() => setBoostAmt((a) => a + ctx.boostStep)}
                  className="grid size-10 place-items-center rounded-full border-[1.5px] border-[var(--d-line)] bg-[var(--d-surface)] text-xl font-bold"
                  style={{ color: VIOLET }}
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* Femme au volant (rose) — visible pour tous, actif pour les
              clientes au profil vérifié (le serveur ré-applique la règle). */}
          {ctx.femaleFilterEnabled && (
            <OptRow
              color={ROSE}
              soft="rgba(236,72,153,.13)"
              icon={<User className="size-[18px]" />}
              title={t("female.title")}
              sub={
                !ctx.isFemaleVerified
                  ? t("female.subLocked")
                  : femaleOnly
                    ? t("female.subOn")
                    : t("female.subOff", { count: ctx.femaleOnlineCount })
              }
              on={femaleOnly}
              disabled={!ctx.isFemaleVerified}
              onToggle={() => setFemaleOnly((v) => !v)}
            />
          )}

          {/* Pour un proche */}
          <OptRow
            color="var(--d-ink)"
            soft="var(--d-soft)"
            icon={<Users className="size-[18px]" />}
            title={t("prox.title")}
            sub={prox ? t("prox.subOn", { name: prox.name }) : t("prox.subOff")}
            on={!!prox}
            onToggle={() => {
              if (prox) setProx(null);
              else setProxOpen(true);
            }}
          />

          {requestError && (
            <p
              className="mt-2 rounded-[12px] bg-[rgba(229,72,77,.1)] px-3 py-2 text-center text-xs font-bold"
              style={{ color: "#E5484D" }}
            >
              {requestError}
            </p>
          )}
          {zoneBlock && (
            <ZoneBlockNotice
              message={zoneBlock}
              joined={zoneJoined}
              onJoin={joinDriveWaitlist}
              className="mt-2"
            />
          )}
          {!zoneBlock && pickup && (
            <AvailabilityNotice
              service="drive"
              lat={pickup.lat}
              lng={pickup.lng}
              className="mt-2"
            />
          )}
          <PrimaryBtn
            onClick={submitRequest}
            disabled={submitting || priceStale || !quote || !!zoneBlock}
          >
            {submitting || priceStale ? (
              <Loader2 className="size-5 animate-spin" />
            ) : null}
            {priceStale
              ? t("price.recalculating")
              : t("price.propose", { price: offerPrice })}
          </PrimaryBtn>
        </div>

        <ProxModal
          open={proxOpen}
          onClose={() => setProxOpen(false)}
          onConfirm={(name, phone) => {
            setProx({ name, phone });
            setProxOpen(false);
          }}
        />
      </div>
    );
  }

  // Inverser départ ↔ arrivée (erreur de saisie) — le départ issu du swap
  // n'est plus « GPS » : il a été choisi explicitement.
  const swapPoints = () => {
    const oldPickup = pickup;
    setPickup(dest ? { ...dest, gps: false } : null);
    setDest(
      oldPickup
        ? {
            lat: oldPickup.lat,
            lng: oldPickup.lng,
            text: oldPickup.text ?? (oldPickup.gps ? t("myPosition") : null),
          }
        : null
    );
  };

  /* ════════════════ ACCUEIL DRIVE (trajet) ════════════════ */
  return (
    <div className="drive-jakarta drive-screen z-40 flex min-h-[100dvh] flex-col bg-[var(--d-page)]">
      {/* En-tête Coligo Drive — barre propre (PLUS DE CARTE EN FOND : l'écran
          s'ouvre instantanément, MapLibre n'est initialisé que sur les écrans
          choix-sur-carte / prix / course). */}
      <header className="px-5 pt-[calc(env(safe-area-inset-top)+1rem)] pb-1">
        <div className="flex items-center justify-between gap-2">
          <p
            className="drive-sora flex items-center gap-1.5 text-[13.5px] font-extrabold tracking-[0.5px] uppercase"
            style={{ color: VIOLET }}
          >
            <Car className="size-[18px]" /> Coligo Drive
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => router.push("/drive/historique")}
              className="flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-1.5 text-xs font-bold"
            >
              <History className="size-3.5" /> {t("history")}
            </button>
            <button
              type="button"
              onClick={() => setContactsOpen(true)}
              aria-label={t("sosContacts.title")}
              className="grid size-8 place-items-center rounded-full border border-[var(--d-line)] bg-[var(--d-surface)]"
              style={{ color: ROSE }}
            >
              <ShieldAlert className="size-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Contenu — mobile : 1 colonne ; desktop : formulaire À GAUCHE + carte de
          visualisation À DROITE (trajet A→B). */}
      <main className="flex-1 overflow-y-auto px-5 pb-24">
        <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,480px)_1fr]">
          <div className="min-w-0">
            <h1 className="drive-sora mt-3 text-[27px] leading-tight font-extrabold tracking-[-0.6px]">
              {t("home.title")}
            </h1>

            {/* Assistant IA : réserver en langage naturel (darija / ar / fr) */}
            <div className="mt-4">
              <DriveAiBar
                pickup={pickup ? { lat: pickup.lat, lng: pickup.lng } : null}
                onResolved={applyAiDraft}
                onConfirmingChange={setAiConfirming}
              />
            </div>

            {!aiConfirming && (
              <>
                {/* Carte formulaire de trajet (départ / arrivée). */}
                <div className="mt-3 rounded-[24px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4 shadow-[0_18px_44px_-30px_rgba(20,22,40,.5)]">
                  <div className="mb-2.5 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setDepOpen(true)}
                        className="mb-2 flex w-full items-center gap-3 rounded-[15px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-left"
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

                      <button
                        type="button"
                        onClick={() => {
                          setMapPickFor("dest");
                          setScreen("mappick");
                        }}
                        className="flex w-full items-center gap-3 rounded-[15px] border border-[var(--d-line)] bg-[var(--d-soft)] px-3.5 py-3 text-left"
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
                            {dest?.text ?? t("home.whereTo")}
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
                      className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] shadow-sm disabled:opacity-40"
                      style={{ color: VIOLET }}
                    >
                      <ArrowUpDown className="size-[18px]" />
                    </button>
                  </div>

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
                  <PrimaryBtn
                    onClick={() => setScreen("price")}
                    disabled={!pickup || !dest || !!zoneBlock}
                    className="!mt-1"
                  >
                    {t("home.continue")}
                  </PrimaryBtn>
                </div>

                {/* Destinations récentes */}
                <div className="mt-3">
                  {ctx.recents.map((r) => (
                    <button
                      key={r.text}
                      type="button"
                      onClick={() =>
                        setDest({ lat: r.lat, lng: r.lng, text: r.text })
                      }
                      className="flex w-full items-center gap-3 border-b border-[var(--d-line)] px-0.5 py-2.5 text-left text-[13.5px] font-semibold last:border-b-0"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--d-soft)]">
                        <Clock className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{r.text}</span>
                    </button>
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

          {/* Colonne carte (desktop uniquement) — visualisation du trajet A→B,
              se met à jour dès qu'un départ/arrivée est choisi. */}
          {isDesktop && (
            <div className="hidden lg:block">
              <div className="sticky top-4 h-[calc(100dvh-150px)] overflow-hidden rounded-[24px] border border-[var(--d-line)]">
                <DriveMap
                  markers={[
                    ...(pickup
                      ? [
                          {
                            id: "me",
                            pos: pickup,
                            kind: "me" as const,
                            label: "A" as const,
                          },
                        ]
                      : []),
                    ...(dest
                      ? [
                          {
                            id: "dest",
                            pos: dest,
                            kind: "pin" as const,
                            label: "B" as const,
                          },
                        ]
                      : []),
                  ]}
                  route={pickup && dest ? [pickup, dest] : null}
                  padding={{ top: 60, bottom: 60, left: 60, right: 60 }}
                  className="absolute inset-0"
                />
              </div>
            </div>
          )}
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

/* ─────────────── Notice « zone indisponible » + « Prévenez-moi » ─────────────── */

function ZoneBlockNotice({
  message,
  joined,
  onJoin,
  className,
}: {
  message: string;
  joined: boolean;
  onJoin: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-center",
        className
      )}
    >
      <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-amber-800">
        <AlertTriangle className="size-3.5" />
        {message}
      </p>
      {joined ? (
        <p className="mt-1.5 text-[12px] font-bold text-emerald-700">
          On vous prévient dès l&apos;ouverture !
        </p>
      ) : (
        <button
          type="button"
          onClick={onJoin}
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white"
        >
          <BellRing className="size-3.5" />
          Prévenez-moi
        </button>
      )}
    </div>
  );
}

/* ─────────────── Écran : choix sur la carte (épingle centrale fixe) ─────────────── */

// Cache module des favoris : chargés une fois, réaffichés INSTANTANÉMENT aux
// ouvertures suivantes de la recherche (pas de round-trip à chaque ouverture).
let FAV_CACHE: FavPlace[] | null = null;

function MapPickScreen({
  forWhat,
  initial,
  recents = [],
  onBack,
  onConfirm,
}: {
  forWhat: "dep" | "dest";
  initial?: Pt;
  /** Destinations récentes du client (instantané, via le contexte Drive). */
  recents?: { text: string; lat: number; lng: number }[];
  onBack: () => void;
  onConfirm: (p: { lat: number; lng: number; text: string | null }) => void;
}) {
  const t = useTranslations("drive.mappick");
  // Debounces pilotés par /admin/config (reverse_geocode/address_search) —
  // RÈGLE 2 : aucune valeur en dur. Défauts tant que la config n'est pas chargée.
  const geoCfg = useGeoClientConfig();
  const [center, setCenter] = useState<LatLng | null>(initial ?? null);
  const [addr, setAddr] = useState<string | null>(initial?.text ?? null);
  const [resolving, setResolving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Numéro de séquence du dernier déplacement : une réponse en retard (lieu
  // gazetteer ou rue) ne doit jamais écraser une position plus récente.
  const geoSeqRef = useRef(0);
  // Quand le client CHOISIT une suggestion, on remet son libellé dans l'input —
  // ce qui retriggerait la recherche et RÉOUVRIRAIT la liste. Ce drapeau saute
  // la recherche UNE fois après un choix → la liste ne se réaffiche pas tant que
  // le client ne MODIFIE pas son texte.
  const pickedRef = useRef(false);
  // Choix EXPLICITE d'un lieu (suggestion / favori / récent / valeur initiale) :
  // le recentrage de la carte (flyTo) émet un `moveend` → `onMove`. Sans ce
  // drapeau, ce déplacement programmatique repasserait l'adresse à « … » et
  // re-géocoderait, RÉGRISANT « Confirmer ce point ». On consomme ce drapeau au
  // 1ᵉʳ `onMove` qui suit le choix : le libellé déjà connu est CONSERVÉ. Les
  // déplacements MANUELS suivants re-géocodent normalement. Initialisé à true
  // quand on entre avec un libellé (édition d'un point déjà choisi).
  const movePickRef = useRef<boolean>(Boolean(initial?.text));
  // Filet anti-blocage du « … » : garantit que `resolving` finit toujours par
  // retomber, même si le géocodage hang/échoue (le libellé tombe alors sur les
  // coordonnées GPS et « Confirmer ce point » redevient actif).
  const resolveSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recherche d'adresse SUR la carte (suggestions, debounce configurable).
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<
    {
      display: string;
      secondary?: string;
      lat: number;
      lng: number;
      kind?: "merchant" | "google";
    }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // « Tes lieux » : affiché SEULEMENT au focus de la barre (chargé en arrière-
  // plan), jamais en permanence → ne masque pas le curseur central. Se ferme à
  // l'interaction carte ou via le bouton ✕.
  const [favOpen, setFavOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<
    (LatLng & { zoom?: number }) | null
  >(null);

  // Favoris « Tes lieux » : étoile pour sauvegarder, accès rapide quand vide.
  // Initialisés depuis le cache module → AFFICHAGE INSTANTANÉ (pas d'attente).
  const [favorites, setFavorites] = useState<FavPlace[]>(FAV_CACHE ?? []);
  const [favCells, setFavCells] = useState<Set<string>>(
    new Set(
      (FAV_CACHE ?? []).map((f) => `${f.lat.toFixed(4)},${f.lng.toFixed(4)}`)
    )
  );
  useEffect(() => {
    void listFavoritePlaces().then((favs) => {
      FAV_CACHE = favs;
      setFavorites(favs);
      setFavCells(
        new Set(favs.map((f) => `${f.lat.toFixed(4)},${f.lng.toFixed(4)}`))
      );
    });
  }, []);
  const favKey = (la: number, ln: number) =>
    `${la.toFixed(4)},${ln.toFixed(4)}`;
  const toggleFav = (r: { display: string; lat: number; lng: number }) => {
    const k = favKey(r.lat, r.lng);
    const on = !favCells.has(k);
    setFavCells((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
    setFavorites((list) =>
      on
        ? [
            { label: r.display, lat: r.lat, lng: r.lng },
            ...list.filter((f) => favKey(f.lat, f.lng) !== k),
          ]
        : list.filter((f) => favKey(f.lat, f.lng) !== k)
    );
    void toggleFavoritePlace({ lat: r.lat, lng: r.lng, label: r.display, on });
  };

  useEffect(() => {
    // Le client vient de CHOISIR une adresse → on ne relance pas la recherche
    // (sinon la liste se rouvre). Réinitialise le drapeau pour la frappe suivante.
    if (pickedRef.current) {
      pickedRef.current = false;
      setSearching(false);
      return;
    }
    const q = searchQ.trim();
    if (q.length < 3) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        // Biais de proximité : le centre courant départage les homonymes.
        const res = await geocodeSearch({
          q,
          lat: center?.lat,
          lng: center?.lng,
        });
        if (res.ok) {
          setSearchResults(res.results);
          setSearchOpen(true);
        }
      } finally {
        setSearching(false);
      }
    }, geoCfg.addressSearchDebounceMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQ, geoCfg.addressSearchDebounceMs]);

  // Suggestion choisie → l'épingle se recale EXACTEMENT sur ce lieu (le
  // client peut ensuite affiner au doigt — moveend ré-émettra la position).
  const pickSuggestion = (r: { display: string; lat: number; lng: number }) => {
    pickedRef.current = true; // saute la recherche déclenchée par setSearchQ
    movePickRef.current = true; // le moveend du flyTo ne doit pas effacer ce libellé
    setSearchOpen(false);
    setSearchResults([]); // la liste disparaît et ne se rouvre pas au focus
    setSearchQ(r.display);
    setAddr(r.display);
    setResolving(false); // adresse connue → « Confirmer ce point » actif tout de suite
    setCenter({ lat: r.lat, lng: r.lng });
    setFocusTarget({ lat: r.lat, lng: r.lng, zoom: 17 });
    // Apprentissage : ce choix fait remonter ce lieu pour les recherches futures.
    void recordPlacePick({ lat: r.lat, lng: r.lng, label: r.display });
  };

  // Repli : si la rue est introuvable, on affiche les coordonnées GPS EXACTES
  // du point sélectionné (et on les garde comme libellé du point).
  const gpsLabel = (c: LatLng) => `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;

  const onMove = useCallback(
    (c: LatLng) => {
      // Interaction carte (glisser/zoom pour positionner) → on referme les
      // panneaux pour dégager le curseur central.
      setSearchOpen(false);
      setFavOpen(false);
      setCenter(c);
      // Choix explicite (suggestion/favori/récent/init) : le flyTo a émis ce
      // moveend, mais le libellé est DÉJÀ connu → on le conserve, on ne repasse
      // pas par « … » et on ne re-géocode pas. Les déplacements MANUELS suivants
      // (movePickRef remis à false) re-géocoderont normalement.
      if (movePickRef.current) {
        movePickRef.current = false;
        setResolving(false);
        return;
      }
      const seq = ++geoSeqRef.current;
      // On efface l'adresse du point PRÉCÉDENT → pendant la résolution on affiche
      // « … », jamais l'ancienne adresse ni une approximation.
      setAddr(null);
      setResolving(true);
      // FILET anti-blocage : on ne reste JAMAIS coincé sur « … » / bouton grisé.
      // reverseGeocode est borné (~2,5 s côté serveur) ; ce filet ne sert que si
      // l'action elle-même traîne au-delà.
      if (resolveSafetyRef.current) clearTimeout(resolveSafetyRef.current);
      resolveSafetyRef.current = setTimeout(() => {
        if (seq === geoSeqRef.current) setResolving(false);
      }, 3000);
      // ADRESSE PRÉCISE DIRECTE : on ne montre PLUS d'abord le « lieu le plus
      // proche » du gazetteer (qui pouvait être un POI éloigné/erroné, ex. une
      // plage), puis la corriger. On résout DIRECTEMENT l'adresse de RUE
      // (reverseGeocode précis) et on n'affiche QUE celle-là → la bonne adresse
      // d'emblée, sans valeur temporaire fausse. (reverseGeocode bascule déjà sur
      // le gazetteer EN INTERNE si Nominatim échoue → un seul libellé, le bon.)
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        async () => {
          try {
            const r = await reverseGeocode({
              latitude: c.lat,
              longitude: c.lng,
              precise: true,
            });
            // Réponse pour une position plus récente → on ignore (anti-rejeu).
            if (seq !== geoSeqRef.current) return;
            if (r?.ok && r.display) setAddr(r.display);
          } catch {
            /* échec → l'affichage retombe sur les coordonnées GPS exactes */
          } finally {
            if (seq === geoSeqRef.current) setResolving(false);
          }
          // Debounce court (≤ 200 ms) : reverseGeocode devient le chemin PRINCIPAL
          // (plus de phase 1 instantanée), on le déclenche donc vite.
        },
        Math.min(geoCfg.reverseGeocodeDebounceMs, 200)
      );
    },
    [geoCfg.reverseGeocodeDebounceMs]
  );

  // Nettoyage du filet anti-blocage au démontage.
  useEffect(
    () => () => {
      if (resolveSafetyRef.current) clearTimeout(resolveSafetyRef.current);
    },
    []
  );

  return (
    <div className="drive-jakarta drive-screen z-50 bg-[var(--d-page)]">
      <DriveMap
        markers={initial ? [{ id: "init", pos: initial, kind: "me" }] : []}
        interactive
        onMove={onMove}
        focusTarget={focusTarget}
      />
      <button
        type="button"
        onClick={onBack}
        className="absolute top-3 left-4 z-10 grid size-[42px] place-items-center rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-lg"
        aria-label="retour"
      >
        <ChevronLeft className="size-5" />
      </button>

      {/* Recherche d'adresse SUR la carte : suggestions, et la sélection
          recentre l'épingle EXACTEMENT sur le lieu choisi (affinable au
          doigt ensuite). */}
      <div className="absolute top-3 right-4 left-[68px] z-20">
        <div className="flex items-center gap-2 rounded-full border border-[var(--d-line)] bg-[var(--d-surface)] px-3.5 py-2.5 shadow-lg">
          <Search className="size-4 shrink-0 text-[var(--d-muted)]" />
          <input
            value={searchQ}
            onChange={(e) => {
              setSearchQ(e.target.value);
              setFavOpen(false);
            }}
            onFocus={() => {
              if (searchResults.length > 0) setSearchOpen(true);
              // Barre vide → on ouvre « Tes lieux » (sinon les résultats).
              if (searchQ.trim() === "") setFavOpen(true);
            }}
            placeholder={t("searchPh")}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:font-medium placeholder:text-[var(--d-muted)]"
          />
          {searching ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-[var(--d-muted)]" />
          ) : searchQ ? (
            <button
              type="button"
              aria-label="Effacer"
              onClick={() => {
                setSearchQ("");
                setSearchResults([]);
                setSearchOpen(false);
                setFavOpen(true); // barre vide → on re-propose « Tes lieux »
              }}
              className="shrink-0 text-[var(--d-muted)]"
            >
              ✕
            </button>
          ) : null}
        </div>
        {searchOpen && searchResults.length > 0 && (
          <ul className="mt-1.5 max-h-44 overflow-auto rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] py-1 shadow-xl">
            {searchResults.map((r, i) => (
              <li key={`${r.lat}-${r.lng}-${i}`} className="flex items-center">
                <button
                  type="button"
                  onClick={() => pickSuggestion(r)}
                  className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left text-[13px] font-semibold"
                >
                  <MapPin
                    className="mt-0.5 size-4 shrink-0"
                    style={{ color: VIOLET }}
                  />
                  <span className="min-w-0 flex-1">
                    {r.display}
                    {r.secondary && (
                      <small className="block text-[11px] font-medium text-[var(--d-muted)]">
                        {r.secondary}
                      </small>
                    )}
                  </span>
                  {/* Commerçant inscrit Coligo : badge automatique. */}
                  {r.kind === "merchant" && (
                    <span
                      className="mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wide"
                      style={{ background: "var(--d-accent)", color: VIOLET }}
                    >
                      Coligo
                    </span>
                  )}
                  {/* Résultat Google Maps (distinct des cartes gratuites OSM). */}
                  {r.kind === "google" && (
                    <span
                      className="mt-0.5 shrink-0 rounded-full border border-[var(--d-line)] px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wide text-[var(--d-muted)]"
                      title="Résultat Google Maps"
                    >
                      Google
                    </span>
                  )}
                </button>
                {/* Étoile : sauvegarder cette adresse dans « Tes lieux ». */}
                <button
                  type="button"
                  aria-label="Favori"
                  onClick={() => toggleFav(r)}
                  className="shrink-0 px-2.5 py-2.5"
                >
                  <Star
                    className="size-4"
                    style={{ color: VIOLET }}
                    fill={
                      favCells.has(`${r.lat.toFixed(4)},${r.lng.toFixed(4)}`)
                        ? VIOLET
                        : "none"
                    }
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* « Tes lieux » : favoris du client, accès rapide quand la barre est
            vide (comme Uber). Sélection = recentrage immédiat. */}
        {/* Accès rapide DIRECT quand la barre est vide : favoris (« Tes lieux »)
            + destinations récentes. Affiché d'emblée (pas besoin de focus) →
            le client retrouve ses lieux sans retaper. Instantané (favoris en
            cache + récents passés par le contexte). */}
        {searchQ.trim() === "" &&
          favOpen &&
          (favorites.length > 0 || recents.length > 0) && (
            <ul className="mt-1.5 max-h-44 overflow-auto rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] py-1 shadow-xl">
              {/* Bouton ✕ pour masquer « Tes lieux » manuellement (sinon il se
                  ferme à l'interaction carte). */}
              <li className="flex justify-end px-2 pt-0.5">
                <button
                  type="button"
                  aria-label="Masquer"
                  onClick={() => setFavOpen(false)}
                  className="p-1 text-[var(--d-muted)]"
                >
                  ✕
                </button>
              </li>
              {favorites.length > 0 && (
                <li className="px-3 pt-0.5 pb-1 text-[10px] font-extrabold tracking-wide text-[var(--d-muted)] uppercase">
                  {t("savedPlaces")}
                </li>
              )}
              {favorites.map((f, i) => (
                <li
                  key={`fav-${f.lat}-${f.lng}-${i}`}
                  className="flex items-center"
                >
                  <button
                    type="button"
                    onClick={() =>
                      pickSuggestion({
                        display: f.label,
                        lat: f.lat,
                        lng: f.lng,
                      })
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-[13px] font-semibold"
                  >
                    <Star
                      className="size-4 shrink-0"
                      style={{ color: VIOLET }}
                      fill={VIOLET}
                    />
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Retirer des favoris"
                    onClick={() =>
                      toggleFav({ display: f.label, lat: f.lat, lng: f.lng })
                    }
                    className="shrink-0 px-2.5 py-2.5 text-[var(--d-muted)]"
                  >
                    ✕
                  </button>
                </li>
              ))}
              {recents.length > 0 && (
                <li className="px-3 pt-2 pb-1 text-[10px] font-extrabold tracking-wide text-[var(--d-muted)] uppercase">
                  {t("recents")}
                </li>
              )}
              {recents
                .filter(
                  (r) =>
                    !favCells.has(`${r.lat.toFixed(4)},${r.lng.toFixed(4)}`)
                )
                .map((r, i) => (
                  <li
                    key={`rec-${r.lat}-${r.lng}-${i}`}
                    className="flex items-center"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        pickSuggestion({
                          display: r.text,
                          lat: r.lat,
                          lng: r.lng,
                        })
                      }
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-[13px] font-semibold"
                    >
                      <Clock className="size-4 shrink-0 text-[var(--d-muted)]" />
                      <span className="min-w-0 flex-1 truncate">{r.text}</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Favori"
                      onClick={() =>
                        toggleFav({ display: r.text, lat: r.lat, lng: r.lng })
                      }
                      className="shrink-0 px-2.5 py-2.5"
                    >
                      <Star
                        className="size-4"
                        style={{ color: VIOLET }}
                        fill="none"
                      />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        {searchOpen &&
          !searching &&
          searchResults.length === 0 &&
          searchQ.trim().length >= 3 && (
            <p className="mt-1.5 rounded-[14px] border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-2.5 text-center text-xs font-semibold text-[var(--d-muted)] shadow-xl">
              {t("noResults")}
            </p>
          )}
      </div>
      {/* Épingle centrale fixe (la carte se déplace dessous) */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-full">
        <div
          className="size-[22px] rounded-full border-4 border-white"
          style={{
            background: VIOLET,
            boxShadow: "0 6px 16px -4px rgba(91,91,230,.42)",
          }}
        />
        <div className="mx-auto h-3.5 w-[3px] rounded-sm bg-[var(--d-ink)]" />
        <div className="mx-auto mt-1 size-[7px] rounded-full bg-[rgba(8,9,15,.3)]" />
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-[26px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-4 pb-[max(24px,env(safe-area-inset-bottom))]">
        <p className="mb-1 text-[13px] text-[var(--d-muted)]">
          {forWhat === "dep" ? t("depLabel") : t("destLabel")}
        </p>
        <p className="drive-sora mb-0.5 min-h-[24px] text-[17px] font-extrabold">
          {center
            ? resolving
              ? "…"
              : (addr ?? t("gpsPoint", { coords: gpsLabel(center) }))
            : t("moveMap")}
        </p>
        {center && addr && !resolving && (
          <p className="mb-2 text-[11px] text-[var(--d-muted)] tabular-nums">
            GPS · {gpsLabel(center)}
          </p>
        )}
        <PrimaryBtn
          disabled={!center || resolving}
          onClick={() =>
            center &&
            onConfirm({
              lat: center.lat,
              lng: center.lng,
              text: addr ?? t("gpsPoint", { coords: gpsLabel(center) }),
            })
          }
        >
          {t("confirm")}
        </PrimaryBtn>
        <GhostBtn onClick={onBack}>{t("back")}</GhostBtn>
      </div>
    </div>
  );
}

/* ─────────────── Petits composants partagés ─────────────── */

function Leg({
  label,
  value,
  start,
}: {
  label: string;
  value: string;
  start?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center pt-1.5">
        <span
          className={cn(
            "size-2.5",
            start ? "rounded-full" : "rounded-[2px] bg-[var(--d-ink)]"
          )}
          style={start ? { background: VIOLET } : undefined}
        />
        {start && (
          <span
            className="my-0.5 w-[2px] flex-1 opacity-40"
            style={{
              minHeight: 18,
              background:
                "repeating-linear-gradient(to bottom,#0B0C12 0 4px,transparent 4px 9px)",
            }}
          />
        )}
      </div>
      <div className="flex-1 pb-2.5">
        <p className="text-[10.5px] font-semibold tracking-[0.3px] text-[var(--d-muted)] uppercase">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-bold">{value}</p>
      </div>
    </div>
  );
}

function OptRow({
  color,
  soft,
  icon,
  title,
  sub,
  on,
  disabled = false,
  onToggle,
}: {
  color: string;
  soft: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  on: boolean;
  /** Option visible mais verrouillée (ex. profil non vérifié). */
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between border-t border-[var(--d-line)] py-3"
      style={disabled ? { opacity: 0.55 } : undefined}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="grid size-[34px] shrink-0 place-items-center rounded-[11px]"
          style={{ background: soft, color }}
        >
          {icon}
        </span>
        <span className="min-w-0">
          <b
            className="block text-[13.5px]"
            style={{ color: color === "var(--d-ink)" ? undefined : color }}
          >
            {title}
          </b>
          <span className="block truncate text-[11px] text-[var(--d-muted)]">
            {sub}
          </span>
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-disabled={disabled}
        onClick={disabled ? undefined : onToggle}
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{
          background: on ? color : "var(--d-line)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <span
          className="absolute top-[3px] size-[22px] rounded-full bg-white shadow transition-all"
          style={{ left: on ? 23 : 3 }}
        />
      </button>
    </div>
  );
}

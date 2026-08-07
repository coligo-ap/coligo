"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { DriveHomeSkeleton } from "./drive-home-skeleton";
import {
  getPosition,
  watchPosition,
  type WatchHandle,
} from "@/lib/native/geolocation";
import { haversineKm } from "@/lib/delivery/distance";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import {
  readStoredLocation,
  readDriveDeparture,
  writeDriveDeparture,
} from "@/lib/customer/location-store";
import { reverseGeocode, routeEstimate } from "@/app/(customer)/actions";
import type { LatLng } from "./drive-map";
import { VIOLET, type SosContact } from "./drive-modals";
import { DriveRide } from "./drive-ride";
import { MapPickScreen } from "./drive-map-pick";
import { DrivePriceScreen } from "./drive-price-screen";
import { DriveHomeScreen } from "./drive-home-screen";
import type { Gamme, Pt, Screen, TripMode } from "./drive-types";
import { interWilayaInfo } from "@/lib/drive/interwilaya";
import {
  clearPendingRide,
  getPendingRide,
  queueRideRequest,
} from "@/lib/drive/offline-db";
import {
  cancelDriveRide,
  getDriveActiveRide,
  getDriveContext,
  getDriveQuotes,
  getFirstRideOffer,
  getSosContacts,
  issueDriveQuote,
  precheckDriveRoute,
  requestDriveRide,
  requestScheduledRide,
  rideIntlAvailability,
  type RideIntlAvailability,
  type DriveActiveRide,
  type DriveQuote,
} from "@/app/(customer)/drive/actions";
import { joinZoneWaitlist } from "@/lib/zones/actions";
import { withTimeout } from "@/lib/async/with-timeout";
import type { DriveIntentDraft } from "@/app/(customer)/drive/ai-actions";

/**
 * Coligo Drive — parcours client conforme à MAQUETTE-vtc-coligo.html :
 * trajet (GPS / épingle carte) → gammes + paiement + options (boost, femme
 * au volant, pour un proche) → offres des chauffeurs → course → fin.
 */

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

/** Kill-switch inter-wilayas (feature flag `drive_interwilaya`, sérialisé
 *  depuis la page serveur — jamais de fonction en prop serveur→client). */
export type InterFlagLite = {
  status: "active" | "hidden" | "coming_soon" | "maintenance";
  message_fr: string | null;
  message_ar: string | null;
};

export function DriveView({
  userId,
  interFlag = null,
}: {
  userId: string;
  interFlag?: InterFlagLite | null;
}) {
  const t = useTranslations("drive");
  // Contexte Drive (solde, récents, dernière course, options) CACHÉ via TanStack
  // dans le QueryClient persistant du groupe client : au retour sur /drive le
  // contexte est DÉJÀ là (re-affichage instantané, comme /commandes) au lieu
  // d'être re-fetché à chaque montage → plus de « rechargement » de l'écran.
  // Clé SCOPÉE PAR UTILISATEUR (comme les autres loaders) → aucune fuite de
  // contexte entre comptes sur un même onglet.
  const { data: ctx = null } = useQuery({
    queryKey: ["drive-context", userId],
    queryFn: getDriveContext,
    // Aligné sur la rétention du Router Cache (5 min) : au retour sur /drive,
    // l'écran complet vient du cache sans AUCUN re-fetch ; au-delà, l'ancien
    // contexte s'affiche d'abord et se revalide en silence.
    staleTime: 300_000,
  });
  const [screen, setScreen] = useState<Screen>("home");
  // Assistant : carte de confirmation affichée → on masque le reste du trajet.
  const [aiConfirming, setAiConfirming] = useState(false);

  // Trajet
  const [pickup, setPickup] = useState<Pt | null>(null);
  const [dest, setDest] = useState<Pt | null>(null);
  const [mapPickFor, setMapPickFor] = useState<"dep" | "dest">("dest");
  // Onglet Ville ⇄ Inter-wilayas (lentille d'AFFICHAGE : copy + mise en
  // avant longue distance ; la détection réelle est automatique, cf. inter).
  const [tripMode, setTripMode] = useState<TripMode>("ville");

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
  // Distance (km) du dernier devis servi — garde de STABILITÉ : un
  // micro-déplacement d'adresse qui ne change pas la distance garde le devis.
  const lastQuoteKmRef = useRef<number>(0);
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
  // Rail de la CARTE : CIB/EDAHABIA en DA (Chargily, défaut) ou carte
  // internationale en € (Stripe, feuille embarquée). Le sous-choix n'existe
  // que si le serveur juge l'option € proposable (flag+pays+capacité).
  const [cardRail, setCardRail] = useState<"dzd" | "eur">("dzd");
  // Disponibilité du rail € jugée SERVEUR **pour le montant courant** : bornes
  // par course (min 5 €) et plafonds compris. Sans le montant, le client
  // pouvait choisir « € » sur une course à 310 DA (≈1,22 €) et n'apprendre le
  // refus qu'au paiement. Re-sondée à chaque changement de prix (débouncée).
  const [intlInfo, setIntlInfo] = useState<RideIntlAvailability>({
    available: false,
    reason: null,
    min_eur_cents: 500,
  });
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

  // Persistance SESSION du parcours : arrivé à l'écran PRIX, un rechargement
  // de la page doit y RESTER (trajet restauré), pas repartir à la sélection
  // d'adresses. Écrit à chaque changement pertinent, TTL 30 min.
  const JOURNEY_KEY = "coligo:drive:journey";
  // Passe à true une fois le boot (restauration éventuelle) terminé : la purge
  // ci-dessous ne doit JAMAIS courir au premier rendu (screen vaut "home"
  // AVANT la restauration — on effacerait le parcours qu'on allait restaurer).
  const bootDoneRef = useRef(false);
  useEffect(() => {
    try {
      if (screen === "price" && pickup && dest) {
        sessionStorage.setItem(
          JOURNEY_KEY,
          JSON.stringify({ pickup, dest, at: Date.now() })
        );
      } else if (screen === "home" && bootDoneRef.current) {
        // RETOUR EXPLICITE à la sélection d'adresses : le client a QUITTÉ
        // l'écran prix — une actualisation doit le laisser sur la sélection,
        // pas le renvoyer d'office au prix (bug vécu : back puis F5 →
        // re-saut sur l'écran prix comme s'il avait retapé Continuer).
        sessionStorage.removeItem(JOURNEY_KEY);
      }
    } catch {
      /* sessionStorage indispo */
    }
  }, [screen, pickup, dest]);

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
      } else if (!ride) {
        // Pas de course active : si le client était sur l'écran PRIX (trajet
        // choisi) avant un rechargement, on l'y remet directement.
        try {
          const raw = sessionStorage.getItem("coligo:drive:journey");
          if (raw) {
            const j = JSON.parse(raw) as {
              pickup?: Pt;
              dest?: Pt;
              at?: number;
            };
            if (
              j.pickup &&
              j.dest &&
              typeof j.at === "number" &&
              Date.now() - j.at < 30 * 60_000
            ) {
              setPickup(j.pickup);
              setDest(j.dest);
              setScreen("price");
            }
          }
        } catch {
          /* parcours illisible → accueil normal */
        }
      } else if (ride) {
        // Reprise d'une course « searching » (le client était parti puis revenu
        // sur l'écran de recherche) : on PRÉ-REMPLIT le trajet en mémoire. Ainsi
        // le prix se (pré)calcule en arrière-plan PENDANT l'attente d'offres →
        // « Annuler la recherche » ramène INSTANTANÉMENT à l'écran prix déjà prêt,
        // comme si le client n'avait jamais quitté l'écran (sinon le calcul de
        // prix ne démarrait qu'au moment de l'annulation → retour plus lent).
        if (ride.status === "searching") restoreTrajectoryFrom(ride);
        setActive(ride);
        setScreen("ride");
      }
      // Restauration terminée : la purge du parcours (retour explicite à la
      // sélection) devient autorisée.
      bootDoneRef.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Départ = position actuelle (GPS) par défaut. Quasi instantané : un fix
  // « rapide » (cache OS / réseau) s'affiche tout de suite, puis le GPS haute
  // précision affine en arrière-plan tant que le départ reste « Ma position ».
  // `gpsNonce` : au retour d'arrière-plan on RELANCE l'acquisition (le client a
  // pu bouger / accorder la permission entre-temps).
  const [gpsNonce, setGpsNonce] = useState(0);
  useResumeResync(() => setGpsNonce((n) => n + 1));
  useEffect(() => {
    let cancelled = false;
    let bestAcc = Infinity;
    let lastFix: { lat: number; lng: number } | null = null;
    let lastRev: { lat: number; lng: number } | null = null;
    // Amorçage INSTANTANÉ du départ depuis la dernière VRAIE position connue :
    // 1) le cache DÉPART de Drive (< 6 h — toujours issu d'un fix GPS géocodé) ;
    // 2) sinon la position marketplace UNIQUEMENT si elle a été DÉTECTÉE par
    //    GPS (`source === "gps"`). Une zone CHOISIE à la main dans le header
    //    (« Boumerdès ») est un filtre marketplace, PAS une position : elle ne
    //    doit JAMAIS s'afficher comme « Ma position » (bug vécu : départ figé
    //    sur Boumerdès alors que le client est ailleurs).
    const driveDep = readDriveDeparture();
    const freshDriveDep =
      driveDep &&
      Date.now() - new Date(driveDep.updated_at).getTime() < 6 * 3_600_000
        ? driveDep
        : null;
    const stored = readStoredLocation();
    const seed =
      freshDriveDep ??
      (stored?.source === "gps" &&
      stored.latitude != null &&
      stored.longitude != null
        ? {
            latitude: stored.latitude,
            longitude: stored.longitude,
            address: stored.address,
          }
        : null);
    if (seed) {
      setPickup((prev) =>
        prev
          ? prev
          : {
              lat: seed.latitude,
              lng: seed.longitude,
              text: seed.address,
              gps: true,
            }
      );
    }
    // Arrêt du watch : au 1er fix PRÉCIS (≤ 150 m) ou au plafond de 60 s —
    // plus jamais de coupure sèche à 15 s sans aucun fix reçu (le prompt de
    // permission ou un GPS lent dépassent facilement 15 s → le départ restait
    // figé sur le seed).
    let watchRef: WatchHandle | null = null;
    let capId: ReturnType<typeof setTimeout> | null = null;
    const stopWatch = () => {
      watchRef?.stop();
      watchRef = null;
      if (capId) clearTimeout(capId);
      capId = null;
    };
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
      if (accuracy <= 150) stopWatch();
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
          // On PERSISTE la position résolue (cache Drive) → à la prochaine
          // ouverture de Coligo Drive le départ s'amorce INSTANTANÉMENT depuis ce
          // cache au lieu de « Localisation… ».
          writeDriveDeparture(lat, lng, r.display ?? null);
        })
        .catch(() => {});
    };
    // DÉPART INSTANTANÉ : on accepte le DERNIER fix connu de l'OS (cache jusqu'à
    // 5 min) → 0 ms s'il existe, la position s'affiche tout de suite sans attendre
    // un fix frais. C'est PROVISOIRE : le watch haute précision (maximumAge:0)
    // ci-dessous récupère la position ACTUELLE exacte et, si le client a bougé,
    // apply() remplace le fix en cache éloigné (anti « vieille position »).
    // Timeout 6 s (avant 2,5 s : trop court, le prompt de permission le crevait
    // systématiquement) — le cache OS répond en ~0 ms quand il existe.
    void getPosition({
      enableHighAccuracy: false,
      timeout: 6_000,
      maximumAge: 300_000,
    })
      .then((p) => apply(p.latitude, p.longitude, p.accuracy ?? 9_999))
      .catch(() => {
        /* géoloc refusée : le client choisira sur la carte */
      });
    watchRef = watchPosition(
      (p) => apply(p.latitude, p.longitude, p.accuracy ?? 9_999),
      undefined,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }
    );
    capId = setTimeout(stopWatch, 60_000);
    return () => {
      cancelled = true;
      stopWatch();
    };
    // gpsNonce : reprise au premier plan → nouvelle acquisition complète.
  }, [gpsNonce]);

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
  // ⚠️ DÉPENDANCES PRIMITIVES, PAS LES OBJETS.
  // Avec `[pickup, dest]`, la moindre RÉÉCRITURE d'un de ces objets (le
  // `setPickup` du watch GPS en recrée un à chaque fix, même position
  // identique) relançait l'effet, qui appelait `setRoute(null)` sans condition
  // → nouveau rendu → effet → « Maximum update depth exceeded », et l'écran des
  // gammes tombait sur « Une erreur est survenue ». On dépend donc des
  // COORDONNÉES, et on n'efface le tracé que si le trajet CHANGE vraiment.
  const pickupLat = pickup?.lat ?? null;
  const pickupLng = pickup?.lng ?? null;
  const destLat = dest?.lat ?? null;
  const destLng = dest?.lng ?? null;
  useEffect(() => {
    setRoute(null);
    if (
      pickupLat == null ||
      pickupLng == null ||
      destLat == null ||
      destLng == null
    )
      return;
    let cancelled = false;
    void routeEstimate({
      from: { lat: pickupLat, lng: pickupLng },
      to: { lat: destLat, lng: destLng },
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
  }, [pickupLat, pickupLng, destLat, destLng]);

  const distanceKm =
    route?.km ?? (crowKm > 0 ? Number((crowKm * 1.25).toFixed(2)) : 0);
  const etaMin = route?.min ?? Math.max(2, Math.round((distanceKm / 26) * 60));
  // Distance affichée TOUT DE SUITE (vol d'oiseau × détour) puis affinée en
  // silence par OSRM — plus d'attente/loader sur la distance et la durée.
  const distanceLabel = distanceKm.toFixed(1).replace(".", ",");
  // Inter-wilayas : détection AUTOMATIQUE (wilayas différentes + ≥ 35 km),
  // 100 % locale — badge informatif accueil + écran prix (jamais tarifaire).
  const inter = interWilayaInfo(pickup, dest, distanceKm);
  // Service inter-wilayas coupé par l'équipe Coligo : l'onglet inter n'est
  // plus sélectionnable → on ramène la feuille sur « Ville ».
  useEffect(() => {
    if (interFlag && interFlag.status !== "active" && tripMode === "inter") {
      setTripMode("ville");
    }
  }, [interFlag, tripMode]);

  /* ───────── Devis par gamme — UN SEUL prix affiché (le prix FINAL) ───────── */
  useEffect(() => {
    // PRÉ-CHARGE : on calcule les devis DÈS que départ + arrivée sont connus,
    // SANS attendre l'écran prix → en arrivant sur l'écran prix, les prix par
    // gamme sont DÉJÀ là.
    if (distanceKm <= 0 || !pickup || !dest) return;
    // STABILITE (regle Bolt) : le trajet est QUANTIFIE (~110 m, toFixed(3)) et
    // un deplacement qui ne change presque pas la DISTANCE (< 150 m) garde le
    // devis existant. Sans cela, bouger l'adresse d'1 m relançait un devis,
    // qui pouvait retomber sur le bareme de repli local (different du bareme
    // serveur demande/offre) -> le prix sautait (ex. 150 -> 210 DA) sans
    // raison perceptible pour le client.
    const trajKey = `${pickup.lat.toFixed(3)},${pickup.lng.toFixed(3)},${dest.lat.toFixed(3)},${dest.lng.toFixed(3)}`;
    let isNewTraj = trajKey !== lastTrajRef.current;
    if (
      isNewTraj &&
      quotes != null &&
      Math.abs(distanceKm - lastQuoteKmRef.current) < 0.15
    ) {
      // Micro-changement d'adresse, meme distance -> meme prix (devis garde).
      lastTrajRef.current = trajKey;
      isNewTraj = false;
    }

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
      lastQuoteKmRef.current = distanceKm;
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

  // Sonde € : au montage puis à chaque variation de prix (débounce 400 ms pour
  // ne pas tirer un aller-retour à chaque cran du curseur). Si le rail € n'est
  // plus proposable pour ce montant, on RETOMBE sur CIB/Edahabia — le client
  // n'arrive jamais au paiement avec un rail impossible.
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      void rideIntlAvailability(offerPrice > 0 ? offerPrice : undefined).then(
        (info) => {
          if (alive) setIntlInfo(info);
        }
      );
    }, 400);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [offerPrice]);
  useEffect(() => {
    if (cardRail === "eur" && !intlInfo.available) setCardRail("dzd");
  }, [cardRail, intlInfo.available]);
  // Prix PÉRIMÉ : recalcul en cours OU les quotes ne correspondent plus au
  // trajet courant (adresse modifiée puis retour à l'écran prix) → on n'affiche
  // jamais l'ancien prix, on montre un loader.
  // « Périmé » = uniquement pendant le calcul d'un NOUVEAU trajet. Un raffinement
  // OSRM met à jour les devis en silence → le prix ne repasse jamais en loader.
  const priceStale = pricing;

  // WATCHDOG anti-blocage : le calcul de devis a un timeout interne de 3,5 s +
  // repli local, mais une course d'effets (annulation + retour anticipé avant
  // `setPricing(false)`) pouvait le laisser à `true` → bouton « Proposer » figé
  // en spinner. Garde-fou : au-delà de 5 s, on force la sortie de l'état devis.
  useEffect(() => {
    if (!pricing) return;
    const t = setTimeout(() => setPricing(false), 5000);
    return () => clearTimeout(t);
  }, [pricing]);

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
      // Garde-temps 15 s : un Server Action qui ne se règle jamais (serverless
      // froid, réseau qui stalle) laisserait le spinner tourner à l'infini — le
      // `finally` ne s'exécute pas sur une promesse jamais réglée. Au-delà : on
      // rejette, message inline, bouton réactivé (le `finally` libère tout).
      let res = await withTimeout(requestDriveRide(payload), 15000);
      // AUTO-RÉCUPÉRATION devis : « déjà utilisé / expiré / introuvable » ne
      // doit JAMAIS bloquer le client — on ré-émet un devis frais en silence
      // et on retente UNE fois (même trajet, même prix serveur).
      if (!res.ok && res.error && /estimation/i.test(res.error)) {
        const fresh = await issueDriveQuote({
          pickup_lat: payload.pickup_lat,
          pickup_lng: payload.pickup_lng,
          pickup_text: payload.pickup_text ?? null,
          dest_lat: payload.dest_lat,
          dest_lng: payload.dest_lng,
          dest_text: payload.dest_text ?? null,
          price_da: payload.proposed_price_da,
          gamme: payload.gamme,
        }).catch(() => null);
        if (fresh?.quoteId) {
          setQuoteId(fresh.quoteId);
          res = await withTimeout(
            requestDriveRide({ ...payload, quote_id: fresh.quoteId }),
            15000
          );
        }
      }
      if (!res.ok) {
        setRequestError(res.error ?? t("requestFailed"));
        return;
      }
      // CARTE : plus de prépaiement (mig 0386). La course est diffusée
      // immédiatement (comme espèces) ; le paiement du prix EXACT se fait à
      // l'ACCEPTATION d'un chauffeur, dans l'écran de recherche. On mémorise
      // le rail choisi (CIB/Edahabia ou internationale) pour ce moment-là.
      if (payMode === "card" && res.rideId) {
        try {
          window.sessionStorage.setItem("coligo:drive:card_rail", cardRail);
        } catch {
          /* sessionStorage indisponible — défaut CIB au paiement */
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
        const res = await withTimeout(
          requestDriveRide(
            pending.payload as Parameters<typeof requestDriveRide>[0]
          ),
          15000
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
    try {
      sessionStorage.removeItem("coligo:drive:journey");
    } catch {
      /* indispo */
    }
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
  // MÊME squelette que la frontière loading.tsx (source unique, nav du bas
  // comprise) : à l'actualisation, la structure et la barre restent affichées
  // en continu — plus de spinner plein écran qui « fait disparaître » la nav.
  if (!ctx) {
    return <DriveHomeSkeleton />;
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
    return (
      <>
        <DrivePriceScreen
          pickup={pickup}
          dest={dest}
          route={route}
          distanceLabel={distanceLabel}
          etaMin={etaMin}
          inter={inter}
          quotes={quotes}
          quote={quote}
          gamme={gamme}
          price={price}
          offerPrice={offerPrice}
          priceStale={priceStale}
          boostOn={boostOn}
          boostAmt={boostAmt}
          femaleOnly={femaleOnly}
          prox={prox}
          payMode={payMode}
          cardRail={cardRail}
          intlAvailable={intlInfo.available}
          intlBelowMin={intlInfo.reason === "order_min"}
          intlMinEur={Math.round(intlInfo.min_eur_cents / 100)}
          welcome={welcome}
          ctx={ctx}
          zoneBlock={zoneBlock}
          zoneJoined={zoneJoined}
          requestError={requestError}
          submitting={submitting}
          schedOpen={schedOpen}
          schedAt={schedAt}
          schedBusy={schedBusy}
          schedMsg={schedMsg}
          schedDone={schedDone}
          proxOpen={proxOpen}
          setScreen={setScreen}
          pickGamme={pickGamme}
          stepPrice={stepPrice}
          setPrice={setPrice}
          setPayMode={setPayMode}
          setCardRail={setCardRail}
          setBoostOn={setBoostOn}
          setBoostAmt={setBoostAmt}
          setFemaleOnly={setFemaleOnly}
          setProx={setProx}
          setProxOpen={setProxOpen}
          defBoost={defBoost}
          submitRequest={submitRequest}
          joinDriveWaitlist={joinDriveWaitlist}
          setSchedOpen={setSchedOpen}
          setSchedAt={setSchedAt}
          setSchedDone={setSchedDone}
          setSchedMsg={setSchedMsg}
          submitSchedule={submitSchedule}
        />
      </>
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
    <DriveHomeScreen
      ctx={ctx}
      pickup={pickup}
      dest={dest}
      zoneBlock={zoneBlock}
      zoneJoined={zoneJoined}
      isDesktop={isDesktop}
      routePath={route?.path ?? null}
      aiConfirming={aiConfirming}
      tripMode={tripMode}
      setTripMode={setTripMode}
      inter={inter}
      interFlag={interFlag}
      depOpen={depOpen}
      contactsOpen={contactsOpen}
      sosContacts={sosContacts}
      setPickup={setPickup}
      setDest={setDest}
      setScreen={setScreen}
      setMapPickFor={setMapPickFor}
      setAiConfirming={setAiConfirming}
      setDepOpen={setDepOpen}
      setContactsOpen={setContactsOpen}
      setSosContactsState={setSosContactsState}
      swapPoints={swapPoints}
      joinDriveWaitlist={joinDriveWaitlist}
      applyAiDraft={applyAiDraft}
    />
  );
}

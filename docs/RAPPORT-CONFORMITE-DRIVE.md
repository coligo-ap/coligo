# RAPPORT DE CONFORMITÉ — Module Coligo Drive

> Référence : `CHECKLIST-DRIVE.md` (61 items, tous cochés). Chaque item → ✅ +
> fichier(s)/composant(s) qui l'implémentent dans le repo `coligo/`.
> Backend : migrations `supabase/migrations/0139…0144` (appliquées en prod),
> argent prouvé réconcilié par `npm run test:drive:money` (47/47) et
> `npm run test:vtc` (16/16).

## A. CLIENT — Trajet & accueil Drive

- ✅ **A1** Onglet Drive (icône voiture), nav Accueil · Commandes · Drive · Pay · Compte → `components/customer/customer-bottom-nav.tsx`
- ✅ **A2** Départ par défaut « Ma position actuelle » (GPS) → `components/customer/drive/drive-view.tsx` (effet `getPosition` + reverse geocode), `lib/native/geolocation`
- ✅ **A3** Départ via carte à épingle centrale + « Confirmer ce point » → `MapPickScreen` (`drive-view.tsx`), `DepModal` (`drive-modals.tsx`), mode interactif tap/drag + position initiale émise (`drive-map.tsx`) ; repli coordonnées GPS exactes si rue introuvable
- ✅ **A4** Destination via la même carte + destinations récentes → `MapPickScreen` + `getDriveContext().recents` (`app/(customer)/drive/actions.ts`)
- ✅ **A5** Bouton « Historique » en haut de l'accueil → `drive-view.tsx` (histbtn)
- ✅ **A6** Page Historique, onglets Courses / ♥ Favoris → `app/(customer)/drive/historique/page.tsx`, `components/customer/drive/drive-history.tsx`
- ✅ **A7** Favoris listés, cœur pour retirer → `drive-history.tsx` + table `customer_favorite_chauffeurs` (mig 0139)

## B. CLIENT — Gamme, paiement, options

- ✅ **B1** Cards carrées défilables Classic (défaut) / Confort / Moto avec photos détourées de la maquette → `drive-view.tsx` (gammes) + `public/drive/gamme-{classic,confort,moto}.png`
- ✅ **B2** Card = « {prix} DA · recommandé » uniquement ; Moto la moins chère → `getDriveQuotes` + `drive_recommended_price` (mig 0140, barème par gamme : Moto 100+30/km)
- ✅ **B3** Paiement choisi sur l'écran prix (Espèces défaut · Carte · Coligo Pay) ; écran de fin = récap seul → `drive-view.tsx` (payrow) ; `DoneScreen` (`drive-ride.tsx`) sans sélecteur
- ✅ **B4** Prix pré-rempli au recommandé, ±20 DA, libellés En dessous/Au-dessus → `drive-view.tsx` (`stepPrice`, `floorLabel`) + clés `drive.price.*`
- ✅ **B5** Aucun « prix bas/rapide » ; nuit 22h–6h ≤ +20 % UNIQUEMENT dans l'algorithme ; plancher silencieux → `drive_recommended_price` + `drive_price_floor` (mig 0140) — aucune trace UI
- ✅ **B6** Fourchette « Courses similaires : X–Y DA » → `drive_similar_range` (mig 0140, percentiles des courses réelles) + chip `drive-view.tsx`
- ✅ **B7** Booster en VERT (ligne + toggle + montant ajustable, prioritaire) → `OptRow` verte (`drive-view.tsx`, #16B364) + `ride_boost` (mig 0140)
- ✅ **B8** « Femme au volant » en ROSE (icône, titre, toggle, « N conductrices en ligne ») → `OptRow` rose (#EC4899) + `getDriveContext().femaleOnlineCount` ; visible clientes vérifiées
- ✅ **B9** « Pour un proche » : contact, suivi SMS/WhatsApp sans compte, numéro masqué → `ProxModal` (`drive-modals.tsx`), `rides.proxy_name/proxy_phone` (mig 0139/0144), boutons « Envoyer le suivi · WhatsApp/SMS » vers le proche (`drive-ride.tsx`), lien public `/t/{token}` ; contact via chat in-app (`ride_messages`)

## C. CLIENT — Recherche & offres

- ✅ **C1** Diffusion + accepter/contre-proposer → `chauffeur_offer_ride` (mig 0140) + `d-requests.tsx` (Proposer X / Accepter)
- ✅ **C2** Tri Moins chers / Mieux notés + badges → `SearchScreen` (`drive-ride.tsx`)
- ✅ **C3** ♥ Favoris en tête + badge + cœur cliquable sur chaque offre → `SearchScreen` (tri favoris, `toggleFav` optimiste, bouton cœur par carte)
- ✅ **C4** Chip verte « ⚡ Boostée » + « Boostez » relançable → `SearchScreen` (boostedChip + boostBar) + re-notification FCM (`boostRide`)
- ✅ **C5** Conductrices stylées ROSE (carte/avatar/nom + badge Conductrice) → `SearchScreen` (tone ROSE quand `female_only`)
- ✅ **C6** Repli : bandeau + hommes stylés NOIR + notification quand une conductrice se connecte → `SearchScreen` (fallbk + tone noir) ; `drive_female_waiting_customers` (mig 0140) + `notifyFemaleDriverOnline` (`lib/fcm/triggers.ts`) déclenchée au heartbeat d'une conductrice
- ✅ **C7** Annulation recherche gratuite, motif demandé → `CancelModal` ctx `client_search` + `cancel_ride(reason)` → `ride_events`
- ✅ **C8** Hors-ligne : file **Dexie**, bannière, envoi auto au retour réseau → `lib/drive/offline-db.ts` (IndexedDB) + `drive-view.tsx` (queue/flush sur `online`) + bannière (`SearchScreen`)

## D. CLIENT — Course active & SÉCURITÉ

- ✅ **D1** Fiche chauffeur v3 : avatar + badge vérifié, chips ★/courses, bandeau véhicule + PLAQUE réelle, Message/Appeler pleine largeur → `EnrouteScreen` (`drive-ride.tsx`, classe `.drive-plate`)
- ✅ **D2** « Partager mon trajet » : modale fiche + plaque + lien `coligo.app/t/{token}`, WhatsApp/SMS un tap, suivi sans compte → `ShareModal` + `app/t/[token]/page.tsx` + `ride_by_share_token` (mig 0140) + `share-track-view.tsx`
- ✅ **D3** SOS rouge : 17 · contacts d'urgence · support Coligo, position+course jointes → `SOSModal` (`drive-modals.tsx`) + `ride_sos` (mig 0140, événement tracé)
- ✅ **D4** Itinéraire anormal : carte ambre « Tout va bien ? » [Tout va bien][SOS → même modale] → `EnrouteScreen` (corridor Haversine, seuils `drive_deviation_km/min` en config)
- ✅ **D5** Badge rose « Course pour {proche} · suivi envoyé » → proxbadge (`EnrouteScreen`)
- ✅ **D6** Annulation course gratuite, motifs, avertissement chauffeur en route → `CancelModal` ctx `client_enroute`
- ✅ **D7** Messages rapides in-app, numéros masqués → `ChatModal` + table `ride_messages` (mig 0139, RLS participants)

## E. CLIENT — Fin de course

- ✅ **E1** Récap : prix convenu, libellé selon paiement B3, commission « incluse » → `DoneScreen` (`drive-ride.tsx`)
- ✅ **E2** Cashback croisé affiché (Drive ET livraisons) → `DoneScreen` (banner) + `complete_ride` (cashback 2 % financé par la commission, mig 0141/0143)
- ✅ **E3** Notation 5★ + Signaler (motifs précis) + confirmation « examen sous 24 h » → `DoneScreen` + `ReportModal` + `rate_ride`/`report_ride` (mig 0140), table `ride_reports`

## F. CHAUFFEUR — Onboarding & états

- ✅ **F1** Connexion tél+mdp / inscription (nom, prénom, tél, naissance, wilaya/ville, mdp, gamme) → `d-auth.tsx` + `chauffeurSignup` (`app/(chauffeur)/actions.ts`)
- ✅ **F2** Permis (r/v) + carte grise + immatriculation OBLIGATOIRES, assurance optionnelle → `d-docs.tsx` + `chauffeur_documents` (mig 0139) + `submitChauffeurDossier` (refuse si manquant)
- ✅ **F3** Selfie EN DIRECT uniquement (getUserMedia caméra frontale, AUCUN import) → `SelfieCamera` (`d-docs.tsx`)
- ✅ **F4** Écran d'attente à étapes ; accès bloqué tant que le SUPER ADMIN n'a pas validé → `DWait` (`d-gate.tsx`) + gating (`app/(chauffeur)/chauffeur/page.tsx`) + RPC durcies (mig 0138)
- ✅ **F5** pending/active/frozen ; écran « Compte gelé » avec les 4 motifs ; seuils en config → `DFrozen` (`d-gate.tsx`) + `drive_freeze_job` (mig 0141) + seuils `drive_freeze_*` (mig 0139, éditables /admin/drive)

## G. CHAUFFEUR — Accueil & demandes

- ✅ **G1** Heatmap zones de demande + légende ; feuille réductible → `d-home.tsx` (`DriveMap heatZones` = clusters des demandes réelles) + sheet `maxHeight` togglable
- ✅ **G2** Gains du jour (montant + courses + heures en ligne) → `d-home.tsx`/`d-gains.tsx` + `formatOnline` (`lib/drive/geo.ts`) + compteur `chauffeur_presence.online_minutes` (heartbeat v2, mig 0144)
- ✅ **G3** Bandeau gamme (Confort reçoit Classic+Confort ; Classic→Classic ; Moto↔Moto) → `d-home.tsx` + matching dur SQL (`chauffeur_offer_ride`/`chauffeur_nearby_rides`, mig 0140)
- ✅ **G4** « Je rentre chez moi · {adresse} » : toggle + adresse modifiable (crayon, sync Compte) + filtre directionnel réel → `d-home.tsx`/`d-compte.tsx` (adresse géocodée, `setChauffeurHome`) + `isTowardsHome` (`lib/drive/geo.ts`, tolérance config) filtrant `d-requests.tsx` + limite 2/jour (`chauffeur_home_dir_activate`, mig 0140)
- ✅ **G5** Tri Proches/Mieux payées, boostées en premier (bordure + badge vert ⚡) → `d-requests.tsx`
- ✅ **G6** Badge violet « Confort demandé » → `d-requests.tsx`
- ✅ **G7** 2 distances + ancienneté + note client → `d-requests.tsx` + `chauffeur_nearby_rides` v2 (mig 0140)
- ✅ **G8** « Voir le trajet sur la carte » : approche GRIS POINTILLÉ + étiquette, course VIOLET + étiquette, marqueurs → écran carte (`d-requests.tsx` mapReq + `drive-map.tsx` route/approach)
- ✅ **G9** Ajuster ± puis Proposer/Accepter ; anti double-engagement (1 course max, autres propositions annulées) + TTL → `d-requests.tsx` + `accept_ride_offer` (verrou transactionnel, mig 0140/0143) + `drive_expire_stale`

## H. CHAUFFEUR — Course

- ✅ **H1** « {client} a accepté ! » → prise en charge, « Je suis arrivé » (push client), annulation motifs + règle 5 min → `d-course.tsx` + `CancelModal` ctx `driver_pickup` + `notifyRideCustomer` (`lib/fcm/triggers.ts`)
- ✅ **H2** SOS chauffeur (même modale 3 actions) → `SOSModal side="driver"` (`d-course.tsx`)
- ✅ **H3** Back-to-back : course proche du POINT DE DÉPOSE, minuteur 12 s, file de 1, retirable, « Enchaîner » → `d-course.tsx` (nextOff/queued) + `drive_b2b_next` (mig 0140, rayon config)
- ✅ **H4** Fin : prix, commission selon plan, gain net, upsell « Avec Premium (0 %) vous auriez gardé X » → `DoneScreen` (`d-course.tsx`)

## I. CHAUFFEUR — Gains, abonnements, pages

- ✅ **I1** Nav 4 onglets fonctionnels (Accueil · Drive · Gains · Compte) + Historique depuis Gains → `d-ui.tsx` (DNav) + routes `app/(chauffeur)/chauffeur/*`
- ✅ **I2** « Ce mois » : brut, commission, abonnement, net + encadré « À reverser à Coligo » selon plan → `d-gains.tsx` + `drive_my_finances` (mig 0141/0144)
- ✅ **I3** Gratuit 8 % · Pro 1 500 DA/mois 3,5 % · Premium 3 900 DA/mois 0 % + priorité + badge 👑 → `d-subs.tsx` + `resolve_drive_plan` (mig 0140) + priorité dispatch (`chauffeurs_present_near` ORDER premium) + badge (offres + compte)
- ✅ **I4** Paiement : modale CCP (numéro plateforme + clé + référence + « J'ai payé » → vérification 24 h) OU carte (immédiat) → `d-subs.tsx` + `drive_subscribe`/`drive_sub_mark_paid` (mig 0141/0142) + webhook Chargily `drive_sub` + validation admin (`/admin/chauffeurs`)
- ✅ **I5** « Actif jusqu'au {date} · renouvelez avant {date+5}, sinon retour Gratuit » + job d'échéance → `d-subs.tsx` (dates) + `drive_sub_expire_job` + cron quotidien `/api/cron/drive` (vercel.json)
- ✅ **I6** Historique chauffeur (gamme/boost/net) ; Compte (profil + badge Premium, véhicule + gamme, domicile, documents, langue) → `DHisto` (`d-gains.tsx`) + `d-compte.tsx`

## J. Transverse

- ✅ **J1** Thème clair/sombre maquette ; violet #5B5BE6, vert #16B364, rose #EC4899, or Premium → variables `--d-*` (`app/globals.css`, tokens light/dark de la maquette via `prefers-color-scheme`) sur TOUS les écrans Drive + plaque fixe (`.drive-plate`) + fond de carte sombre (OpenFreeMap dark, `drive-map.tsx`)
- ✅ **J2** FR/AR + RTL (next-intl, namespace `drive` à parité dans `messages/fr.json`/`ar.json`) ; AUCUNE valeur financière en dur (tout dans `platform_settings`, mig 0139) ; `client_operation_id` sur création/acceptation (mig 0139/0140) ; tout tracé dans `ride_events` (création, offres, boost, annulations+motifs, SOS, signalements)
- ✅ **J3** Tous les seuils (gel, dette, annulations, note) configurables côté admin → `/admin/drive` (`drive-config-form.tsx` + `updateDriveConfig`, simulateur de marge BLOQUANT `lib/drive/margins.ts`)

---

**Vérifications** : `npm run build` ✓ · `npm run test:drive:money` 47/47 ✓ · `npm run test:vtc` 16/16 ✓ · migrations 0139→0144 appliquées en prod.
**Décisions ROU (questions STOP)** : CCP placeholder (à saisir dans /admin/drive) · boost 100 % chauffeur sans commission · cashback 2 % financé par la commission · seuils de gel par défaut (5 000 DA / 25 % sur 20 / 4,0 sur 30) · barème par gamme par défaut · « Femme au volant » ACTIVÉ (flag désactivable en admin).

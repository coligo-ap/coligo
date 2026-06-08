# Livreur — UI (composants, états, navigation)

Design system « style Uber » scopé `[data-space="driver"]` (cf.
`app/globals.css` et `app/(driver)/layout.tsx`) : police **Inter**, fond gris,
cards blanches, encre noire, **violet de marque `#6c2bd9`** (et non l'indigo
`#5B5BE6` des maquettes — décision : unifier sur la marque Coligo). Le `@theme`
global (commerçant/client/admin) n'est jamais touché.

> Source de vérité visuelle : `MAQUETTE-livreur-uber.html`,
> `MAQUETTE-livreur-pages.html`, `MAQUETTE-livreur-navigation.html`.

## Mapping maquette → code

| Élément maquette                              | Composant / fichier                                                       | État           |
| --------------------------------------------- | ------------------------------------------------------------------------- | -------------- |
| Bouton **GO** / EN LIGNE + radar              | `components/driver/home/driver-home-*` + `lib/driver/online-store.ts`     | ✅             |
| Barre « recherche d'une commande »            | `components/driver/home/driver-home-sheet.tsx`                            | ✅             |
| **Offre de course** (sheet+timer)             | `components/driver/express-offer.tsx`                                     | ✅             |
| Sons (mise en ligne / nouvelle cmd)           | `lib/hooks/use-alert-sound.ts` (Web Audio) + `vibrate`                    | ✅ (Web Audio) |
| **Marqueur livreur** moto + halo              | `components/driver/delivery-route-map.tsx` + `@keyframes driver-me-pulse` | ✅             |
| **TabBar** (Accueil/Gains/Histo/Compte)       | `components/driver/driver-bottom-nav.tsx`                                 | ✅             |
| Navigation active (bandeau direction + sheet) | `components/driver/course/express-run.tsx`                                | ✅             |
| **Validation remise** (QR + PIN)              | `components/driver/delivery-validation-dialog.tsx`                        | ✅             |
| **Gains** (toggle + graphe + tuiles)          | `components/driver/gains/gains-view.tsx`                                  | ✅             |
| **Historique** (pills + cartes jour)          | `components/driver/delivery-history.tsx`                                  | ✅             |
| **Relevé · règlement** (net-card)             | `components/driver/releve/settlement-view.tsx` + `/driver/releve`         | ✅ (ce lot)    |
| **Jauge encours / plafond** (Compte)          | `components/driver/profile/float-gauge.tsx`                               | ✅ (ce lot)    |
| **Compte** (profil, note, menu)               | `components/driver/profile/profile-hub.tsx`                               | ✅             |

## Gain net de l'offre (important)

L'offre affiche désormais le **gain NET** = `D − driver_fee` (ex. 184 DA), pas
le `delivery_fee_da` brut, exactement comme la maquette. Le calcul vient de
`lib/driver/settlement.ts` (`computeDriverNet`), alimenté par la config
`driver_fee_*` figée en base et passée depuis la page course
(`app/(driver)/driver/course/[orderId]/page.tsx`) → `ExpressCard` →
`ExpressOffer`. **Aucun taux codé en dur.**

## Offre de course — états & minuteur

`ExpressOffer` : plein écran blanc, **minuteur 30 s** (barre qui se vide +
pastille `m:ss` + passage **rouge** dans les 10 dernières secondes). À `0:00`,
la course est **libérée** (`onTimeout` → release, cooldown 10 min). Sonnerie en
boucle (2,5 s) + vibration tant que l'offre est affichée ; arrêt à
l'acceptation/refus. La commande est déjà attribuée côté serveur (FIFO
`pull_next_express` / zone `pull_next_express_nearby`) — aucune attribution
ré-inventée.

## Pattern de navigation

- **TabBar persistante** (Accueil/Gains/Historique/Compte) sur toutes les pages
  « consultables » (`DriverBottomNav`).
- **Réception** : le dispatch Express est monté GLOBALEMENT dans le layout
  (`DriverDispatchMount` → `ZoneDispatch`, piloté par l'intention « en ligne »
  du store `online-store`) → le livreur reçoit les offres sur n'importe quel
  onglet tant qu'il est en ligne.
- **Offre** (modale à minuteur) = seul moment qui **bloque** temporairement la
  navigation (focus décision), conforme au prompt.
- **Course active** : flux plein écran (`ExpressRun`) après acceptation, routé
  sur `/driver/course/[orderId]`.

## Machine d'états course

`offered → accepted → en_route_pickup → arrived_pickup → picked_up →
en_route_dropoff → arrived_dropoff → delivered | cancelled`. Transitions via les
Server Actions `(driver)/actions.ts` (`markOrderPickedUp`,
`markDeliveryArrived`, validation…) + `order_events` (append-only) +
`delivery_*_at` sur `orders`. Le minuteur/expiration de l'offre est aussi gardé
côté serveur (cooldown 0056).

## Reste à aligner (suites)

- **Bandeau « Course en cours » réductible** persistant au-dessus de la tabbar
  (maquette navigation, écrans 2-3) : aujourd'hui la course est plein écran sur
  sa propre route ; le bandeau réductible inter-onglets (store global
  `{activeOrderId, step, collapsed}`) reste à câbler pour consulter
  Gains/Historique **sans quitter** la course.
- **Mode sombre** : les maquettes ont une bascule clair/sombre ; l'espace
  livreur est actuellement **clair uniquement**. Tokens à dédoubler sous
  `[data-space="driver"].dark`.
- **Sons fichiers** `online.mp3` / `new-order.mp3` : actuellement synthèse Web
  Audio (`use-alert-sound`) ; remplacer par 2 fichiers courts avec repli Web
  Audio.
- **AR / RTL livreur** : le parcours **client** est bilingue ; commerçant /
  livreur / admin restent **FR** (décision projet i18n). Bascule AR du livreur =
  décision à prendre.

## Écran financier branché (ce lot)

- `/driver/releve` (`SettlementView`) : net-card violet **À reverser / À
  recevoir** selon le sens du solde, détail gains nets / commissions / frais de
  service / **part Coligo livraison (8 %)** / solde, bouton Reverser +
  instructions versement (CCP/BaridiMob), export PDF (`window.print`).
  Agrégation live des écritures `delivery_ledger` non réglées + snapshots
  `orders` (miroir de `generate_driver_statements`, cf.
  `docs/livreur-paiement.md`).
- Jauge **encours / plafond** sur Compte (`FloatGauge`,
  `driver_outstanding` / `driver_float_cap_da`) : garde-fou
  `driver_can_accept` (au-delà du plafond → acceptation suspendue).

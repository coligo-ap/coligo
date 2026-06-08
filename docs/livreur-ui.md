# Livreur — UI (composants, états, navigation)

Refonte **100 % maquette** : le CSS des 3 maquettes est porté À L'IDENTIQUE dans
`app/(driver)/maquette.css` (scopé `[data-space="driver"]`), polices **Sora**
(titres/chiffres, `.mq-sora`) + **Plus Jakarta Sans** (corps), palette **indigo
`#5B5BE6`** exactement comme les maquettes, **bascule clair/sombre**
(`[data-space="driver"].dark`, store `theme-store` + `DriverThemeRoot`, défaut
clair). Le `@theme` global (commerçant/client/admin) n'est jamais touché. Le
cadre téléphone / status bar / home-bar des maquettes ne sont PAS reproduits
(artefacts).

> Source de vérité visuelle : `MAQUETTE-livreur-COMPLETE.html` (consolide
> `MAQUETTE-livreur-uber/pages/navigation/tournee`).

## Accueil — version PRO « corrigée » (dernière maquette)

L'accueil suit désormais la **maquette COMPLETE** (`DriverHomeMaquette` +
`DriverHomeMap` + `maquette.css`) :

- **Carte plein écran épurée** : seul le **bouton recentrer** (haut-droite, porté
  par `DriverHomeMap`) et, **en ligne**, un **chip discret « ● En ligne »**
  (haut-gauche, `.home-chip`). **Plus de pastille gains flottante** sur la carte.
- **Feuille basse = tête d'information** (`.mq-sheet`, posée au-dessus de la
  tabbar) : Ligne 1 `Aujourd'hui` + **montant du jour en gros** (Sora 800,
  raccourci `Link` vers `/driver/gains` via `.home-head`/`.gchev`) ; Ligne 2
  **3 métriques EN LIGNE FINE** dans un seul bloc `--soft` (`.metrics` :
  Courses · En ligne · Note, séparées par des `.sep`) ; **en ligne** un
  `.statusline` (libellé + barre de balayage `.track`), **hors ligne** une simple
  invite `.offhint`.
- **Bouton GO rond COMPACT en dock** (`.go-dock`/`.go-btn`, ~66 px, **couleur
  pleine SANS dégradé**), centré **à cheval sur le bord supérieur** de la feuille
  (`top:0; translate(-50%,-50%)`). Hors ligne : **violet plein + anneau interne +
  « GO »**. En ligne : **vert plein, sans anneau, sans point blanc, « EN LIGNE »**
  - **halo doux** + **3 vagues encerclées** (`.radar`, `@keyframes mq-radar`).
    Légende `.go-cap` **au-dessus** du bouton dans les 2 états.
- Transition hors→en ligne : **son « mise en ligne »** (`playGo`). **AUCUN toast
  de statut** (le bouton vert + le chip suffisent — cf. prompt). La classe
  `online` sur `.mq-sheet` pilote bouton/radar/statusline en CSS.

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

Badge **ambre « ⚡ Express »** (`.offer-pill.ex`) — la Tournée garde le badge
**violet** (`.offer-pill.to`), conforme à la maquette COMPLETE et au prompt §D.

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

## Écrans refaits 100 % maquette (ce lot)

Tous les écrans des 3 maquettes sont reproduits au markup/SVG exacts, branchés
sur les vraies données : **Accueil** (GO violet→vert + radar + son + sheet +
stats, sur la vraie carte MapLibre), **Offre** (`.offer-card` slide-up, gain net,
minuteur 3 zones, 2 arrêts), **Navigation active** (`.navbanner` + `.navsheet`),
**Validation** (`.valid` QR + code + encart cash), **Gains**, **Historique**,
**Relevé**, **Compte** (+ bascule apparence), **Tabbar**, **bandeau course
réductible** (`.coursebar`, store `active-course-store`). Mode **clair/sombre** +
**sons** (fichier mp3 sinon synthèse Web Audio, `lib/driver/sounds.ts`) faits.

## Reste (optionnel)

- **Fichiers audio** : déposer `public/sounds/online.mp3` & `new-order.mp3` pour
  remplacer la synthèse Web Audio (le repli fonctionne déjà sans).
- **Turn-by-turn** : le `.navbanner` affiche distance + étape (pas d'instruction
  « tournez à droite » — nécessiterait un moteur de routage).
- **AR / RTL livreur** : le parcours **client** est bilingue ; commerçant /
  livreur / admin restent **FR** (décision projet i18n). Bascule AR du livreur =
  gros lot à confirmer (extraction next-intl de tout l'espace livreur).

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

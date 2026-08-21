# Programme de fidélité — architecture & décisions

> Chantier SPEC-FIDELITE (août 2026), livré en 5 phases avec validation à
> chaque étape. Migrations 0453→0458. **Dormant en prod** : rien n'est visible
> tant que le drapeau `loyalty` n'est pas « active » (voir Lancement).

## Le modèle en une phrase

Un client a UN identifiant fidélité (carte physique et/ou son compte via le QR
`coligo:user:<handle>`), valable chez TOUS les commerçants — mais chaque
dinar de fidélité n'est consommable QUE chez le commerçant qui l'a offert, et
ce cloisonnement est une **contrainte de schéma**, pas une convention.

## Décisions structurantes (validées par le propriétaire)

1. **Grand livre DÉDIÉ `loyalty_entries`, double-entrée** — pas une extension
   du wallet client : les cartes anonymes n'ont pas de `customer_id`, et la
   valeur est financée par le COMMERÇANT (l'écrire dans `wallet_entries`
   fausserait son solde de règlement + le miroir opérateur). Chaque mouvement
   est une PAIRE porteur ↔ compte `program` du commerçant → `SUM = 0 par
commerçant` (invariant `integrity_violations()`). Mêmes patrons que le
   reste : append-only (trigger 0243), `client_operation_id`, verrous
   `pg_advisory_xact_lock('loyalty:'||account)`.
2. **Cloisonnement par FK COMPOSITE** : `loyalty_accounts UNIQUE (id,
merchant_id)` + les DEUX FK de `loyalty_entries` (compte ET contrepartie)
   partagent la colonne `merchant_id` → une paire inter-commerçants est
   structurellement impossible (testé : C5).
3. **La carte n'est qu'un identifiant** : code 16 car. Crockford (~80 bits,
   `extensions.gen_random_bytes`), statuts `printed → activated → linked →
blocked` via `loyalty_card_transition` uniquement + journal
   `loyalty_card_events` (append-only). Un lot volé `printed` ne vaut rien :
   l'activation n'a lieu qu'au premier crédit RÉUSSI chez un commerçant
   authentifié. **À la liaison**, les soldes des comptes-carte sont transférés
   vers les comptes-client puis la carte devient un alias — perdre une carte
   liée ne fait rien perdre.
4. **Bons discrets, valeur dans le ledger** : `loyalty_vouchers` (expirent)
   adossés 1:1 aux écritures `voucher_grant/redeem/expire` — le solde reste
   100 % dérivé du grand livre. Progression de palier = Σ`purchase_amount_da`
   (credit + transfer_in) − Σ`progress_consumed_da` (bons, via
   `granted_account_id` IMMUABLE) → survit aux transferts. Expiration
   **paresseuse** au point de vente (resolve/credit/redeem) ; la globale
   `loyalty_expire_vouchers()` existe (service_role) mais n'est pas en cron.
5. **Plafond 24 h par compte** (valeur : crédits + bons + bonus). Un palier
   au-delà du plafond est **DIFFÉRÉ, jamais silencieux** : réponses
   `voucher_deferred_da` (« Bon de X DA gagné — actif demain ») et la fiche
   POSE les bons différés dès que possible (`loyalty_grant_due_tiers` au
   resolve).
6. **Landing publique `/c/<code>`** : canal d'acquisition (soldes par magasin
   pour une carte anonyme, services, stores, inscription pré-remplie
   `?card=`). **Strictement aucune donnée personnelle** : une carte liée ne
   montre ni solde ni identité. Rate-limit IP (route) + par carte (RPC).
   Note : le peek ne dépend PAS du drapeau (une carte imprimée doit rester
   consultable) — les MOUVEMENTS, eux, sont coupés par le trigger.
7. **Hors-ligne caisse** : les CRÉDITS passent par la file Dexie
   (`loyalty_credit`, idempotent ; échec métier → `stale:true` = jeté
   proprement, jamais rejoué ; échec réseau → retry borné). Les DÉDUCTIONS ne
   sont JAMAIS mises en file : connexion exigée, échec réseau = « la
   déduction n'a PAS été confirmée » + retry MANUEL avec le MÊME
   `client_operation_id`.
8. **Iso-régression retrait** : les extracteurs PIN/référence vivent VERBATIM
   dans `lib/merchant/scan-detect.ts` (ne pas modifier) ; la détection
   fidélité s'insère AVANT eux ; verrouillé par `npm run test:scan`.

## Surfaces

- **Caisse** (`/orders/validate`) : détection auto du type
  (commande/carte/QR client/rejet), fiche 2 s (éligibilité en gros ou
  « il lui manque X DA » + barre), crédit d'achat, réduction (bon ou
  cashback, confirmation caissier), cas combiné 2.4 (crédit un-tap sur
  commande validée — montant = `net_total_da`, 1×/commande par index — et
  réduction à l'encaissement, masquée si payé en ligne). Vibrations + carillon
  fidélité distincts.
- **Commerçant** (`/fidelite`) : config du programme (cashback %, palier
  répétable X→Y, validité, plafond/24 h, bonus de liaison) avec simulation en
  direct ; bornes plateforme appliquées par RPC **et** trigger.
- **Client** : étape post-inscription `/inscription/carte` (Scanner / Saisir
  16 car. tolérant / **Passer aussi visible**, jamais bloquant, célébration) ;
  page « Cashback & Fidélité » (`/cashback`) en DEUX ONGLETS segmentés
  (panneaux montés + fondu) : Cashback (commandes app) vs Fidélité en magasin.
  Onglet Fidélité : hero au design de la carte physique (dégradé
  violet → rose tokens, facettes, QR personnel sur socle blanc `bg-on-brand`),
  cartes-magasins au même langage visuel, **recherche + tri locaux**
  (Solde/Progression/Nom, instantané), fiche magasin en feuille (solde
  « à dépenser ici uniquement », conditions du programme, progression COLORÉE
  avec pourcentage, bons, historique), plusieurs cartes liables au même
  compte, blocage carte, `?lier=CODE` / `?tab=fidelite` en deep-link.
- **Super-admin** (`/admin/merchants/fidelite`, domaine `commercants`) :
  bornes ; lots de cartes (4 modèles visuels — teintes uniques dans
  `lib/design/tokens` `LOYALTY_CARD`, partagées aperçus ↔ PDF) ; **lots
  GÉNÉRIQUES sans commerçant** (0459 — carte « valable chez tous »),
  impression du « Chez X » optionnelle, **cartes PRÉ-ACTIVÉES par défaut**
  (0460 — utilisables en caisse sans compte ni app, valeur nulle tant
  qu'aucun crédit commerçant n'est posé) ; journal agrégé
  (`admin_loyalty_batches`) avec badges pré-activé/sans-nom ; **PDF
  retéléchargeable à tout moment** (`/api/pdf/cartes-fidelite/[batchId]`,
  régénéré à la volée, `Content-Disposition: attachment` = téléchargement
  direct) ; outil support (recherche, blocage, déblocage, transfert).
  PDF : 1 carte/page recto puis verso (duplex), CR80 85,6×54 mm + fonds
  perdus 3 mm + traits de coupe, QR = `https://coligo.app/c/<code>`
  (`NEXT_PUBLIC_SITE_URL` — origine STABLE), assets de marque embarqués
  (`outputFileTracingIncludes` → `public/brand/**`).

## Design de RÉFÉRENCE + gestion des lots (17/08/2026, mig 0461)

- **Design des cartes = maquettes du propriétaire (11482/11483), à
  l'identique** : dégradé diagonal violet → rose à facettes (PNG pré-rendus
  `public/brand/loyalty-card-bg-<modèle>.png`, générés une fois — la MÊME
  image sert au PDF ET à l'aperçu console), logotype Coligo FR+AR
  (`brand/logo-full-white.png`), pilule « CARTE FIDÉLITÉ · بطاقة الوفاء »
  (texte arabe = PNG `brand/loyalty-ar-wafa-*.png`, pdf-lib ne façonne pas
  l'arabe), **QR à modules VIOLETS** sur panneau blanc arrondi, « CHEZ +
  commerçant », numéro mono en pied. Verso : QR de téléchargement (`/app`),
  badges stores flat, « SERVICES EXCLUSIFS » (icônes lucide au trait),
  service client. Côté app : `LoyaltyCardFace`
  (`components/customer/loyalty/card-face.tsx`) réplique le recto (héro « ma
  carte » + cartes-magasins) — couleurs FIXES, c'est l'objet physique.
- **Visuel PERSONNALISÉ par lot** : l'équipe Coligo peut fournir recto/verso
  (PNG/JPG, fond perdu compris, validés par MAGIC BYTES, bucket PRIVÉ
  `loyalty-card-art`, service_role après garde admin). Recto = image + QR +
  numéro SEULEMENT ; verso = image telle quelle.
- **Cycle de vie du LOT entier** : bloquer / débloquer (chaque carte
  retrouve son état d'avant blocage) / **supprimer (DOUX)** — le lot reste
  au journal (badge « supprimé »), chaque carte tracée dans
  `loyalty_card_events` + `admin_audit_log`. Recherche serveur du journal
  (nom / note / n° de lot / « générique »).
- **Téléchargement DIRECT du PDF partout** : `lib/native/download-file.ts`
  (fetch même-origine → Filesystem+Share en APK, `<a download>` en
  navigateur) — plus jamais la redirection WebView vers l'accueil.
- **Client** : onglet **Fidélité par DÉFAUT** sur `/cashback`
  (`?tab=cashback` force l'autre onglet) ; historiques **PAGINÉS 20/page**
  (« Voir plus » — fidélité `my_loyalty_history(p_offset)`, cashback et
  Coligo Pay par `range()`), hook partagé `useSeeMore`.
- **Commerçant** : sélecteur de mode **« Cashback % » / « Points
  (paliers) »** — points = taux 0 (accepté par le cœur : progression seule
  vers les bons), palier obligatoire.

## Tests

| Banc                                         | Contenu                                                                                                                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:loyalty`                       | 89 assertions en transaction ROLLBACK : activation carte `printed`, rejeu d'op (`already:true`), plafond, cloisonnement (FK), paliers/différé, déductions, liaison, perte/transfert, expiration, bornes, append-only, intégrité, kill-switch, cas combiné, phase ANON (chaque RPC). |
| `npm run test:scan`                          | Routage du scanner unifié — iso-régression PIN/référence + détection fidélité, zéro confusion entre espaces d'identifiants.                                                                                                                                                         |
| `npm run test:loyalty:pdf`                   | Géométrie d'impression, unicité par carte (flux décompressés), QR version basse (module ≥ 0,5 mm), 4 modèles. `--sample <f.pdf>` = tirage d'essai.                                                                                                                                  |
| `node scripts/verify-loyalty-prod-cycle.mjs` | Cycle RÉEL COMMITTÉ en prod (lot → activation → landing → liaison → réduction → vue client → intégrité), flag remis à l'état initial.                                                                                                                                               |

## Lancement (runbook)

**Le drapeau `loyalty` est ACTIF en prod depuis le 17/08/2026** (parcours
client + étape post-inscription visibles).

1. Tirage d'essai imprimeur validé (QR scannés sur papier, couleurs).
2. `/admin/controle` → « Fidélité (cartes + cashback commerçant) » pilote le
   kill-switch (hidden = trigger DB refuse tout mouvement, section client
   masquée, inscription inchangée).
3. Générer les premiers lots dans Commerçants → Fidélité, livrer les cartes.

## Dette volontaire

- Saisie MANUELLE du n° de carte côté CAISSE absente (l'onglet Code reste le
  PIN 4 chiffres ; le secours manuel vit côté client).
- Cron `loyalty_expire_vouchers` non branché (l'expiration paresseuse au
  point de vente garantit la justesse au moment décisif).
- `database.types.ts` non régénéré → RPC via `rpc.bind` casté (convention).
- Pas de revalidation temps réel de la section client (cache TanStack 30 s).
- Vérifs TERRAIN restantes : tirage imprimé réel, scanner sur tablette Sunmi,
  APK (deep link `coligo.app/c/…` via AppUrlListener), FR/AR visuel sur
  appareils, performance téléphones modestes.

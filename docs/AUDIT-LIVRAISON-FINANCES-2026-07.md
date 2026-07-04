# Audit livraison (express + tournée) & flux financiers — 04/07/2026

Périmètre : modules livreur (dispatch express par rayon, acceptation/refus,
tournées, validation retrait/remise), notifications, paiement en ligne,
cashback/Coligo Pay, annulations (client/commerçant/livreur/système), no-show,
et **conséquences financières de chaque cas** pour le commerçant, le client, le
livreur et Coligo (commissions). Sources auditées : triggers SQL en vigueur
(dernières versions : `generate_wallet_entries_on_completion` +
`generate_delivery_ledger_on_complete` → mig **0205**,
`compute_order_cashback_da` + `grant_customer_cashback_on_completion` → mig
**0291**, `driver_report_no_show` → mig **0164**, `validate_delivery` → mig
**0242**, annulations → mig **0128**, dispatch → mig **0182**), miroirs TS
(`lib/driver/settlement.ts`, `lib/finances/order-earnings.ts`,
`lib/finance/service-fee.ts`), actions serveur livreur/commerçant/checkout.

**Contrôle live exécuté le 04/07/2026 : `integrity_violations()` = 0 ligne
(base saine).** Réglages constatés : `driver_fee_rate=0` (lancement, livreur
garde 100 % de D), `driver_float_cap_da=8000`, `max_debt_da=10000`,
`tour_delivery_commission_rate=0.04`, `noshow_wait_min=8`,
`express_dispatch_radius_km=6`, `max_online_refund_cancels_30d=3`.

---

## 1. Cartographie des flux vérifiés

### 1.1 Sémantique financière d'une commande (source : checkout `actions.ts`)

```
P  = net_total_da  = produits nets après promos (base commission)
S  = service_fee_da (paliers sur le BRUT, garde-fou min sur le NET ; forcé à
     100 DA si noshow_pending)
D  = delivery_fee_da (express : barème plateforme → livreur ;
     tournée : prix commerçant → revenu commerçant)
R  = cashback_used_da + topup_used_da (wallets dépensés, plafonnés à P_client+S,
     jamais sur D)
total_da = P_client + S − R + D          ← **NET des wallets**
```

`total_da` est le montant réellement encaissé : cash remis au livreur (COD),
cash remis au comptoir (retrait), ou débit carte Chargily (online). Cette
sémantique est respectée partout côté SQL (custodian, remboursements) — voir
anomalie **A1** pour l'exception côté affichage commerçant.

### 1.2 Express — cycle nominal

1. Checkout → `orders` (pending). Online : invisible tant que non payé
   (gating 0068, `order_number` posé au webhook). Zones (0169) + dette
   commerçant (0269, express COD exclu) + kill-switch online_payment (0182)
   enforcés par triggers BEFORE INSERT.
2. Commerçant accepte (`preparing`) → push livreurs en ligne dans le rayon
   (`notifyDriversNewExpress` → `drivers_present_near`) + teaser livreurs hors
   ligne (`express_teaser_targets`). Re-push à `ready`.
3. **Attribution = PULL auto-assignant** : `pull_next_express_nearby` (0182)
   verrouille (`FOR UPDATE SKIP LOCKED`) la commande la plus proche non
   attribuée dans le rayon (zone perso prioritaire, clamp 0.5–50 km ; défaut
   plateforme 6 km), et pose `delivery_driver_id` immédiatement. Gardes :
   non gelé, non bloqué, pas de course active, pas de blocage
   `merchant_drivers`, pas de déclin < 10 min sur cette commande,
   smart-timing `prep_notif_at` (0060).
4. Refus = `release_express_order` (0056) : libère + cooldown 10 min
   (`express_declines`). Aucune pénalité financière (choix produit OK).
5. Retrait chez le commerçant : `mark_delivery_picked_up` (0242) — exige
   statut `preparing|ready` + attribution. **Pas de code côté commerçant**
   (remise sur confiance, le livreur clique lui-même).
6. Remise client : `validate_delivery` (0242) — exige `picked_up`, code PIN
   obligatoire si prépayé (online OU wallets>0), lockout 5 essais/10 min,
   idempotent.
7. `completed` → triggers financiers (voir §2).

### 1.3 Tournée — cycle nominal

Créneaux hebdo (`ensure_tour_slots`, 0204), capacité par créneau
(`enforce_slot_capacity`, 0164). Le livreur est un livreur DU commerçant
(`merchant_drivers` actif) : `start_tour` (0164) vérifie le lien + verrouille
le créneau, crée `delivery_tours` + `tour_stops` ordonnés,
ré-optimisation `reorder_tour_from`, auto-complétion `complete_tour_when_done`.
Le livreur tournée est payé HORS plateforme par son commerçant ; Coligo prélève
la **commission outil tournée** (4 % de D) au commerçant.

### 1.4 Validation retrait au comptoir (commandes pickup)

`validatePickupCode` (app/(merchant)/orders/actions.ts) : PIN 4 chiffres OU
référence ticket (A042). Ambiguïté de référence → refus + exige PIN.
Idempotence par `client_operation_id`. Pop-up needsReady (scanner QR). Voir
anomalie **A5** sur le chemin PIN.

---

## 2. Matrice financière — qui gagne/perd quoi, par cas

Notation : W-COM = wallet commerçant (`wallet_entries`), DL = custodian
livreur (`delivery_ledger`), PL = compta Coligo (`platform_ledger`),
W-CLI = wallet client (`customer_wallet_entries`). comm = round(P×taux),
df = driver_fee (aujourd'hui 0), tc = commission tournée (4 % de D),
cb = cashback gagné = `compute_order_cashback_da` (assiette (P+D−cashback_used)
× taux ; plafond COD : min(…, P/2, comm+S+(D express | tc tournée)) ; 0 si
échec livraison sauf online payé).

| Cas                                                     | Commerçant                                                                            | Livreur                                                                                               | Client                                                                                                               | Coligo                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Retrait CASH** completed                              | encaisse total_da ; W-COM : −comm −S +R                                               | —                                                                                                     | remet total_da ; +cb                                                                                                 | PL : +comm +S −cb                                                 |
| **Retrait ONLINE** payé+completed                       | W-COM : +P −comm                                                                      | —                                                                                                     | carte total_da ; +cb                                                                                                 | PL : +comm +S −chargily −cb ; détient S+D                         |
| **Express COD** completed                               | reçu P−comm en main du livreur (avance)                                               | DL : payout D−df ; cash_collected total_da ; owes_merchant P−comm ; owes_platform comm+S+df−R (SIGNÉ) | remet total_da ; +cb                                                                                                 | PL : −cb ; encaisse owes_platform au relevé                       |
| **Express ONLINE** payé+completed                       | W-COM : +P −comm                                                                      | DL : payout D−df (dû par Coligo)                                                                      | carte total_da ; +cb                                                                                                 | PL : +comm +S −chargily −cb ; garde D−payout                      |
| **Tournée CASH** completed                              | encaisse total_da (D compris) ; W-COM : −comm −S −tc +R                               | payé par le commerçant hors plateforme                                                                | remet total_da ; +cb (plafond avec tc)                                                                               | PL : +comm +S +tc −cb                                             |
| **Tournée ONLINE** payé+completed                       | W-COM : +P −comm +D −tc                                                               | idem                                                                                                  | carte total_da ; +cb                                                                                                 | PL : +comm +S +tc −chargily −cb                                   |
| **Annulation client** (pending seul ; cap 3 remb./30 j) | rien (jamais crédité)                                                                 | —                                                                                                     | online payé : +total_da sur Coligo Pay + re-crédit R (0116) = restitution exacte                                     | rien                                                              |
| **Annulation commerçant** (refusée si picked_up)        | rien ; réputation                                                                     | libéré (`driver_availability`)                                                                        | idem restitution exacte                                                                                              | rien                                                              |
| **Annulation admin/système** (0244/0295)                | rien                                                                                  | libéré                                                                                                | idem                                                                                                                 | alerte 0296 si paiement arrive après annulation                   |
| **No-show EXPRESS ONLINE payé** (0291)                  | crédité comme completed (sale+comm)                                                   | DL : payout D−df (« course payée »)                                                                   | perd total_da, **garde cb** (financé par comm)                                                                       | comm+S ; cb en charge                                             |
| **No-show EXPRESS CASH**                                | avance P−comm : selon décision support (retour marchandise / remboursée par Coligo)   | réclamation `driver_refund_claims` (avance) ; **course non payée** (voir A4)                          | pénalité = D prélevée sur cashback puis topup (best effort) ; `noshow_pending` → S=100 DA ensuite ; `noshow_count`++ | garde la pénalité ; `noshow_advance_expense` si avance remboursée |
| **No-show TOURNÉE CASH**                                | pénalité récupérée **reversée** au commerçant (son livreur/carburant) ; stop `failed` | payé hors plateforme (perte commerçant)                                                               | idem pénalité + flags                                                                                                | neutre                                                            |
| **Refus express (livreur)**                             | attente d'un autre livreur                                                            | cooldown 10 min, aucune pénalité                                                                      | attente                                                                                                              | —                                                                 |
| **Wallets dépensés (R>0)**                              | cash : W-COM +R (`wallet_redemption`) — jamais lésé                                   | COD : owes_platform −R (peut devenir négatif = Coligo doit au livreur)                                | payé moins d'espèces/carte                                                                                           | finance R (extinction de float/passif)                            |

**Identités de réconciliation vérifiées (algèbre re-déroulée, cohérente) :**

- COD express : `cash_collected − owes_merchant − owes_platform − payout ≡ 0`
  → (P+S+D−R) − (P−comm) − (comm+S+df−R) − (D−df) = 0 ✓
- Cash retrait/tournée : `ΔW-COM + ΔPL + ΔW-CLI ≡ 0` (hors cash physique) ✓
- Online : Chargily encaisse total_da (net de R) ; commerçant +P−comm ;
  le float wallets détenu par Coligo finance R ✓
- Annulation online payée : total_da (Coligo Pay) + R re-crédité
  = exactement ce que le client a déboursé ✓ (remboursement vers Coligo Pay,
  pas vers la carte — choix produit assumé, à afficher clairement au client).

---

## 3. ANOMALIES DÉTECTÉES

### A1 — MAJEUR (affichage financier commerçant) : double soustraction des wallets

`lib/finances/order-earnings.ts:130` :
`cashCollected = max(0, total_da − redeemed)` alors que **total_da est déjà net
des wallets** (checkout `actions.ts:822` + `:1128`). Sur un retrait/tournée
CASH où le client a payé une partie en cashback/Coligo Pay, le commerçant voit
des « espèces remises » sous-évaluées de R. Le SQL (custodian, wallet) est
correct — bug d'affichage/pédagogie uniquement, mais c'est le chiffre que le
commerçant rapproche de sa caisse → tickets support garantis.
**Fix attendu : `cashCollected = total_da`.** (Le commentaire d'en-tête du
fichier « miroir mig 0127 » est aussi périmé — la prod est 0205/0291.)

### A2 — MAJEUR (risque trésorerie) : plafond d'encours livreur jamais appliqué

`driver_can_accept()` (mig 0103, plafond `driver_float_cap_da=8000` DA) n'est
appelé **nulle part** : ni `pull_next_express_nearby` (0182 — ne vérifie que
gelé/bloqué), ni les actions livreur. Un livreur peut accumuler un encours COD
illimité (cash collecté non reversé) et continuer à recevoir des courses. Seuls
existent l'alerte admin (0277) et le gel manuel. **Fix attendu : ajouter
`AND public.driver_can_accept(v_driver_id)` dans le pull (ou un filtre
équivalent inliné).**

### A3 — MAJEUR (réseau) : attribution pull sans timeout de libération

Le pull pose `delivery_driver_id` immédiatement. Si le livreur disparaît sans
décliner (crash, batterie, mauvaise foi), la commande reste verrouillée : seule
`admin_reassign_delivery` (0107) la libère. Aucun cron de libération
automatique (`app/api/cron/` : rien). Vecteur de gel du réseau (un livreur
malveillant peut « aspirer » chaque nouvelle course et s'asseoir dessus).
**Fix attendu : watchdog serveur — libération auto si non `picked_up` après N
min sans heartbeat/progression + re-dispatch + éventuel malus.**

### A4 — À ARBITRER (équité livreur) : no-show CASH express, course non payée

`driver_report_no_show` (0164) : en ONLINE payé le livreur touche
`driver_payout = D−df` ; en CASH il ne touche **rien** pour la course (seul le
remboursement de l'avance marchandise P−comm est réclamable, validé support).
Pourtant la pénalité client (= D) prélevée sur ses wallets **reste à la
plateforme** avec le commentaire « c'est elle qui indemnise le livreur » — or
aucune écriture n'indemnise la course. Incohérence produit/code : soit on paie
la course sur la pénalité récupérée, soit on documente que le livreur assume.

### A5 — MINEUR (robustesse + règle maison) : `validatePickupCode`, chemin PIN

`app/(merchant)/orders/actions.ts:267-272` : lookup
`.eq("pickup_code", …).maybeSingle()` — (a) sans `.eq("merchant_id", …)`
explicite (contraire à la règle anti-fuite RLS du projet) ; (b) le PIN 4
chiffres n'est pas unique : 2 commandes vivantes avec le même code →
`maybeSingle()` échoue → comptoir bloqué sans message exploitable. Le chemin
« référence » gère l'ambiguïté, pas le chemin PIN. **Fix : scoper merchant_id +
filtrer statuts vivants + gérer le doublon comme le chemin référence.**

### A6 — À VÉRIFIER (kill-switch) : express/tournée sans garde INSERT

Les triggers feature-flags (0182) couvrent online_payment, coligo_pay, drive,
cashback — **pas** `express`/`tour` au INSERT de commande, et
`pull_next_express_nearby` n'appelle pas `feature_blocked`. Si /admin/contrôle
coupe la livraison express, vérifier qu'un client ne peut plus commander en
express (probable garde UI seulement → bypassable API).

### A7 — INFO (dérive documentaire) : miroirs TS vs SQL

`order-earnings.ts` (« miroir 0127 ») et `settlement.ts` (« miroir 0103 »)
estiment commission/cashback avec des formules antérieures à 0205/0291
(assiette cashback P+D, plafond tournée avec tc, exception no-show online).
Les montants **figés** sont relus une fois finalisés (OK), mais les
**estimations** avant finalisation peuvent différer du réel. À réaligner ou
à assumer comme estimation.

### Points sains confirmés (non exhaustif)

Idempotence systématique (`ON CONFLICT (order_id, type) DO NOTHING`,
`client_operation_id`, `FOR UPDATE`) ; gating 0068 ; remboursements exacts
(total_da net + re-crédits R) ; anti-abus annulations online (3/30 j) ;
no-refund si no-show ; lockout PIN (0242) ; séquencement pickup→delivery
(0242) ; dette commerçant plafonnée avec exclusion correcte de l'express COD
(0269) ; cashback anti-boucle + plafond COD (0205) ; pénalité no-show douce et
traçée (0116/0162/0164) ; commission tournée dans le plafond cashback (0164) ;
colonnes financières protégées (0166) ; `integrity_violations()` = source
unique (0298) — **0 violation en prod ce jour**.

---

## 4. PLAN DE TESTS INTENSIFS

Objectif : prouver le comportement de CHAQUE cas de la matrice §2 + tuer les
anomalies §3. Réutiliser : harnais `scripts/loadtest` (pièges connus :
`SET ROLE authenticated`, pooler 6543, réplica pour le nettoyage), comptes de
test (mot de passe = identifiant), exécution DB directe service_role.

**Règle d'or : après CHAQUE scénario, exécuter le contrôle §4.8** (invariants +
identités par commande). Un scénario n'est « vert » que si les écritures ET les
invariants passent.

### 4.0 Préparation

- Jeu de données : 2 commerçants (taux commission différents, un à
  `max_debt_da` presque atteint), 3 livreurs express (dont 1 avec encours
  proche de 8 000 DA), 1 livreur tournée lié, 3 clients (dont 1 avec
  `noshow_pending`, 1 avec soldes cashback/topup garnis).
- Figer/mémoriser `platform_settings` ; tester AUSSI avec `driver_fee_rate`
  non nul (ex. 0.08) car la prod est à 0 → les formules driver_fee sont
  aujourd'hui masquées.
- Sandbox : jamais sur les vraies écritures ; nettoyage par réplica.

### 4.1 Unitaires purs TS (vitest, aucun réseau)

- `computeDriverFee/Net` : D=0, D=1, min>cap, rate=0 (prod), rate=0.08,
  arrondis .5, D très grand. Propriété : 0 ≤ fee ≤ D.
- `computeDriverBreakdown` : les 6 cas de la matrice ; propriété :
  cash_collected − owes_merchant − owes_platform − payout = 0 (cash).
- `computeMerchantEarnings` : cas R>0 en cash → **test de régression A1**
  (`cashCollected === total_da`) ; walletImpact = miroir exact des écritures
  0205 pour les 6 cas ; finalized vs estimé.
- `resolveServiceFeeDa` : paliers brut/net, garde-fou promo agressive,
  tiers JSONB malformés (`parseTiers`).
- `cashToCollectDa` : cash=total_da, online=0.

### 4.2 Triggers SQL — matrice de complétion (pg direct, un scénario = une tx)

Grille : {cash, online} × {retrait, express, tournée} × R ∈ {0, partiel,
P_client+S (max)} × promo ∈ {aucune, marchand, plateforme} × cashback_rate
∈ {0, 3 %}. Pour chaque cellule, asserter **la liste exacte** des lignes
`wallet_entries` / `delivery_ledger` / `platform_ledger` /
`customer_wallet_entries` / `cashback_grants` (types + montants au DA près,
recalculés indépendamment) et les snapshots `orders.*_applied`.
Cas vicieux : P=0 (promo 100 %), D=0, commission arrondie .5, re-complétion
(UPDATE completed→completed = aucune double écriture), complétion concurrente
(2 tx simultanées → une seule série d'écritures).

### 4.3 Annulations — tous acteurs

1. Client : pending cash ✓ ; pending online non payé (refund 0) ; pending
   online payé (refund total_da + R, `payment_status=refunded`) ; 4ᵉ annulation
   remboursable en 30 j → REFUS ; commande déjà `preparing` → refus ;
   double-clic concurrent → une seule exécution.
2. Commerçant : pending/preparing ✓ + remboursement ; après
   `delivery_picked_up_at` → `already_picked_up` ; libération
   `driver_availability` ; push `notifyDriverOrderCancelled`.
3. Admin : tout statut non terminal ; refund ; terminal → refus.
4. Système : `expire_stale_pending_orders` (0244) + `expire_unpaid_online`
   (0295) ; webhook `paid` APRÈS annulation → alerte 0296 déclenchée.
5. Vérifier pour CHAQUE annulation : aucun crédit commerçant, aucun
   cashback, re-crédits R corrects, restitution client = déboursé exact.

### 4.4 No-show — les 4 variantes

- Express cash : trop tôt (< 8 min) → `too_early` ; client a écrit dans le
  chat → délai simple sinon double (16 min) ; pénalité D prélevée cashback
  puis topup (cas : soldes 0 / partiels / suffisants) ; `noshow_pending` levé
  seulement si non couvert ; commande suivante S=100 DA puis flag apuré
  (`clear_noshow_pending_on_complete`) ; claim avance créée = P−comm ;
  résolution support : rejet / retour marchandise (aucune écriture) /
  driver_keeps & give_away (`driver_advance_refund` + `noshow_advance_expense`)
  ; double résolution → `already_resolved`. **Documenter le résultat A4**
  (course non payée) comme comportement actuel.
- Express online payé : payout livreur, crédit commerçant complet, client
  garde le cashback (0291), AUCUN re-crédit R, pénalité wallet NON prélevée.
- Tournée cash : stop `failed`, tournée peut se terminer, pénalité récupérée
  REVERSÉE au commerçant (`wallet_entries.adjustment`).
- Gardes : non attribué / pas picked_up / pas arrived / déjà clos → refus.

### 4.5 Dispatch & réseau livreurs (express)

- Rayon : commande à 5,9 km ✓ / 6,1 km ✗ ; zone perso prioritaire (commande
  hors zone mais proche de la position live → invisible) ; clamps 0.5/50.
- Concurrence : 30 livreurs pull simultanément 10 commandes → chaque commande
  attribuée à EXACTEMENT un livreur (SKIP LOCKED), les plus proches d'abord.
- Refus : cooldown 10 min sur la commande refusée (re-pull → autre commande) ;
  refus en boucle → pas d'auto-suspension (constat à arbitrer).
- Une seule course active : pull avec course en cours → vide.
- Gel/blocage : `is_frozen`/`is_blocked`/`merchant_drivers.blocked` → invisibles.
- **A2 : livreur avec encours ≥ 8 000 DA → le test DOIT échouer aujourd'hui**
  (il reçoit encore des courses) — test rouge à garder jusqu'au fix.
- **A3 : pull puis silence 15 min → constat commande gelée** — test rouge.
- Notifications : `preparing`/`ready` → push en ligne dans le rayon
  (`drivers_present_near`) + teaser hors ligne throttlé ; commande attribuée →
  plus aucun push ; kill-switch dispatch (0182) coupe bien le pull (A6 :
  vérifier aussi le blocage à l'INSERT côté client).
- Reprise arrière-plan : livreur qui revient au premier plan resynchronise
  (course annulée pendant l'absence → bannière/redirect, pas d'action sur
  état mort).

### 4.6 Retrait & remise (validation)

- Comptoir : PIN correct ✓ ; PIN d'un AUTRE commerçant → introuvable
  (**A5 : + cas 2 commandes vivantes même PIN → doit guider, pas crasher**) ;
  référence ambiguë → exige PIN ; needsReady (commande pas prête) → pop-up 2
  boutons ; idempotence retry réseau.
- Livreur : `mark_delivery_picked_up` refusé si status hors preparing/ready ;
  `validate_delivery` refusé si pas picked_up ; prépayé (online OU R>0) →
  code OBLIGATOIRE, `skip_code` refusé ; cash pur → skip autorisé ; 5 PIN faux
  → lockout 10 min (6ᵉ = `too_many_attempts` même avec le BON code) ; reset
  après succès ; `already_delivered` idempotent.
- Tournée : `mark_tour_picked_up`, réordonnancement, capacité créneau
  (`enforce_slot_capacity`), `start_tour` concurrent sur le même slot,
  auto-complétion de la tournée quand tous les stops sont terminés/failed.

### 4.7 Abus & limites

- Client : 3 annulations remboursées/30 j puis blocage ; no-show répétés →
  `customer_cod_allowed` (COD bloqué au seuil) ; brute-force PIN (couvert
  4.6) ; wallet double-spend (2 checkouts simultanés avec le même solde,
  mig 0070) ; commande online < 50 DA après wallets → refus checkout.
- Commerçant : dette = cap 10 000 → INSERT cash retrait/tournée REFUSÉ,
  online PERMIS, express COD PERMIS (0269) ; tentative de modifier une
  colonne financière d'orders → trigger 0166 ; annulation post-pickup → refus.
- Livreur : valider sans code une prépayée → refus ; no-show avant délai →
  refus ; re-pull de la commande refusée < 10 min → invisible ; encours (A2).
- Charge (scripts/loadtest) : 200 commandes/h mixtes + 50 livreurs, puis §4.8
  global ; latence du pull sous contention.

### 4.8 Réconciliation comptable (après CHAQUE scénario et en fin de charge)

```sql
SELECT * FROM public.integrity_violations();          -- attendu : 0 ligne
-- Par commande touchée :
--  COD express : cash_collected − owes_merchant − owes_platform − payout = 0
--  cash retrait/tournée : Σwallet_entries + Σplatform_ledger(commande)
--                          + Σcustomer_wallet_entries(commande) = 0
--  online : sale = net_total ; commission = round(net×taux figé) ;
--           refund ⇒ aucune écriture de complétion
--  cashback : customer_wallet_entries.cashback_earned = orders.cashback_da
--             = cashback_grants.amount_da = −platform_ledger.cashback_expense
```

Ajouter à `integrity_violations()` (UNION ALL — règle maison) les invariants
qui manquent aujourd'hui : identité custodian COD ≡ 0 ; symétrie
cashback_expense/cashback_earned ; `wallet_redemption` ≤ R de la commande ;
commande attribuée non picked_up depuis > N min (détection A3).

### Ordre d'exécution conseillé

1. 4.1 (rapide, bloque les régressions de formule) → 2) 4.2 → 3) 4.3/4.4 →
2. 4.5/4.6 → 5) 4.7 → 6) charge + 4.8 global. Les tests rouges A1–A3 restent
   dans la suite jusqu'aux fixes ; A4/A6 attendent un arbitrage produit.

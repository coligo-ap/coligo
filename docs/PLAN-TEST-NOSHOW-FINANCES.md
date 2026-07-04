# Plan de test — no-show & calculs d'argent (livraison)

Harnais exécutable : `npm run test:noshow:money`
(`scripts/tests/noshow-money-verification.mjs`).

**Sûreté** : tout tourne dans **UNE transaction** puis **ROLLBACK** — la prod
n'est jamais modifiée (vérifié : 0 ligne de test résiduelle, `platform_settings`
intactes, `integrity_violations()=0` après coup). Les taux sont **figés dans la
transaction** pour des montants déterministes : commission 10 %, cashback 5 %,
chargily 2 %, driver_fee 8 % (cap 10 %, min 10), commission tournée 4 %,
minuteur no-show 8 min, géofence 150 m.

Méthode : pour chaque scénario on pose une commande, on déclenche les **vrais
triggers/RPC**, puis on **recalcule indépendamment** le montant attendu (JS) et
on le compare aux écritures réelles (`wallet_entries`, `platform_ledger`,
`delivery_ledger`, `customer_wallet_entries`) + on vérifie les **identités de
réconciliation**.

Résultat courant : **85 assertions, 0 échec.**

---

## A. Matrice de complétion (calculs d'argent) — base P=1000, S=20, D=200

| #   | Cas                                    | Vérifie                                                                                                                                   |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Retrait CASH                           | wallet −comm/−S, platform +comm/+S/−cashback, cashback client ; **Σ(wallet+platform+client)=0**                                           |
| A2  | Retrait ONLINE                         | sale +P, −comm, chargily sur total, cashback                                                                                              |
| A3  | Express COD                            | payout D−fee=184, cash_collected total, owes_merchant P−comm=900, owes_platform=136, aucun wallet commerçant ; **identité custodian = 0** |
| A3b | Express COD + cashback dépensé (R=200) | owes_platform SIGNÉ = −64, cash_collected = total NET ; **identité custodian = 0**                                                        |
| A4  | Express ONLINE                         | payout 184 + sale/commission + chargily + cashback                                                                                        |
| A5  | Tournée CASH                           | −comm/−S/−tour_comm(8), pas de delivery_revenue, pas de custodian ; **Σ=0**                                                               |
| A6  | Tournée ONLINE                         | sale + delivery_revenue(200) − tour_comm(8) + platform tour_income                                                                        |

**Identités prouvées** : COD `cash_collected − owes_merchant − owes_platform −
payout = 0` (avec et sans cashback dépensé) ; cash retrait/tournée `Σ wallet +
Σ platform + Σ client = 0`.

## B. No-show — les règles produit décidées

| #   | Cas                                          | Vérifie                                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | **Cash EXPRESS** no-show                     | statut cancelled ; **AUCUN payout livreur** ; aucun crédit commerçant ; aucun cashback ; **avance réclamée = P−comm=900** (validation support) ; **pénalité = D** prélevée cashback→topup                                                                                            |
| B2  | **Cash TOURNÉE** no-show                     | **plateforme NEUTRE** : aucun reversement commerçant, aucune pénalité client, aucun custodian, aucune écriture plateforme ; arrêt tournée `failed` ; compteur no-show +1                                                                                                             |
| B3  | `driver_report_no_show` sur **ONLINE**       | renvoie `use_leave_at_door`, commande **NON annulée**                                                                                                                                                                                                                                |
| B4  | `driver_confirm_arrival` géofence            | loin (~14 km) → `too_far` ; proche (~60 m) → ok, `delivery_arrived_at` posé                                                                                                                                                                                                          |
| B5  | `driver_leave_at_door` (online, express)     | préconditions : sans appel → `call_required` ; sans message → `message_required` ; sans photo → `photo_required` ; minuteur non écoulé → `too_early` ; **tout OK** → completed + `left_at_door` + preuve enregistrée + **livreur payé + commerçant payé + cashback client conservé** |
| B6  | `driver_leave_at_door` (online, **tournée**) | completed ; **delivery_revenue au commerçant** ; **pas de payout plateforme** ; arrêt `delivered`                                                                                                                                                                                    |
| B7  | `admin_confirm_online_noshow` (super-admin)  | completed + `support_confirmed` + **livreur/commerçant payés + cashback client**                                                                                                                                                                                                     |

## C. Garde-fous dispatch (plafond encours COD, anomalie A2 de l'audit)

- C1 : encours faible → `driver_can_accept = true`.
- C2 : encours ≥ plafond (8000) → `driver_can_accept = false` (les commandes
  espèces sont retirées du dispatch, cf. mig 0323).

## D. Intégrité globale

- `integrity_violations() = 0` à l'intérieur de la transaction (aucune dérive
  introduite par les scénarios).

---

## Ce qui reste hors périmètre du harnais (à couvrir en test manuel/APK)

- Parcours UI réel livreur (bouton Appeler → `noteCallAttempt`, capture photo,
  upload bucket `delivery-proofs`) : nécessite l'app (Capacitor géoloc).
- Affichage client de la preuve + suivi live de la position (déjà en place,
  mig 0050) : vérification visuelle sur `/commandes/[id]`.
- Kill-switch express/tour au checkout : à exercer via l'UI admin `/admin/controle`.

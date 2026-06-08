# Livreur — règles financières & règlement

Modèle COD façon Yassir/inDrive, **100 % configurable et snapshotté par
commande**. Source de vérité : migration `0103_driver_payment_model.sql`
(trigger SQL). Miroir d'affichage/tests : `lib/driver/settlement.ts`.

> Décisions fondateur figées (juin 2026) :
>
> 1. `driver_fee_rate` = **8 %** sur la livraison `D` (plancher 10 DA, plafond 10 %).
> 2. `service_fee` `S` → **100 % plateforme**.
> 3. Réconciliation COD = **le livreur est le seul custodian du cash** (cf. §4).
>    App pas encore lancée → modèle propre dès le départ, aucune reprise.

## 1. Principe — le sens du règlement dépend du mode de paiement

- **COD / cash** (majorité Algérie) : le livreur encaisse le cash chez le
  client → il détient l'argent de la plateforme → **livreur → plateforme**.
- **Prépayé** (wallet/cashback/carte) : la plateforme détient déjà l'argent →
  elle **paie** au livreur ses frais de livraison nets → **plateforme → livreur**.

Le relevé de période **nette les deux flux** et affiche un **solde unique**.
Encaissement/versement via **CCP / BaridiMob / virement** (comme commerçants).

## 2. Paramètres (`platform_settings`, configurables — jamais codés en dur)

| Clé                                       | Défaut          | Base                        | Qui paie            |
| ----------------------------------------- | --------------- | --------------------------- | ------------------- |
| `commission_cash/online`                  | 8 %\*           | produits nets `P`           | déduit commerçant   |
| `cashback_cash`                           | 0 %             | `P`                         | plateforme          |
| `cashback_online`                         | 3 %             | `P`                         | plateforme          |
| `service_fee` (`service_fee_da` snapshot) | barème 40/30/20 | —                           | client → plateforme |
| `driver_fee_rate`                         | **8 %**         | livraison `D` uniquement    | déduit livreur      |
| `driver_fee_min_da`                       | **10**          | plancher / course           | —                   |
| `driver_fee_cap_rate`                     | **10 %**        | plafond sur `D`             | —                   |
| `driver_float_cap_da`                     | **8000**        | encours cash dû par livreur | —                   |
| `driver_settlement_cycle`                 | `weekly`        | `weekly` \| `monthly`       | —                   |

\* `commission_*` défaut DB = 8 % ; l'exemple du PROMPT utilise 5 % — la valeur
réelle vient toujours de `resolve_rate(merchant, key)` (commerçant ?? global) et
est **figée** dans `orders.commission_rate_applied` / `commission_da` à la
complétion. Aucune commande déjà passée n'est jamais réaffectée par un
changement de tarif.

**Snapshots figés sur `orders`** : `driver_fee_rate_applied`, `driver_fee_da`,
`driver_net_da`, `driver_owes_platform_da`, `driver_owes_merchant_da`,
`driver_cash_collected_da` (+ `commission_da`, `*_rate_applied`).

`driver_fee = max(min, min(D×rate, D×cap))`, borné par `D`, `0` si `D=0`.

## 3. Flux d'une commande COD (le cœur)

Exemple : `P=2000`, commission 5 %=`100`, `S=50`, `D=200`,
`driver_fee=max(10,min(16,20))=16`, cashback `0`.

1. **Retrait** — le livreur avance au commerçant `P − commission = 1900`.
2. **Livraison** — le client paie `P + S + D − cashback = 2250` en espèces.
3. **Le livreur détient** `2250 − 1900 = 350` (= commission + S + D).
4. **Règlement** : garde `D − driver_fee = 184` ; reverse
   `commission + S + driver_fee = 166`. Vérif `184 + 166 = 350` ✅.
5. **Plateforme** (166) = `+60` commission nette · `+50` service · `+16` marge
   livraison · `+40` provision cashback. Toujours positive.

### Garde-fou cashback (COD)

`cashback_utilisé ≤ min(50 % de P, commission + S + D)` — appliqué dans le
trigger, pour que le cash encaissé couvre toujours l'avance commerçant (le
livreur n'est jamais de sa poche). `cashback_cash` vaut 0 par défaut.

## 4. Réconciliation — pourquoi le wallet commerçant ne bouge pas en COD livré

Sur une commande **cash + livraison + livreur assigné**, le trigger commerçant
`generate_wallet_entries_on_completion()` **skippe** (aucune écriture
`wallet_entries` / `platform_ledger`) : le commerçant a déjà été payé en
espèces `P − commission` par le livreur au retrait, et c'est **le livreur** qui
porte commission + S vers la plateforme via `delivery_ledger`. Sans ce skip, la
plateforme réclamerait sa commission **deux fois** (commerçant + livreur).

Cas **non** concernés (inchangés) : cash pickup, online pickup, **online
livraison** (la plateforme a déjà l'argent via Chargily ; seul `driver_payout`
est ajouté au `delivery_ledger`).

## 5. Commande prépayée (online)

À la livraison validée : `merchant_payout = P − commission` (wallet commerçant),
`driver_payout = D − driver_fee` (delivery_ledger, dû par la plateforme),
cashback crédité au client. Aucune manipulation de cash par le livreur.

## 6. Écritures `delivery_ledger` (append-only, idempotent `UNIQUE(order_id,type)`)

| type                    | COD            | Prépayé        | Sens                 |
| ----------------------- | -------------- | -------------- | -------------------- |
| `driver_payout`         | D − driver_fee | D − driver_fee | gain net livreur     |
| `driver_cash_collected` | total_da       | —              | info (cash en main)  |
| `driver_owes_merchant`  | P − commission | —              | avance (réglée cash) |
| `driver_owes_platform`  | comm+S+fee−cb  | —              | **à reverser**       |

## 7. Relevé & règlement (`driver_statements`, immuable)

RPC `generate_driver_statements(period_start, period_end)` (cron
`/api/cron/driver-payouts`, 07:00, gardé par `CRON_SECRET`) :

- Agrège par livreur les écritures **non réglées** de la période, crée un relevé
  immuable (nb livraisons, gains bruts, commissions, frais service, part Coligo
  livraison, cashback provisionné, à reverser, à recevoir, **net**), puis marque
  les écritures `settled_at` + `statement_id`.
- `net = Σ driver_net(prépayé) − Σ owes_platform(cod)` :
  - `net > 0` → **plateforme doit au livreur** (virement).
  - `net < 0` → **livreur doit reverser** (versement CCP / point de collecte).
- Idempotent : `UNIQUE(driver_id, period_start, period_end)` + écritures non
  réglées seulement. Cron quotidien, génération uniquement le **lundi** (weekly)
  ou le **1er** (monthly).

## 8. Float / anti-fraude (esprit Yassir)

- `driver_outstanding(driver_id)` = Σ `owes_platform` non réglés − Σ
  `driver_payout` prépayés non réglés (borné ≥ 0) = cash plateforme détenu.
- `driver_can_accept(driver_id)` = `NON gelé` **ET** `outstanding < float_cap`
  (8000). Au-delà du plafond → acceptation suspendue jusqu'au versement.
- Gel super-admin : `drivers.is_frozen` (déjà en place, 0042). RLS : un livreur
  ne voit que ses propres `delivery_ledger` / `driver_statements`.
- Idempotency offline : `client_operation_id` (existant) sur les transitions.

## 9. Cas limites

- **Client absent / refus** : retour commerçant (le livreur récupère son avance)
  ou frais d'échec → à tracer dans `order_events`. _(annulation/no-show COD =
  suite à coder, cf. lot facturation.)_
- **Annulation après retrait** : l'avance commerçant est déjà faite → gérer
  remboursement/retour.
- **Appoint manquant / paiement partiel** : enregistrer l'écart, l'imputer au
  prochain relevé (écriture `adjustment`, note obligatoire).
- **Cashback > plafond COD** : excédent refusé au paiement (cf. §3).
- **Plusieurs commandes même tournée** : chaque commande génère ses écritures ;
  le relevé agrège par livreur sur la période.

## 10. Tests

`npm run test:driver:money` — valide la config réelle contre la référence
(16 / 184 / 1900 / 2250 / 166) + présence des fonctions.

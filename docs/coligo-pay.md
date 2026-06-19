# Coligo Pay — commissions, cashback, livraison, tournée & Drive

> Référence d'implémentation alignée sur `SPEC-COLIGO-PAY.md`.
> Migrations clés : `0010` (taux + ledger), `0017` (wallet cashback client),
> `0084-0089` (Coligo Pay), `0116/0118/0121` (custodian/tournée),
> `0124-0128` (audit trésorerie), `0184-0203` (wallets opérateurs),
> **`0205` (config spec + assiette cashback unifiée)**, **`0206` (P2P off)**.

## 1. Principe : aucune valeur financière en dur

Tous les taux/prix/plafonds/paliers vivent dans **`platform_settings`** (ligne
unique `id=true`, éditable super-admin). C'est la table de config du ch.1. Le
code métier lit via `resolve_rate(merchant_id, key)` (commission/cashback, avec
surcharge par commerçant) ou directement les colonnes.

Clés ajoutées par la spec (mig 0205) :

| Clé                             | Défaut | Usage                                                    |
| ------------------------------- | ------ | -------------------------------------------------------- |
| `tour_discount_rate`            | 0.40   | Réduction tournée vs express (défaut des bandes de prix) |
| `cashback_consumption_estimate` | 0.70   | Reporting uniquement                                     |
| `sub_priority_monthly_da`       | 300    | Abonnement Prioritaire (DA/mois)                         |
| `sub_priority_first_month_da`   | 100    | Promo 1er mois                                           |
| `withdrawal_fee_tiers`          | JSON   | Paliers retrait { up_to, fee_agent, fee_coligo }         |
| `p2p_enabled`                   | false  | Kill-switch P2P (ch.0.10)                                |

Équivalences avec les clés du ch.1 déjà présentes : `commission_courier_rate`
→ `driver_fee_rate` ; `commission_tour_tool_rate` → `tour_delivery_commission_rate` ;
`recharge_cap_sliding` → `max_topup_da_per_30d` ; `merchant_min_float` /
`courier_min_float` → `neg_threshold_merchant_da` / `neg_threshold_driver_da`
(planchers de float, signés) ; `delivery_price_cap_per_km` → barème
`delivery_per_km_da` + `delivery_max_da`.

### Valeurs de lancement retenues (ch.8, mig 0207)

| Clé                               | Lancement | Phase 2 (config) | Note                                 |
| --------------------------------- | --------- | ---------------- | ------------------------------------ |
| `commission_cash` / `_online`     | 0.08      | 0.08             | Vraie marge produits (inchangé)      |
| `driver_fee_rate` (express)       | 0.08      | 0.08             | Commission livraison livreur         |
| `cashback_online` / `_cash`       | 0.03      | 0.03             | Cashback marketplace UNIQUE à 3 %    |
| `tour_delivery_commission_rate`   | 0.04      | 0.04             | Outil tournée seul (pas le dispatch) |
| `vtc_commission_rate` (Drive)     | 0.00      | 0.05 (Gratuit)   | Acquisition chauffeurs               |
| `drive_cashback_rate`             | 0.00      | 0.02             | Cashback Drive (avec frais service)  |
| frais de service Drive            | 0.00      | 0.03             | Pas de clé : client paie en direct   |
| `service_fee_tiers` (marketplace) | 40/30/20  | 40/30/20         | ACTIF (frais service livraison)      |
| `drive_plan_pro_fee_da`           | 1500      | 1500             | Abo Pro (3,5 %)                      |

Règle ch.8 : **frais de service et cashback s'activent ENSEMBLE**. Au lancement
Drive = 0 commission / 0 frais service / 0 cashback (gratuit, acquisition pure).
Les 3 exemples chiffrés de la spec sont vérifiés au dinar près par
`node scripts/verify-spec-examples.mjs` (express 1350 → cashback 39 ; tournée
1180 → Coligo 87, cashback 35 ; Drive 350 → Coligo 0, chauffeur garde 350).

## 2. Double solde (client)

Le wallet client a deux poches **strictement séparées** dans
`customer_wallet_entries.source` :

- `topup` → **solde réel** (rechargé Chargily/agent). Sert au paiement. Captif
  (le client ne retire jamais).
- `cashback` → **solde cashback**. Non retirable, non transférable, paiement
  uniquement. Soldes lus par `customer_topup_balance()` /
  `customer_cashback_balance()`.

Interdits codés : pas de cashback→réel, pas de retrait depuis cashback, pas de
cashback crédité sur le réel.

## 3. Commissions par mode

Chaque partie paie SA commission via SON float prépayé — Coligo n'a jamais de
créance.

| Mode            | Pilote         | Commission produits    | Commission livraison                               | Paie Coligo          |
| --------------- | -------------- | ---------------------- | -------------------------------------------------- | -------------------- |
| Click & collect | Commerçant     | 8 % (float commerçant) | —                                                  | Commerçant           |
| Express         | Coligo         | 8 % (float commerçant) | `driver_fee_rate` 8 % (livreur)                    | Commerçant + Livreur |
| Tournée         | **Commerçant** | 8 % (float commerçant) | `tour_delivery_commission_rate` (float commerçant) | **Commerçant seul**  |
| Drive           | —              | `vtc_commission_rate`  | —                                                  | configurable         |

En EXPRESS COD le **livreur est seul custodian** du cash
(`generate_delivery_ledger_on_complete`) ; en TOURNÉE tout passe par le wallet
commerçant (`generate_wallet_entries_on_completion`).

## 4. Cashback — assiette unifiée (mig 0205)

Fonction canonique **`compute_order_cashback_da(orders)`**, appelée par les
**trois** sites de calcul (crédit client, charge plateforme online/tournée,
charge plateforme COD express) → plus aucune dérive possible.

```
eligible = produits_nets + frais_de_livraison        -- ch.4.2 (jamais le frais de service)
base     = max(0, eligible − cashback_dépensé)        -- ch.4.1 anti-boucle
gagné    = round(base × taux_cashback)
# COD : plafonné à ce que Coligo encaisse (commission + service + (tournée ? commission_outil : livraison)), et à produits/2
# Échec livraison ou feature 'cashback' coupée → 0
```

- Le `topup`/Coligo Pay (argent neuf) **reste éligible** ; seul le cashback
  dépensé est retiré de l'assiette.
- Libéré **à la complétion** (`grant_customer_cashback_on_completion`).
- Financé depuis la commission (part plateforme), jamais en plus.
- Annulation → le cashback gagné revient au `solde_cashback` ; remboursement
  toujours sur le bucket d'origine (réel→réel, cashback→cashback).

**SUM = 0 garanti :** le cashback gagné est toujours symétrique
plateforme(−)/client(+) ; un trigger refuse toute transaction non équilibrée.

## 5. Float prépayé (anti-créance)

Float opérateur (`operator_wallet_entries`) ; planchers signés
`neg_threshold_{merchant,driver,chauffeur}_da`. Sous le plancher → blocage de
nouvelle commande/course jusqu'à recharge. Recharge : carte (Chargily), agent
espèces, virement CCP (`platform_payment_accounts`, mig 0200).

## 6. Tournée — prix (ch.9.4)

`ensure_merchant_delivery_zones` seed les 3 bandes au **défaut ≈ 40 % sous le
barème express** (`tour_discount_rate`). Le trigger `clamp_merchant_delivery_zone_price`
(mig 0119) garantit toujours `[delivery_min, barème_express]` → le prix tournée
ne dépasse JAMAIS l'express. Prix figé à la réservation ; le risque de
remplissage est porté par le commerçant.

## 7. P2P désactivé (ch.0.10)

`p2p_enabled = false`. Le transfert personne-à-personne
(`coligo_pay_transfer`, seul point P2P) renvoie `p2p_disabled` (garde en tête,
bypass-proof). Côté UI, « Envoyer » / « Recevoir » sont grisés (« Bientôt »).
Le **paiement marchand** (`coligo_pay_create_request`/`coligo_pay_execute`,
qui exigent un `merchant_id`) reste actif. Ne réactiver qu'avec licence Banque
d'Algérie + KYC/AML.

## 8. Abonnements (ch.7)

Au lancement : Gratuit / **Prioritaire** (`sub_priority_monthly_da` = 300 DA,
1er mois `sub_priority_first_month_da` = 100), 0 % commission, avantages
zones/heures de forte demande + priorité dispatch (accélère, ne bloque jamais)

- badge. La grille étendue Drive Pro/Premium (`drive_plan_*`) reste en config
  pour la phase 2. _NB : la table d'abonnement Prioritaire commune
  chauffeur+livreur et le câblage dispatch/badge restent à construire ; seule la
  config est posée (mig 0205)._

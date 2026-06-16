# Plan produit & technique — Portefeuille opérateur, points de recharge & seuils négatifs

> Objectif : permettre aux **livreurs / chauffeurs / commerçants** de **recharger
> un portefeuille** (Chargily, CCP/virement avec preuve, ou **chez un point de
> recharge physique partenaire**), de **bloquer automatiquement** l'activité quand
> le solde passe sous un **seuil négatif configurable par rôle**, et d'offrir un
> **réseau de partenaires** (comptes Coligo Pay « pro » géolocalisés) qui revendent
> du crédit et sont **rémunérés par bonus admin**.
>
> Principe directeur : **réutiliser** les invariants money déjà prouvés
> (double-entrée SUM=0, idempotence, PIN hashé + lockout, enforcement par trigger
> bypass-proof, géoloc Haversine, validation de pièces par l'admin). On ne réécrit
> pas un système de paiement — on **ajoute une couche portefeuille opérateur** sur
> le socle existant.

---

## 0. Décision d'architecture (à valider en premier)

### Le problème

Aujourd'hui il existe **trois systèmes d'argent disjoints**, aucun n'est un
portefeuille rechargeable unifié :

| Acteur                | Système actuel                                                      | Notion de « dette »                         |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| **Client**            | Coligo Pay : `customer_wallet_entries` (topup + cashback), P2P, PIN | `max_topup_da_per_30d`                      |
| **Livreur/chauffeur** | `delivery_ledger` + `driver_outstanding()` (cash custodian)         | `driver_float_cap_da` (8000) → `can_accept` |
| **Commerçant**        | Finances (commission / « Coligo vous doit/devez »)                  | `max_debt_da` (5000)                        |

Le seuil négatif **existe déjà partiellement** côté livreur (`driver_outstanding < float_cap`)
et côté commerçant (`max_debt_da`), mais :

- Ces seuils sont **uniques** (pas par rôle/ancienneté).
- Il **n'y a pas de portefeuille rechargeable** qui remonte le solde après débit.
- Coligo Pay est **client-only** (clé `customer_id`), couplé à Chargily + cashback.

### Option retenue : portefeuille opérateur **séparé** (pas d'extension de Coligo Pay)

On crée un **nouveau** système `operator_wallet_*` pour livreurs / chauffeurs /
commerçants / partenaires, **parallèle** à Coligo Pay client.

**Pourquoi séparé et pas une généralisation de `customer_wallet_entries` :**

- Coligo Pay est un système money **testé et audité** (treasury audit, SUM=0
  prouvé). Le généraliser de `customer_id` → `owner` toucherait du code argent
  validé → risque de régression élevé (cf. mémoire audit trésorerie).
- Les flux sont **différents** : Coligo Pay = P2P client + cashback + Chargily ;
  le portefeuille opérateur = float métier (frais service débités, COD réconcilié,
  recharge, bonus partenaire). Mélanger les deux brouille la trésorerie.
- On **copie les invariants prouvés** (double-entrée, idempotence, PIN, lockout)
  sans toucher le système client.

**Trade-off assumé :** un utilisateur client **+** livreur aura deux soldes
distincts. Acceptable : ce sont deux rôles cloisonnés (cf. isolation des rôles),
et un livreur ne « paie » pas avec son solde client.

> ⚠️ **À VALIDER avec le proprio avant migration** : OK pour deux portefeuilles
> distincts (client vs opérateur) ? C'est la seule décision structurante.

---

## 1. Modèle de données (nouvelles tables)

### 1.1 `operator_wallets` — un compte par opérateur

```sql
operator_wallets (
  id            uuid PK default gen_random_uuid(),
  owner_type    text NOT NULL CHECK (owner_type IN ('driver','chauffeur','merchant','partner')),
  owner_id      uuid NOT NULL,            -- drivers.id / merchants.id selon type
  is_partner    boolean NOT NULL default false,  -- point de recharge
  status        text NOT NULL default 'active'   -- active | suspended | disabled
                  CHECK (status IN ('active','suspended','disabled')),
  -- géoloc partenaire (NULL pour non-partenaires)
  display_name  text, address text, lat double precision, lng double precision,
  phone text, hours text,
  created_at    timestamptz default now(),
  UNIQUE (owner_type, owner_id)
)
```

### 1.2 `operator_wallet_entries` — grand livre append-only (double-entrée)

```sql
operator_wallet_entries (
  id            uuid PK,
  wallet_id     uuid NOT NULL REFERENCES operator_wallets(id),
  type          text NOT NULL CHECK (type IN (
                  'topup_chargily','topup_manual','topup_partner',  -- crédits recharge
                  'recharge_sale',                                  -- débit côté partenaire (revente)
                  'bonus',                                          -- crédit bonus admin partenaire
                  'fee_debit','service_fee','cod_settle',           -- débits métier
                  'adjustment')),
  amount_da     integer NOT NULL,         -- signé : +crédit / −débit
  ref_id        uuid,                     -- order_id / ride_id / transfer_id selon contexte
  counterparty_wallet_id uuid REFERENCES operator_wallets(id),  -- pour revente (SUM=0)
  client_operation_id text,               -- idempotence
  note          text,
  created_by    uuid,                     -- admin si manuel/bonus
  created_at    timestamptz default now(),
  UNIQUE (wallet_id, client_operation_id)  -- idempotence par wallet
)
```

> **Invariant double-entrée** : chaque **revente** crée 2 lignes opposées
> (`recharge_sale` débit chez le partenaire, `topup_partner` crédit chez l'acheteur),
> `SUM(amount_da) = 0` sur la paire. Test money obligatoire (cf. §8).

### 1.3 `operator_wallet_security` — PIN (copie du pattern client)

```sql
operator_wallet_security (
  wallet_id uuid PK REFERENCES operator_wallets(id),
  pin_hash text, failed_attempts int default 0, locked_until timestamptz
)
```

### 1.4 `wallet_topup_requests` — recharges manuelles (preuve + validation)

```sql
wallet_topup_requests (
  id          uuid PK,
  wallet_id   uuid NOT NULL REFERENCES operator_wallets(id),
  method      text CHECK (method IN ('ccp','virement')),
  amount_da   integer NOT NULL,
  proof_url   text NOT NULL,             -- bucket privé
  status      text default 'pending' CHECK (status IN ('pending','approved','rejected')),
  review_note text, reviewed_by uuid, reviewed_at timestamptz,
  created_at  timestamptz default now()
)
```

### 1.5 `platform_settings` — nouvelles colonnes

```sql
ALTER TABLE platform_settings ADD COLUMN
  neg_threshold_driver_da    integer default 500,
  neg_threshold_chauffeur_da integer default 500,
  neg_threshold_merchant_da  integer default 2000,
  neg_threshold_new_days     integer default 30,    -- 0 DA pendant N jours
  partner_recharge_rate      numeric default 0.01,  -- repère bonus 1 %, modifiable
  operator_topup_max_da      integer default 100000;
```

> Le **bonus partenaire** n'est PAS prélevé automatiquement : `partner_recharge_rate`
> sert juste à l'admin pour calculer le bonus à créditer.

---

## 2. Le solde et le seuil négatif

### 2.1 Calcul du solde

```sql
operator_balance(p_wallet_id uuid) RETURNS integer
  -- = SUM(amount_da) FROM operator_wallet_entries WHERE wallet_id = p_wallet_id
```

### 2.2 Seuil négatif par rôle + ancienneté (le cœur de la demande)

```sql
operator_neg_threshold(p_wallet_id uuid) RETURNS integer
  -- nouveau compte (< neg_threshold_new_days) → 0
  -- sinon selon owner_type → neg_threshold_<role>_da
  -- (extension future : montée auto selon ancienneté/activité)
```

```sql
operator_can_operate(p_wallet_id uuid) RETURNS boolean
  -- status='active' AND operator_balance >= -operator_neg_threshold
```

### 2.3 Intégration avec l'existant (point délicat)

- **Livreur/chauffeur** : le portefeuille opérateur **remplace** le float cap dans
  la décision d'acceptation. `driver_can_accept()` est étendu :
  `is_active AND operator_can_operate(wallet) AND (legacy outstanding check)`.
  Les frais (`driver_fee`, `service_fee`) sont débités du portefeuille
  (`fee_debit`/`service_fee`), le COD encaissé reste géré par `delivery_ledger`
  (cash physique distinct du solde plateforme).
- **Commerçant** : remplace progressivement `max_debt_da`. La commission due se
  débite du portefeuille ; sous le seuil → commandes bloquées.

> ⚠️ Migration de données : à l'activation, on **initialise** chaque portefeuille
> opérateur avec le solde net actuel (outstanding livreur, dette commerçant) via
> une entrée `adjustment`, pour ne pas créer de discontinuité.

---

## 3. Enforcement bypass-proof (triggers, comme zones/feature flags)

Pas de gating UI seul (contournable). On pose des **triggers BEFORE INSERT** :

| Action bloquée                        | Trigger sur                          | Condition                                      |
| ------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| Livreur passe en ligne / pull express | dans `pull_next_express` / présence  | `operator_can_operate` faux                    |
| Chauffeur accepte course              | RPC accept course                    | `operator_can_operate` faux                    |
| Commerçant reçoit commande            | `trg_*` sur `orders` (BEFORE INSERT) | wallet commerçant sous seuil                   |
| Revente partenaire                    | `coligo_recharge_sell()` RPC         | partenaire `status='active'` + solde suffisant |

Le **client n'est jamais bloqué** (exigence explicite). Le blocage commerçant
peut être configuré « commandes bloquées, boutique visible » **ou** « boutique
masquée » — réutilise le pattern pause boutique (`shop-status-toggle`, mig 0063).

---

## 4. Réseau de points de recharge (partenaires)

### 4.1 Compte partenaire = `operator_wallets` avec `is_partner=true` + géoloc

- Créé/activé **par le super-admin** uniquement.
- Recharge son propre solde en gros volume (Chargily / virement validé).
- **Revend** du crédit via RPC `coligo_recharge_sell(p_target_handle, p_amount, p_pin, p_op_id)` :
  débit `recharge_sale` chez le partenaire + crédit `topup_partner` chez la cible,
  idempotent, PIN partenaire requis, SUM=0. Anti double-dépense (solde vérifié).
- **Rémunération = bonus admin** (`type='bonus'`), ponctuel ou selon volume,
  tracé dans le grand livre. `partner_recharge_rate` (1 %, modifiable) = repère.

### 4.2 Découverte côté utilisateur — « Où recharger »

- RPC `recharge_points_nearby(p_lat, p_lng, p_limit, p_radius)` → calque exact de
  `merchants_nearby` (Haversine, tri distance), filtré `is_partner AND status='active'`.
- Section **« Où recharger »** dans les espaces livreur / chauffeur / commerçant :
  nom, adresse, distance, horaires, téléphone, bouton **itinéraire** (carte OpenFreeMap).
- **Aucun point actif dans la zone → section masquée automatiquement** (comme
  kill-switch / zones). Rayon configurable (réutilise `browse_radius_km`).

---

## 5. Recharge manuelle avec preuve (CCP / virement)

Calque du pattern **validation pièces chauffeur** (`chauffeur_documents` +
bucket privé + queue admin) :

1. L'utilisateur saisit montant + méthode, **téléverse la preuve** (bucket privé,
   ex. `wallet-proofs`, signed URL TTL 1h côté admin).
2. Création `wallet_topup_requests` (status `pending`).
3. Queue admin (`app/admin/recharges/`) : aperçu inline image/PDF (réutilise le
   visualiseur docs admin), montant, **Valider / Refuser** + note.
4. Validation → crédit `topup_manual` au portefeuille (RPC `approve_topup_request`,
   idempotent), refus → note visible côté user.

---

## 6. Recharge Chargily (automatique)

- Réutilise le **webhook Chargily** existant (seul fait foi, montant strict).
- Checkout dédié « recharge portefeuille » → à confirmation webhook : crédit
  `topup_chargily` idempotent (`client_operation_id = chargily_checkout_id`).
- Même durcissement que les topups client (montant exact, expired refusé).

---

## 6bis. Recharge par le super-admin + traçabilité « ultra safe » (LIVRÉ socle)

Exigence : transparence totale (interne + externe), aucun flux altérable,
comptabilité fiable.

- **Grand livre append-only inviolable** : trigger qui **rejette tout UPDATE/DELETE**
  sur `operator_wallet_entries` — même en `service_role` direct (mig 0185). Toute
  correction = **nouvelle écriture `adjustment`** (vraie double-entrée). Le
  portefeuille ne peut plus être supprimé (`ON DELETE RESTRICT`) → l'historique
  financier est permanent.
- **Recharge admin tracée** : RPC `admin_operator_credit(wallet, amount, type, note, op_id)`
  (mig 0185) — réservé au super-admin (`platform_admins`), `type ∈ {topup_manual,
bonus, adjustment}`, montant signé (+recharge / −correction), **idempotent**
  (`op_id`), trace `created_by` (admin) + `created_at` + email admin estampillé
  dans la note. Refusé hors session admin (vérifié).
- **Piste d'audit** : chaque écriture porte qui/quand/combien/pourquoi/type/réf.
  Le grand livre EST le journal d'audit — exportable pour transparence externe.

## 7. Espace admin (`app/admin/recharges/` + `app/admin/partners/`)

- **Points de recharge** : liste des comptes pro, **activer / suspendre / désactiver**,
  éditer géoloc/horaires, **plafonds** de recharge, **créditer un bonus**.
- **Demandes de recharge manuelle** : queue de validation (preuve inline).
- **Historique complet** : toutes les opérations (recharges, reventes, bonus,
  débits) filtrables par portefeuille — calque `admin/coligo-pay` overview/audit.
- **Seuils négatifs** : édition `neg_threshold_*` dans `app/admin/settings`.
- Accès **super-admin confiné** (cookie `coligo_adm`, cf. isolation des rôles).

---

## 8. Tests (suites money obligatoires)

- `test:wallet:double-entry` — toute revente : SUM(paire) = 0 ; aucun crédit sans débit.
- `test:wallet:idempotence` — rejouer `client_operation_id` ne double pas le crédit.
- `test:wallet:threshold` — sous seuil → `operator_can_operate=false` ; recharge → levée auto.
- `test:wallet:new-account` — < N jours → seuil 0 ; après → seuil rôle.
- `test:wallet:topup-manual` — pending → approve crédite une seule fois ; reject ne crédite pas.
- `test:wallet:enforcement` — bypass PostgREST direct bloqué par trigger.

---

## 9. Lots de livraison (ordre recommandé)

| Lot          | Contenu                                                                                                                                                                                                                                                                                                                                    | Dépend de | Migrations               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------ |
| **1** ✅     | `operator_wallets` + `operator_wallet_entries` + `operator_balance` + seuils `platform_settings` + `operator_can_operate` + `operator_wallet_state` + backfill (35 portefeuilles) + grand livre inviolable + `admin_operator_credit`                                                                                                       | —         | 0184–0185 **LIVRÉ**      |
| **2** ✅     | Enforcement « offset » (solde effectif = portefeuille − dette) : `chauffeur_outstanding`, `operator_effective_balance`, `operator_can_operate`, 3 triggers bypass-proof (assignation livreur / offre chauffeur / création commande), interrupteur `operator_gating` **DORMANT**                                                            | 1         | 0186 **LIVRÉ (dormant)** |
| **3** ✅     | Backend recharge : `wallet_topup_requests` + bucket `wallet-proofs` (privé) + `my_operator_wallet`, `request_operator_topup`, `approve/reject_topup_request`, `credit_operator_topup_chargily` (idempotent) + branche webhook `op_topup`. RESTE = UI formulaires (avec lot 5/6)                                                            | 1         | 0187 **LIVRÉ (backend)** |
| **4** ✅     | Partenaire : PIN opérateur (`operator_wallet_security` bcrypt + lockout, set/status/verify), `find_operator_wallet_by_phone`, `coligo_recharge_sell` (double-entrée SUM=0, PIN, idempotent, anti-découvert + verrou). Bonus = `admin_operator_credit` type bonus (déjà mig 0185)                                                           | 1         | 0188 **LIVRÉ**           |
| **5** ✅     | Annuaire « Où recharger » : `recharge_points_nearby` + `recharge_points_exist` (0189) ; composant partagé `RechargePoints` (géoloc + cartes + itinéraire/appel) ; routes `/driver/recharger`, `/chauffeur/recharger`, `/recharger` (merchant) + entrées menu masquées si réseau vide                                                       | 4         | 0189 **LIVRÉ**           |
| **6** ✅     | Admin `/admin/recharges` : toggle enforcement `operator_gating`, queue recharges manuelles (preuve + valider/refuser), points de recharge (créer/promouvoir par tél, activer/suspendre/désactiver, créditer bonus/recharge/ajustement), seuils & plafonds. Résolution partenaire par session (mig 0190)                                    | 3,4       | 0190 **LIVRÉ**           |
| **7** ✅     | Abonnements chauffeur à la DURÉE (1 sem / 2 sem / 1 mois) : facteurs configurables × tarif mensuel (Pro 2000 → 700/1200/2000) ; `drive_subscribe`/`drive_sub_mark_paid` étendus (duration_days) ; sélecteur de durée UI ; facteurs réglables config Drive admin ; compta intacte (ledger = montant réel)                                   | —         | 0191 **LIVRÉ**           |
| **8** ✅     | Points officiels (mig 0192) : promotion commerçant OU nouveau point (carte+recherche, gérant, RC, documents KYC) ; coords+tél affichés aux users                                                                                                                                                                                           | 4,6       | 0192 **LIVRÉ**           |
| **9** ✅     | UI recharge opérateur (mig 0193) : `my_operator_wallet_state`/`_entries` ; actions `getMyWalletState`/`createOperatorTopupCheckout`/`requestOperatorManualTopup` ; composant `OperatorRecharge` (solde + carte Chargily + virement/CCP avec upload preuve + historique) dans les 3 espaces ; entrée « Portefeuille & recharge » permanente | 3,5       | 0193 **LIVRÉ**           |
| **AUDIT** ✅ | Audit anti-fraude → 1 faille corrigée (approve d'une demande refusée bloqué)                                                                                                                                                                                                                                                               | —         | 0194 **LIVRÉ**           |
| **10** ✅    | Portail partenaire `/partenaire` : login tél+mdp (`@partners.coligo.local`, isolé middleware), tableau de bord (solde, bonus/gains, total revendu, ventes), vendre du crédit (recherche tél + PIN), recharge float (carte/CCP), PIN, historique. Admin crée le point AVEC accès                                                            | 4,9       | 0195 **LIVRÉ**           |

> Le **lot 1 est le socle** (toutes les autres tables référencent `operator_wallets`).
> Le **lot 7 est indépendant** (juste de la config sur le moteur d'abonnements
> Drive existant, mig 0157) — livrable à tout moment.

---

## 10. Tarifs abonnements chauffeur (lot 7, pour mémoire)

| Phase          | 1 sem | 2 sem | 1 mois |
| -------------- | ----- | ----- | ------ |
| **Lancement**  | 700   | 1 200 | 2 000  |
| **Après base** | 1 000 | 1 700 | 3 000  |

Bascule = simple changement de config tarifaire (pas de migration structurelle).

---

## 11. Points à valider avant de coder

1. **Portefeuille opérateur séparé de Coligo Pay client** — OK ? (décision §0)
2. **Blocage commerçant** : commandes bloquées (boutique visible) **ou** boutique
   masquée ? (configurable, mais quel défaut ?)
3. **Périmètre légal** : revente de crédit prépayé via points physiques — même
   réserve que Coligo Pay public (entité légale DZ). Lancer en interne d'abord ?
4. **Montée auto du seuil selon ancienneté/activité** : formule exacte (paliers ?)
   — pour l'instant prévu en extension du lot 1.

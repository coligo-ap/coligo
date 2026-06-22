# Scripts de charge k6 — Coligo (Phase 5)

> ⚠️ **STAGING UNIQUEMENT.** Ne JAMAIS lancer contre la prod ni le free tier de prod
> (épuise les connexions Postgres Supabase et déclenche les rate-limits). Aucun staging
> n'était fourni au moment de l'audit → ces scripts sont livrés **prêts à lancer**, non exécutés.

## Pré-requis

```bash
# Installer k6 (https://k6.io). Sur Windows : winget install k6 --source winget
# Renseigner l'environnement STAGING (jamais la prod) :
export BASE_URL="https://staging.coligo.app"
export SUPABASE_URL="https://<staging-ref>.supabase.co"
export SUPABASE_ANON="<anon key staging>"
export AUTH_TOKEN="<JWT d'un user de test staging>"   # pour les scénarios authentifiés
```

## Points de contention ciblés (cf. prompt d'audit)

| Script                | Cible                                                                               | SLO                                               |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------- |
| `claim-dispatch.js`   | `pull_next_express_nearby` / `accept_ride_offer` — un seul gagnant sous concurrence | p95 < 500 ms, err < 1 %, **0 double-attribution** |
| `wallet-deduction.js` | `coligo_pay_execute` / `coligo_pay_transfer` — pas de double-spend ni solde négatif | p95 < 500 ms, err < 1 %                           |
| `pickup-validate.js`  | validation `pickupCode` — résistance brute-force + rate-limit                       | 4xx attendus, pas de 5xx                          |
| `realtime-fanout.js`  | abonnement Realtime sur `orders`/`rides` — fanout sous charge                       | latence push < 2 s                                |

## Lancer

```bash
k6 run scripts/k6/claim-dispatch.js
k6 run --vus 200 --duration 2m scripts/k6/wallet-deduction.js
```

## Après chaque run

Relancer la **réconciliation** pour vérifier qu'aucune corruption de solde n'est apparue :
appeler `admin_coligo_pay_overview` (doit donner `negative_balances=0`,
`unbalanced_payments=0`, `unbalanced_transfers=0`). Voir `AUDIT-REPORT.md` finding F12.

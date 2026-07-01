# Harnais de charge / résilience / sécurité « terrain »

Simule une journée réelle sous charge (dizaines de commerçants, livreurs et
chauffeurs actifs + centaines de clients qui commandent et cherchent une course
**en concurrence**) puis **prouve** les invariants métier et de sécurité sous
cette charge, sur la **vraie base** (RPC + RLS + triggers de prod).

Chaque opération emprunte le **vrai chemin PostgREST** : connexion via le pooler,
`set_config('request.jwt.claims',…)` + `SET LOCAL ROLE authenticated` → RLS
enforcée et guards `current_user='authenticated'` actifs (fidélité totale). La
charge concurrente passe par le pooler **transaction (6543)**, comme le trafic
serverless de prod ; le seed/cleanup passent par le pooler **session (5432)**.

Toutes les données sont taguées `[LOADTEST]` / `@coligo-loadtest.dev` et
**nettoyées** en fin de run (même en cas d'échec).

## Lancer

```bash
npm run test:load            # smoke (4/4/4/8, 20 commandes)
npm run test:load:full       # terrain (20/20/12/40, 300 commandes, conc 24)
LT_SCALE=full LT_ORDERS=1000 LT_CONCURRENCY=60 node scripts/loadtest/run.mjs   # stress
npm run test:load:purge      # purge de secours des résidus @coligo-loadtest.dev
```

Env : `LT_MERCHANTS LT_DRIVERS LT_CHAUFFEURS LT_CUSTOMERS LT_ORDERS LT_CONCURRENCY`.

## Ce qui est prouvé

| Phase                | Invariant                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1 · Checkout         | débit/latence (p50/p95/p99) des commandes concurrentes, taux d'erreur                                                        |
| 2 · Dispatch express | **aucune double-attribution** (`SKIP LOCKED`), toutes les commandes drainées                                                 |
| 3 · Coligo Pay       | **anti double-dépense** sous concurrence (jamais négatif, floor(solde/montant) exact)                                        |
| 4 · Drive            | **1 seul gagnant** par course, aucun chauffeur double-booké (`FOR UPDATE`)                                                   |
| 5 · Sécurité         | isolation multi-tenant (commerçant/client), escalade de rôle refusée, garde colonnes financières, brute-force PIN verrouillé |
| 6 · Intégrité        | `integrity_violations()` = 0 après toute la charge, aucun solde négatif                                                      |

# INVENTAIRE — Audit global Coligo

> Phase 0 de `AUDIT-COLIGO-claude-code.md`. Cartographie réelle du repo (lecture seule).
> Date : 2026-06-22. Repo : `coligo/` (Next.js 15 App Router + Supabase managed).

## 1. Vue d'ensemble

| Élément                                  | Valeur                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Migrations SQL                           | **239** (`supabase/migrations/0001…0239`)                                                                              |
| Tables Postgres créées                   | ~**89**                                                                                                                |
| Fonctions `SECURITY DEFINER` (RPC)       | **150**                                                                                                                |
| Fichiers Server Actions (`'use server'`) | **46**                                                                                                                 |
| Crons (Vercel)                           | 3 quotidiens : `payouts` 06:00, `driver-payouts` 07:00, `drive` 05:30                                                  |
| Routes API                               | `chargily/webhook`, `cron/*`, `device-tokens`, `drivers`, `start`, `telemetry`, `app-download`                         |
| Stack                                    | Next 15.5, React 19, next-intl (FR/AR+RTL), TanStack Query, Zustand, Zod 4, MapLibre, Dexie, Capacitor 8, Firebase FCM |

## 2. Espaces / rôles (App Router groups)

- `(customer)` — client : `checkout`, `cart`, `commandes`, `course`, `drive`, `coligo-pay` (+`/qr`), `cashback`, `favoris`, `adresses`, `compte`, `search`, `m` (vitrine marchand).
- `(merchant)` — commerçant : `dashboard` (KDS), `orders`, `encaisser`, `livraison`, `livreurs`, `catalog`, `promotions`, `finances`, `recharger`, `stats`, `settings`, `telecharger`.
- `(driver)` — livreur Express : `driver/*`.
- `(chauffeur)` — Coligo Drive (VTC) : `chauffeur/*`.
- `(partner)` — Agent Coligo Pay : `partenaire/*`.
- `admin` — super-admin : `coligo-pay`, `drivers`, `chauffeurs`, `merchants`, `orders`, `recharges`, `agents`, `zones`, `controle` (feature flags), `drive`, `config`, `devices`, `security`, `reports`, `bannieres`, `notifications`.

## 3. Où vit l'argent (points sensibles)

**Calculs / mutations de solde (RPC plpgsql, `SECURITY DEFINER`) :**

- Wallet client / Coligo Pay : `coligo_pay_transfer`, `coligo_pay_execute`, `coligo_pay_create_request`, `coligo_recharge_sell`, `coligo_pay_set_pin`/`verify_pin`/`pin_check_internal`.
- Cashback : `compute_order_cashback_da`, `customer_cashback_balance`, `spend_customer_cashback_on_order_create`, `grant_customer_cashback_on_completion`, `refund_customer_cashback_on_cancel`.
- Wallet opérateur (livreur/chauffeur/commerçant/agent) : `ensure_operator_wallet`, `my_operator_wallet`, `operator_wallet_state`, `my_operator_wallet_entries`, `admin_operator_credit`, trigger `trg_mirror_wallet_entry_to_operator`.
- Complétion / ledger : `generate_wallet_entries_on_completion`, `generate_delivery_ledger_on_complete`, `resolve_vtc_commission`, `enforce_drive_commission_ceiling`.
- Payouts : `generate_scheduled_payouts`, `driver_payout_single_default` (+ crons).
- Annulation / remboursement : `cancel_order_by_customer`, `merchant_cancel_order`, `admin_cancel_order`, `cancel_ride`, `drive_refund_escrow`, `refund_customer_topup_on_cancel`, `admin_refund_merchant_wallet`, `admin_resolve_driver_refund_claim`.
- Dispatch : `request_ride`, `chauffeur_offer_ride`, `accept_ride_offer`, `pull_next_express_nearby` (+ legacy `pull_next_express`), `start_tour`, `priority_window_blocks`.

**Frontière client/serveur :**

- Navigateur = clé **anon** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), soumis au RLS.
- Serveur = `service_role` (`lib/supabase/server`, `app/api/chargily/webhook`, `app/api/device-tokens`, certaines actions admin) → bypass RLS, jamais exposé au client.
- `lib/finances/balance.ts`, `lib/finance/service-fee.ts` = lecture/format.

## 4. Verticales / parcours réels

1. **Marketplace click-and-collect** (retrait via `pickupCode`/QR).
2. **Livraison Express** (pull livreur de proximité, gaté `prep_notif_at`).
3. **Tournée** (commerçant pilote, dispatch push, prix ≤ express).
4. **Coligo Drive (VTC)** — négociation type InDrive : `request_ride` → offres chauffeurs → le client choisit.
5. **Coligo Pay** — wallet cashback + P2P (Envoyer/Recevoir, derrière garde légale).
6. **Wallet opérateur** — float prépayé partenaires (séparé de Coligo Pay client) + points de recharge.

## 5. Outillage de test existant (déjà dans le repo)

`package.json` expose ~25 suites maison (`npm run test:*`) : `coligo:pay`, `driver:money`, `tour:money`, `drive:money`, `audit:cod`, `audit:cancel`, `noshow:claim`, `merchant:guard`, `promo:money`, `vtc`, `priority`, `zones`, `offline:*`, `slots`, etc. + `test:all` agrégé. Pas de Vitest/fast-check : tests = scripts Node maison frappant la DB.

## 6. Résultats Phase 1 (analyse statique)

- `tsc --noEmit` strict : **0 erreur**.
- `next lint` (ESLint) : **0 warning / 0 erreur**.
- Scan secrets bundle `.next/static` : **aucune fuite** de `service_role` ni de `CHARGILY_SECRET_KEY` (seul l'anon key, attendu). Le match initial sur 40 car. était un faux positif de préfixe JWT partagé anon/service.
- Secrets code client (`app/`, `components/`) : aucune référence à `service_role` hors commentaires / fichiers serveur.
- `npm audit --omit=dev` : **2 vulnérabilités modérées** (`postcss <8.5.10` XSS via stringify, transitif sous `next`) — build-only, pas d'exposition runtime ; fix = bump next/postcss.

## 7. Lacunes évidentes repérées en Phase 0

- Pas de framework de test standard (Vitest/fast-check absent) → property-based tests à ajouter (Phase 3).
- Crons d'expiration TTL **quotidiens uniquement** (balayage lent) — voir findings dispatch.
- Pas de staging fourni → Phase 5 (charge) = scripts k6 livrés mais non exécutés.

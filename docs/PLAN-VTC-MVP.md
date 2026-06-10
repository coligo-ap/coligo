# Plan produit & technique — MVP VTC Coligo (transport de personnes)

> Objectif : ajouter le **VTC** (course de personnes, façon Yassir / inDrive /
> Heetch) à Coligo, avec **négociation du prix** (client ↔ chauffeur),
> **commission 8 %** par défaut, **abonnements chauffeur** (0 %/réduit), et un
> **modèle super-app unique** (livraison + VTC + paiement + cashback croisé).
>
> Principe directeur : **réutiliser** l'infra existante (réseau livreur+géoloc,
> Coligo Pay, ledger SUM=0, FCM, notes, vérif chauffeur admin). Le VTC n'est pas
> un nouveau produit — c'est une **nouvelle verticale sur le même socle**.

---

## 1. Ce qu'on réutilise (déjà construit ✅)

| Besoin VTC                                | Brique Coligo existante                                 |
| ----------------------------------------- | ------------------------------------------------------- |
| Chauffeurs + position temps réel          | `drivers`, `driver_presence`, background-geo (mig 0130) |
| Matching « course proche »                | `drivers_present_near(lat,lng,radius)`                  |
| Sonner le chauffeur                       | FCM (`tokensFor(uid,'courier')`, `sendFcm`)             |
| Paiement in-app                           | **Coligo Pay** (wallet topup, P2P, débit)               |
| Commission + trésorerie                   | `platform_ledger`, modèle double-entrée SUM=0           |
| Paie chauffeur                            | `driver_statements` + versements (cron payouts)         |
| Notes                                     | `driver_reviews` (+ note client à étendre)              |
| Vérif chauffeur (permis, véhicule, scans) | admin driver management (mig 0104-0108)                 |
| Cartes / distance                         | OpenFreeMap + Haversine (`lib/delivery/distance`)       |
| Isolation des rôles                       | middleware (session livreur confinée /driver)           |

➡️ **~70 % du socle existe.** Le neuf = la verticale « course » (négociation,
cycle de vie, abonnements).

---

## 2. Périmètre MVP

**DANS le MVP :**

- Demander une course : départ (position actuelle) + destination (carte/recherche).
- **Prix suggéré** (barème distance) + le client **propose son prix** (inDrive).
- Chauffeurs proches **acceptent au prix** OU **contre-proposent**.
- Le client **choisit** parmi les offres (chauffeur, prix, note, ETA).
- Cycle de vie complet (recherche → accepté → en route → arrivé → en course → terminé).
- Paiement **espèces** OU **Coligo Pay**. Commission **8 %** (ou selon abonnement).
- **Note** réciproque + **historique** des courses.
- **1 ville pilote** (liquidité).

**HORS MVP (phases suivantes) :**

- Course programmée, types de véhicule (moto/confort), surge, promos.
- SOS/partage de trajet avancé (MVP = partage de lien + infos chauffeur visibles).
- Cashback croisé VTC↔livraison (phase 2).

---

## 3. Parcours CLIENT (la négociation, cœur du modèle)

1. Écran course : **départ** (GPS) + **destination** (pin carte / recherche
   `geocodeSearch` existant). L'app calcule **distance** + **prix suggéré**.
2. Le client **confirme ou édite** le prix qu'il propose + **mode de paiement**.
3. `request_ride(...)` → course `status='searching'` + **notif** aux chauffeurs
   proches (`drivers_present_near(pickup)` + FCM).
4. Le client voit **les offres arriver en temps réel** (Realtime) : nom, **note**,
   **ETA**, **prix** (accepté ou contre-proposé).
5. Il **choisit un chauffeur** → `accept_ride_offer(offer_id)` → course attribuée,
   les autres offres expirent. Suivi carte (chauffeur en route → arrivé → en course).
6. Fin : paiement (cash/Coligo Pay) + **note** + reçu.

## 4. Parcours CHAUFFEUR

1. « En ligne » (déjà géré) → reçoit les **demandes de course proches** (push +
   liste temps réel), avec **distance jusqu'au client**, **destination**, **prix
   proposé**, **note client**.
2. **Accepter au prix** OU **Contre-proposer** (`driver_offer_ride(ride_id, prix)`).
3. Si le client le choisit → navigation vers le départ → **« Arrivé »** → **démarrer
   la course** (swipe/PIN) → **terminer** → encaisse (cash) ou crédité (Coligo Pay).

## 5. Cycle de vie d'une course (états)

```
searching → offered → accepted → driver_arriving → arrived
          → in_progress (client à bord) → completed
   (annulables : cancelled_by client/driver/system avant in_progress)
```

---

## 6. Modèle de prix (suggéré + négociation)

- **Prix suggéré** = `clamp(base + distance_km × per_km, [min, …])` — barème VTC
  dans `platform_settings` (`vtc_base_da`, `vtc_per_km_da`, `vtc_min_da`).
- Le client peut **proposer en dessous/au-dessus** (négociation libre), mais on
  affiche un **plancher conseillé** pour éviter le bradage (protège le chauffeur).
- Pas de **surge** (argument marketing fort vs Yassir).

## 7. Abonnements chauffeur (différenciateur unique)

Table `driver_subscriptions` (tier, prix mensuel, commission effective, validité).

| Tier           | Prix/mois | Commission/course | Plus                               |
| -------------- | --------- | ----------------- | ---------------------------------- |
| 🆓 **Gratuit** | 0         | **8 %**           | —                                  |
| 💼 **Pro**     | ~X DA     | **4 %**           | priorité dispatch légère           |
| 👑 **Premium** | ~Y DA     | **0 %**           | priorité forte + badge « vérifié » |

- Paiement de l'abonnement via **Coligo Pay** ou Chargily → `platform_ledger`
  (`subscription_income`). Revenu **prévisible** pour la plateforme.
- `resolve_vtc_commission(driver_id)` → renvoie le taux selon l'abonnement actif
  (sinon 8 % global) — **même pattern que `resolve_rate`**.
- Marketing : _« Roule sans commission »_ (Premium) — recrutement chauffeurs massif.

---

## 8. Modèle financier (aligné sur ton ledger SUM=0 prouvé)

Soit **F** = prix convenu, **c** = commission = `round(F × taux_abonnement)`.

**Course ESPÈCES (chauffeur custodian, comme COD livraison) :**

- Chauffeur encaisse **F** cash. Garde **F − c**. Reverse **c** à la plateforme.
- `ride_ledger` : `driver_cash_collected=F`, `driver_owes_platform=c`,
  `driver_payout=F−c`. Réconciliation : `F − c − (F−c) = 0` ✅.

**Course COLIGO PAY (prépayé) :**

- Client **débité F** de son Coligo Pay. La plateforme **détient F**, doit au
  chauffeur **F − c** (relevé `driver_statements`, « à recevoir »), garde **c**.
- `platform_ledger` : `vtc_commission_income = c`.

**Abonnement :** `platform_ledger.subscription_income` (+ Coligo Pay débit chauffeur).

**Cashback croisé (phase 2) :** le client gagne du cashback sur **F** (même
`customer_wallet_entries`), utilisable en **livraison ET course** → fidélité que
inDrive/Heetch n'ont pas.

> Invariant : chaque course complétée somme à 0 sur {chauffeur, plateforme,
> client}. On réutilisera le **harnais de test de réconciliation** (façon
> `test:audit:cod`).

---

## 9. Sécurité & confiance (indispensable pour le transport de personnes)

- **MVP** : infos chauffeur + véhicule + **plaque** visibles avant la course ;
  **partage du trajet** (lien) ; historique ; note réciproque ; chauffeur
  **vérifié** (réutilise la vérif admin docs/permis mig 0104-0108).
- **Phase 1.1** : bouton **SOS**, traçabilité live du trajet, signalements.

---

## 10. Architecture technique

**Migrations (nouvelles) :**

- `0131_vtc_foundations` : tables `rides`, `ride_offers`, `ride_events` ;
  colonnes `platform_settings` (barème VTC + `vtc_commission_rate=0.08`).
- `0132_vtc_money` : `ride_ledger` + trigger de complétion (réconciliation),
  enum `platform_ledger_type += vtc_commission_income`.
- `0133_driver_subscriptions` : table `driver_subscriptions` + `resolve_vtc_commission`.

**RPC (SECURITY DEFINER, gardées par rôle) :**

- `request_ride(pickup, dest, distance_km, proposed_price, payment_method)` →
  crée la course + notifie les chauffeurs proches.
- `driver_offer_ride(ride_id, price)` → insère/maj une offre (accept ou contre).
- `accept_ride_offer(offer_id)` → attribue le chauffeur, expire les autres.
- `start_ride(ride_id)` / `complete_ride(ride_id, collected?)` / `cancel_ride(ride_id, reason)`.
- `resolve_vtc_commission(driver_id)`.
- Réutilise `drivers_present_near` pour le dispatch.

**Front :**

- Client : `app/(customer)/course/` (demande + carte + offres temps réel + suivi).
- Chauffeur : `app/(driver)/driver/vtc/` (demandes proches + accept/contre + course).
- Composants carte partagés (OpenFreeMap), realtime Supabase (offres/statut).
- Notif : étendre `lib/fcm/triggers` (`notifyDriversNewRide`, `notifyClientRideOffer`).

**Réutilisation directe :** `driver_presence`/background-geo (matching),
Coligo Pay (paiement), `driver_statements`/cron payouts (paie), FCM, ratings,
isolation middleware.

---

## 11. Phasage

- **Phase 1 — MVP (1 ville)** : demande + prix proposé + accept chauffeur
  (premier au prix) + cycle de vie + cash/Coligo Pay + 8 % + note + historique.
- **Phase 2** : contre-offres (négociation complète) + **abonnements 3 tiers** +
  **cashback croisé** + SOS/sécurité.
- **Phase 3** : courses programmées, types de véhicule, promos, multi-villes.

## 12. Risques & PRÉREQUIS (à régler AVANT lancement)

1. 🔴 **Légal / assurance passagers** : transport de personnes ≠ colis. Cadre VTC
   Algérie, assurance, vérif chauffeur (casier/permis/véhicule). **Bloquant.**
2. **Liquidité à froid** : lancer **zone par zone**, saturer l'offre chauffeur d'abord.
3. **Sécurité passager** : SOS + traçabilité (confiance = adoption).
4. **Concurrence Yassir** : gagner par **super-app + économie chauffeur**, pas en frontal.

## 13. KPIs à suivre

Courses/jour, taux d'acceptation, ETA moyen, prix moyen vs suggéré, chauffeurs en
ligne/zone, % abonnés Pro/Premium, GMV course, marge plateforme/course,
réutilisation cashback croisé, NPS client & chauffeur.

---

### Estimation d'effort (indicatif)

- **MVP Phase 1** : ~3 migrations + ~6 RPC + 2 espaces front (client/chauffeur) +
  notif. Gros morceau = le **temps réel des offres** et le **suivi carte**. Le
  reste (paiement, ledger, dispatch, géoloc) **réutilise l'existant** → rapide.

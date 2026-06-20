# Adresses, Cartes & Cohérence des prix

> Implémentation du prompt **« Adresses, Cartes, Performances, UX & Cohérence des
> prix »**. Stack imposée respectée : MapLibre + OpenFreeMap (rendu), Supabase
> (Postgres + RLS), Dexie (cache offline), TanStack Query (cache réseau),
> Zustand (état UI). Aucune nouvelle lib introduite.

Ce document est la **référence vivante** : il dit où vit chaque morceau, ce qui
était déjà conforme, ce qui a été ajouté, et comment régler le système sans
développeur (registre `/admin/config`).

---

## Vue d'ensemble par partie

| Partie | Sujet                                                                                        | État                                                     |
| ------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A      | Suggestions d'adresse intelligentes (favoris, récents, fréquence, multi-fournisseurs, cache) | **Déjà conforme** (socle 0037/0067/0152-0180/0178)       |
| B      | Adresses lisibles (pas de GPS brut) + reverse au déplacement de l'épingle, débouncé          | **Conforme** (debounce configurable + audit GPS — Lot 3) |
| C      | Loaders locaux (jamais plein écran)                                                          | **Déjà conforme** (règle permanente `CLAUDE.md`)         |
| D      | Cohérence & sécurité des prix : devis signé + anti-prix-périmé                               | **Ajouté** (mig 0234 — Lot 2)                            |
| E      | Registre de config (aucune valeur en dur) + multi-ville                                      | **Ajouté** (mig 0233 — Lot 1)                            |

---

## Partie A — Gestion intelligente des adresses

### Ordre des suggestions (A1)

`geocodeSearch` (`app/(customer)/actions.ts`) fusionne, AVANT tout appel externe :

1. **Boost personnel « Tes lieux »** : favoris + lieux déjà choisis par CE client
   remontent en tête (`user_place_stats`, mig 0180, RPC `user_place_mine`).
2. **Commerces** enregistrés fiables (le client tape souvent une enseigne).
3. **Gazetteer** local (graphies locales, squelette consonantique — mig 0152-0156).
4. **Photon / Nominatim** (rues, POI — gratuits).
5. **Google Places** — uniquement en dernier recours (voir A3).

Le tri global pondère proximité + popularité **apprise** (`geo_picks`, mig 0179 :
les lieux souvent choisis remontent, bonus proportionnel au match de nom).

### Historique & apprentissage (A2)

- `geo_picks` (global, mig 0179) et `user_place_stats` (par utilisateur, mig 0180) :
  compteurs + favori par cellule ~11 m. **Pas de ML** — compteurs + tri pondéré.
- Adresses enregistrées du client : `customer_addresses` (mig 0037, RLS owner).
- Enregistrement d'un choix : `recordPlacePick` → RPC `geo_pick_record` +
  `user_place_record` (best-effort, jamais bloquant).

### Multi-fournisseurs + Google maîtrisé (A3 / A4)

`searchGoogleFallback` (`app/(customer)/actions.ts`) — **Google est PAYANT**, donc
verrouillé :

- **Gratuit d'abord** : on n'appelle Google que si les sources gratuites ne
  contiennent pas les mots distinctifs de la requête (l'enseigne cherchée est
  introuvable gratuitement).
- **Google en TÊTE des suggestions** quand il répond (c'est lui qui a l'enseigne
  exacte), puis le reste.
- **Cache 30 j partagé Supabase** (`geo_google_cache`, mig 0178, RPC
  `geo_google_cache_get/put`) : une recherche payée n'est **jamais re-payée** et
  profite à TOUS les utilisateurs.
- **Plafonds journaliers** par client + global (`api_usage_daily`, RPC
  `api_quota_take`) → filet dur anti-dérapage.
- **Kill-switch** `geocode_google_enabled` (config) : à `false`, plus aucun appel
  payant (seuls le gratuit + le cache déjà payé servent).
- Longueur min, plafonds et kill-switch sont **pilotés par `/admin/config`**
  (plus de constantes en dur — voir Partie E).

> La clé `GOOGLE_MAPS_API_KEY` est dans l'environnement (Vercel + `.env.local`).
> ⚠️ Elle a été exposée en chat à un moment → **à régénérer** côté Google Cloud.

---

## Partie B — Adresses lisibles (pas de GPS brut)

- **Reverse-géocodage au déplacement de l'épingle** : `drive-view` (sélecteur de
  point) et `map-position-picker` débouncent l'appel. Le délai est **configurable**
  (`reverse_geocode_debounce_ms`, `address_search_debounce_ms`) lu via
  `useGeoClientConfig` (`lib/geo/use-geo-client-config.ts`, lecture unique
  mémoïsée, défauts non bloquants).
- **Jamais de GPS brut affiché** : `addresses-panel` et le checkout montrent
  l'adresse lisible (repli « Position sur la carte » / `account.mapPoint`,
  `checkout.mapPoint`).
- **Exceptions volontaires** (dans l'esprit « quasiment jamais ») : les
  coordonnées restent dans le **SMS SOS** (urgence) et en **repli ultime** quand
  le reverse-géocodage échoue réellement (le chauffeur garde un point navigable).

---

## Partie C — Loaders locaux

Déjà imposé par les **règles permanentes** (`CLAUDE.md`, §Performance) : rendu
d'abord, squelettes par segment (`loading.tsx`), jamais de splash plein écran qui
masque la barre de navigation. Les écrans carte/prix montrent un loader **local**
(carte, zone prix) — voir la Partie D pour la zone prix.

---

## Partie D — Cohérence & sécurité des prix

### Recalcul serveur (D4) — déjà en place

- **Drive** : `request_ride` (mig 0208/0174/0172) recalcule la distance serveur
  (Haversine), jamais `p_distance_km` ; le prix est borné au plancher serveur.
- **Livraison** : `createOrder` (`app/(customer)/checkout/actions.ts`) recalcule
  le tarif avec `computeDeliveryFee` + Haversine depuis l'adresse soumise — le
  prix client n'est jamais cru.

### Devis signé serveur (D3) — `geo_quotes` (mig 0234)

Chaque estimation peut émettre un **devis** stocké côté serveur :

- **Lié aux adresses** (tolérance ~80 m), **usage unique** (`consumed_at`),
  **expirable** (TTL = `quote_ttl_s`).
- `geo_quote_issue` : distance **recalculée serveur**, jamais celle du client.
- `geo_quote_verify` : propriété + contexte + non-expiré + non-consommé +
  adresses inchangées → consomme et renvoie le prix/distance du devis.
- RLS : lecture owner uniquement ; écritures par fonctions `SECURITY DEFINER`.
- Helper applicatif : `lib/data/geo-quote.ts` (`issuePriceQuote`,
  `verifyPriceQuote`, `quoteRejectionMessage`).

### Anti-prix-périmé (D1 / D2)

**Drive** (`components/customer/drive/drive-view.tsx`) :

1. Au changement de trajet, l'ancien prix est **effacé** et le bouton
   « Demander » **désactivé** (`pricing`) le temps du recalcul.
2. Les réponses de prix **en retard sont annulées** (flag `cancelled` dans
   l'effet) → pas de race où un vieux prix écrase le neuf.
3. Le prix repart du **recommandé** du nouveau trajet (jamais un prix d'un autre
   trajet).
4. `issueDriveQuote` émet un devis lié aux adresses ; `requestRide` le
   **vérifie+consomme** avant d'engager → réservation refusée si adresse changée /
   devis expiré / déjà utilisé (message FR `price.recalculating`,
   `quoteRejectionMessage`).

**Livraison** : `issueDeliveryQuote` + `createOrder` vérifie/consomme
`delivery_quote_id` (refus si **adresse changée**). Le tarif reste recalculé
serveur (autoritaire) ; le devis lie la commande à l'adresse vue par le client,
**sans bloquer** un checkout légitime (un devis expiré/introuvable n'empêche pas
la commande car le recompute fait foi).

> Note : côté livraison, l'affichage du tarif est **synchrone** (dérivé de
> l'adresse choisie) et le serveur recalcule depuis l'adresse soumise — il n'y a
> donc pas de fenêtre « prix périmé » comme en Drive. Le devis y apporte la
> **liaison adresse + usage unique** demandée par le prompt.

---

## Partie E — Registre de config + multi-ville (mig 0233)

### Valeurs globales

Nouvelles colonnes dans `platform_settings` + entrées dans
`platform_config_registry` (éditables sur `/admin/config`, FR/AR, historisées par
le trigger 0012). Lecture serveur typée : `lib/data/geo-config.ts`
(`getGeoConfig({ wilaya, commune })`).

### Surcharge PAR VILLE

`settings_city_overrides` (wilaya/commune) + resolver `setting_city_override`
(résolution **commune > wilaya > global**). `getGeoConfig` applique
automatiquement la surcharge si un périmètre ville est fourni.

### Clés créées

| Clé                           | Type   | Défaut                                                  | Par ville ?            |
| ----------------------------- | ------ | ------------------------------------------------------- | ---------------------- |
| `address_suggestions_max`     | number | 8                                                       | ✅ (override possible) |
| `address_search_debounce_ms`  | number | 450                                                     | ✅                     |
| `reverse_geocode_debounce_ms` | number | 450                                                     | ✅                     |
| `cache_ttl_google_s`          | number | 2 592 000 (30 j)                                        | ✅                     |
| `cache_ttl_free_s`            | number | 86 400                                                  | ✅                     |
| `google_min_qlen`             | number | 5                                                       | ✅                     |
| `google_daily_global`         | number | 500                                                     | ✅                     |
| `google_daily_per_user`       | number | 25                                                      | ✅                     |
| `geocode_google_enabled`      | bool   | true (kill-switch)                                      | ✅                     |
| `quote_ttl_s`                 | number | 300                                                     | ✅                     |
| `provider_priority`           | json   | gazetteer→merchants→photon→nominatim→google             | ✅                     |
| `confidence_score_weights`    | json   | precision .4 / provider .2 / quality .2 / validation .2 | ✅                     |

> « Par ville » = surchargeable via `settings_city_overrides` ; en pratique le
> debounce et le nb de suggestions restent souvent globaux, mais l'infra le
> permet sans nouvelle migration. La recherche d'adresse est nationale (pas de
> scope ville passé) ; le scope ville s'applique surtout aux clés prix/devis.

---

## Points de vigilance (rappel)

1. **Race condition prix** → annulation des réponses en retard + devis lié aux
   adresses (Drive). ✅
2. **Coût Google** → gratuit d'abord + cache 30 j partagé + plafonds + kill-switch
   `geocode_google_enabled`. ✅
3. **Quote ID rejouable** → usage unique (`consumed_at`) + TTL + lié aux adresses
   - écritures `SECURITY DEFINER`. ✅
4. **Cache empoisonné** → seules les recherches Google (validées) entrent au cache
   30 j ; le gazetteer apprend des **choix confirmés** des clients. ✅
5. **RLS** → historique/favoris isolés par utilisateur ; le cache d'adresses
   partagé (`geo_google_cache`) ne contient **que** des données d'adresse
   publiques (aucun lien utilisateur). ✅

---

## Réglages courants (sans développeur)

- **Couper le coût Google** : `/admin/config` → `geocode_google_enabled = false`.
- **Réduire la facture sans couper** : baisser `google_daily_global` /
  `google_daily_per_user`, monter `google_min_qlen`.
- **Recherche plus réactive / moins d'appels** : ajuster
  `address_search_debounce_ms` / `reverse_geocode_debounce_ms`.
- **Durée de validité d'un prix** : `quote_ttl_s`.
- **Spécifique à une ville** : ajouter une ligne dans `settings_city_overrides`
  (scope `wilaya`/`commune`, `key`, `value` JSONB).

---

## Migrations

| #    | Contenu                                                                                 |
| ---- | --------------------------------------------------------------------------------------- |
| 0233 | Clés de config geo + `settings_city_overrides` + resolver `setting_city_override`       |
| 0234 | `geo_quotes` (devis signés) + `geo_quote_issue` / `geo_quote_verify` + `geo_distance_m` |

Antérieures réutilisées : 0037 (adresses client), 0067 (favoris commerces),
0152-0156 (gazetteer), 0178 (cache Google + quotas), 0179 (apprentissage global),
0180 (personnalisation/favoris lieux), 0208 (escrow + recalcul Drive).

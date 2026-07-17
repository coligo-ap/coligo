# Coligo — Système Anti-Fraude Enterprise

Moteur hybride de confiance et de détection de fraude pour les 4 populations
(clients, livreurs, chauffeurs, commerçants), inspiré des architectures
Uber/Bolt, adapté au socle Coligo : **Postgres/Supabase fait le calcul, Vercel
orchestre, le Super Admin décide** — et chaque décision confirmée/rejetée
ré-entraîne le moteur.

## 1. Les trois scores (par acteur)

| Score         | 0–100     | Sens                                                        |
| ------------- | --------- | ----------------------------------------------------------- |
| `trust_score` | ↑ bon     | Capital confiance : ancienneté, volume complété, notes, IDV |
| `fraud_score` | ↑ mauvais | Somme pondérée des règles déclenchées (poids APPRIS)        |
| `risk_score`  | ↑ mauvais | `fraud` modulé par la confiance → décision                  |

`risk_level` : `low` < 25 ≤ `medium` < 50 ≤ `high` < 75 ≤ `critical`.
Chaque score est **explicable** : `fraud_scores.components` liste chaque règle,
sa valeur mesurée, son seuil, ses points. Aucune boîte noire.

## 2. Sources de données (réutilisation maximale)

Les détecteurs lisent l'HISTORIQUE DÉJÀ EN BASE : `orders` + `order_events`
(phases, positions livreur `driver_live_*`, annulations attribuées par note),
`express_declines`, `rides` (+ `cancelled_by`, timestamps de phase),
`ride_offers`, `ride_events`, `order_messages`/`ride_messages` (chat),
`user_device_log` (IP/appareils/geo réseau), `delivery_reports`/`ride_reports`
(plaintes), `customers.noshow_count`, `chauffeur_presence`, notes/ratings.

La table `fraud_events` ne capture QUE ce qui manquait : offre vue/ignorée,
appel in-app, contact révélé, **position au moment d'une annulation**,
déconnexion forcée, popup affichée/acceptée, mesures appliquées.

## 3. Moteur hybride (SQL, `fraud_evaluate_actor`)

1. **Règles métier** (`fraud_rules`, ~28 règles seedées) : seuils dans
   `params` (jsonb), modifiables depuis le Centre Anti-Fraude sans déploiement.
2. **Scoring dynamique** : fenêtres 7/30/90 j, contribution proportionnelle au
   dépassement du seuil, bornée par le poids de la règle.
3. **Anomalies** : z-score de chaque métrique vs la population de ses pairs
   (`fraud_population_stats`, rafraîchie par le cron quotidien).
4. **Apprentissage persistant** : chaque alerte **confirmée** ou **rejetée**
   par l'admin incrémente `confirmed_hits`/`dismissed_hits` de la règle. Le
   poids effectif = poids de base × précision bayésienne estimée
   (prior Beta(2,1), borné ×0.2 … ×1.5). Une règle qui génère des faux positifs
   s'atténue TOUTE SEULE ; une règle toujours confirmée monte en puissance.

## 4. Fraudes détectées (catalogue `fraud_rules`)

- **Contournement de commission** : annulation alors que le partenaire est à
  < 300–400 m de la destination (`*_CANCEL_NEAR_DEST`, position capturée au
  moment exact de l'annulation) — la fraude n° 1 chez Uber/Bolt.
- **« Annule, je te fais un prix »** : le client annule ≤ 15 min après un
  appel/message du partenaire (`*_CONTACT_THEN_CUSTOMER_CANCEL`) — compte
  aussi comme « situation suspecte » côté client (popup pédagogique).
- Annulation après acceptation / après déplacement / tardive, abandon après
  pickup, refus excessifs, offres ignorées, faux préparatifs commerçant,
  no-show, multi-comptes (IP/appareils partagés), abus de remboursements,
  **collusion** (même paire client×partenaire qui recommence, `COL_REPEAT_PAIR`),
  fantôme en ligne (connecté sans bouger ni répondre).

## 5. Actions progressives (journalisées, réversibles)

`fraud_actions` : `warn` → `require_ack` (popup client bloquante) → `limit` →
`force_offline` → `require_idv` → `suspend`. Chaque ligne porte source
(auto/admin), raison, alerte d'origine, expiration, révocation (`revoked_at`).
**Automatique par défaut** : warn, require_ack, force_offline. `suspend`
automatique = désactivé par défaut (`auto_suspend_enabled`) → le moteur émet
une RECOMMANDATION critique au Super Admin à la place. Le partenaire est
notifié (cloche + push) à chaque mesure ; l'admin voit tout remonter.

## 6. Auto-déconnexion (sweep `fraud_tick`)

Piggyback throttlé (≥ 60 s entre passes, verrou advisory) sur les chemins
chauds — pull Express livreur, heartbeat chauffeur, ping télémétrie — plus le
cron quotidien `/api/cron/fraud` (stats population, décroissance, hygiène) :

- chauffeur `is_online` avec presence muette > 8 min → hors ligne forcé ;
- livreur sans pull Express > 10 min → présence close (`fraud_partner_presence`) ;
- 3 offres ignorées d'affilée → hors ligne forcé + notification ;
- chaque déconnexion = `fraud_actions` + `fraud_events` + notification
  partenaire + remontée admin.

## 7. Popup client obligatoire

≥ 3 situations suspectes (`fraud_scores.suspicious_count`, annulations
post-contact / near-dest) → action `require_ack` active → le layout client
monte une modale **non fermable** (pas de croix, pas d'overlay-close, bloque
la navigation de l'espace) : ne JAMAIS accepter une demande d'annulation d'un
chauffeur/livreur/commerçant, contacter le support. Le bouton unique
« Oui, j'ai compris et je suis d'accord » enregistre l'acceptation
(`customer_fraud_acks` : IP, appareil, horodatage) et révoque l'action.
Défense en profondeur : le checkout et la demande de course revérifient le
gate côté serveur.

## 8. Centre Anti-Fraude (`/admin/anti-fraude`, domaine Confiance)

- **Vue d'ensemble** : KPIs temps réel, alertes par jour/gravité (14 j),
  répartition des niveaux de risque, comptes à risque.
- **Alertes** : 4 gravités, filtres, examen → **Confirmer la fraude / Rejeter
  (faux positif)** = label d'apprentissage.
- **Comptes** : classement par risque, recherche, 4 populations.
- **Investigation** (par acteur) : scores + composantes expliquées, évolution
  (historique), timeline unifiée (événements fraude + commandes + courses),
  appareils/IP + comptes liés, actions actives, application/révocation de
  mesures.
- **Règles & réglages** : activer/désactiver, poids, seuils, précision apprise
  par règle, seuils d'automatisation.

RBAC : tout est gardé `admin_can('confiance')` (RPC SECURITY DEFINER) +
`requireAdminDomain("confiance")` côté pages. Les alertes hautes/critiques
remontent dans le moteur d'alertes global (`_admin_alert_rules_confiance`).

## 9. Fichiers

- Migrations : `0373_fraud_core.sql` (tables + seeds), `0374_fraud_engine.sql`
  (features, détecteurs, évaluation, sweep, RPC admin, alertes).
- `lib/fraud/` : `events.ts` (capture fire-and-forget), `tick.ts` (sweep +
  notifications), `gate.ts` (gate client), `model.ts` (types client-safe).
- Cron : `app/api/cron/fraud/route.ts` (quotidien 04:45).
- Admin : `app/admin/(confiance)/anti-fraude/**` + `components/admin/fraud/*`.
- Client : `components/customer/fraud-ack-gate.tsx` (modale bloquante).

## 10. Garde-fous anti-faux-positifs

Bénéfice du doute aux nouveaux (min_events/min_decisions par règle), fenêtres
temporelles, seuils configurables, poids auto-atténués par les rejets admin,
`suspend` jamais automatique par défaut, toute mesure réversible et tracée,
et le client n'est JAMAIS bloqué par la popup — il lit, accepte, continue.

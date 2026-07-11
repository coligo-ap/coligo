# Coligo — guide pour Claude Code

## UX — messages d'erreur/succès : PRIVILÉGIER L'INLINE, ÉVITER LES TOASTS

Règle produit : **ne pas abuser des toasts** (`toast.error`/`toast.success`).
En répétition ils encombrent l'interface client. Par défaut, **afficher le
message LÀ OÙ se trouve l'action** :

- sous l'input concerné (validation, « code invalide », « 2 essais restants »…),
- au-dessus / sur le bouton d'action (résultat d'un enregistrement),
- dans la section / la carte concernée.

N'utiliser un **toast QUE** quand il n'y a aucun contexte visuel adapté (ex.
événement global asynchrone : nouvelle commande, perte de connexion). Pour toute
soumission de formulaire, validation de champ ou action sur un bouton →
**message inline** (rouge erreur / vert succès), pas de toast.

## UX — états des boutons : LOADING immédiat + état LOCAL par élément (obligatoire)

Règle **obligatoire pour tout développement**. Tout bouton qui déclenche une
action asynchrone (Server Action, fetch, mutation, upload…) doit gérer ses états
explicitement :

- **loading immédiat** : au clic, le bouton passe TOUT DE SUITE en `pending`,
  devient `disabled`, et montre un indicateur (spinner `Loader2` / « … » / texte).
  L'utilisateur voit que son clic est pris en compte → pas de double-clic ;
- à la réponse : retour normal, ou **succès** (✓ vert) / **erreur** inline
  (bouton re-cliquable + message). Aucun bouton ne reste statique pendant l'appel.

**État LOCAL par élément — JAMAIS un état global qui bloque toute la page.** Dans
une liste (cartes, lignes), cliquer le bouton d'un élément ne met en chargement
QUE ce bouton ; les autres restent pleinement utilisables (pas de spinner, pas de
`disabled`, aucun changement d'état). Chaque élément a son propre
`useTransition()` / `pending`. Une action sur un composant ne doit jamais
impacter visuellement/fonctionnellement un composant non concerné.

Chaque action = son propre `pending` (ex. `ProductCard` : `dupPending`,
`delPending`, `pending` dispo séparés). En cas de doute, préférer un état local
par élément plutôt qu'un état partagé.

## UX — JAMAIS de doublon d'information sur une même page

Une information (statut, montant, créneau, adresse…) s'affiche **UNE seule
fois par écran** sous forme textuelle. Une visualisation peut la re-présenter
sous une AUTRE forme (tracker d'étapes, barre de progression, icône), mais
jamais le même libellé répété — exemple vécu : « Prête à récupérer »
apparaissait 3× sur le suivi de commande (titre d'état + étape du tracker +
ligne délai). Règles :

- une ligne secondaire (délai, ETA…) n'existe que si elle **apporte** une
  info nouvelle, pas pour reformuler le titre ;
- avant d'ajouter un bloc, relire ce que la page affiche déjà ;
- si deux blocs montrent la même donnée, garder celui « d'un coup d'œil »
  (héro) et supprimer l'autre, ou fusionner.

## UX — RIEN ne doit sortir du champ visible (mobile en priorité)

Tout élément flottant — **menu déroulant, popover, tooltip, feuille, bulle,
sélecteur** — doit s'ouvrir **VERS L'INTÉRIEUR** de l'écran, jamais déborder
hors du viewport. Bug vécu : le menu « Outils/Filtres » du catalogue commerçant
(`absolute right-0 w-60`) était ancré à droite alors que le bouton est **à
gauche** de la barre sur mobile → le menu de 240px partait 240px **hors écran à
gauche**. Règles :

- ancrer le panneau au bord du bouton du côté où il y a **de la place** :
  bouton à gauche ⇒ `start-0` (s'ouvre vers la droite), bouton à droite ⇒
  `end-0`. Utiliser les propriétés **logiques** (`start`/`end`, `ms`/`me`), pas
  `left`/`right`, pour rester correct en **RTL** (arabe) ;
- ajouter un garde-fou de largeur : `max-w-[calc(100vw-2rem)]` (ou
  `max-w-[100vw]`) sur tout panneau flottant large, pour qu'il ne dépasse
  JAMAIS la largeur de l'écran quelle que soit la position du bouton ;
- vérifier **sur mobile** (viewport ~360px) : ouvrir chaque popup/menu et
  s'assurer qu'il est entièrement visible et tapable ;
- pour un menu dont le bouton peut être n'importe où, préférer un centrage
  (`left-1/2 -translate-x-1/2`) ou une feuille ancrée en bas plutôt qu'un
  ancrage latéral fragile.

## UX — écran chargé de VARIANTES → nav sous-page + édition en feuille (style Bolt / Bolt Food)

Quand un écran empile plusieurs sous-sections lourdes (ex. fiche produit :
détails + **options / variantes / groupes**), NE PAS tout mettre à la suite en un
long défilement. Découper en **sous-pages navigables** avec une **nav segmentée**
en haut :

- barre segmentée `[Détails] · [Options & variantes]` (badge de compteur sur
  l'onglet), un seul tap pour passer de l'une à l'autre — plus de scroll infini ;
- **les panneaux restent MONTÉS** (l'inactif en `hidden`), jamais `key={tab}` qui
  remonterait et **perdrait la saisie** en cours ; le panneau qui (ré)apparaît
  reçoit une classe d'animation (`@keyframes` local) → **fondu doux** à chaque
  activation (transition soignée sans dépendance) ;
- l'en-tête (retour + titre + action destructive) est **partagé** au-dessus des
  onglets. Réf. : `components/merchant/product-editor-tabs.tsx`.

Corollaire — **action destructive en HAUT, pas en bas** : le bouton « Supprimer »
d'une fiche se place **sur la ligne du titre** (compact, icône + label ≥ `sm`),
jamais tout en bas (inutile de dérouler toute la page pour supprimer).

Corollaire — **regrouper les boutons d'un en-tête derrière « Modifier »** : quand
une ligne (ex. en-tête de catégorie catalogue) accumule photo + renommer +
supprimer, remplacer par **UN** bouton « Modifier » ouvrant une **feuille**
(`Portal`, ancrée en bas sur mobile / centrée ≥ `sm`) qui regroupe tout (renommer,
photo add/change/remove, supprimer). Réf. : `CategoryEditSheet` dans
`components/merchant/catalog-categories.tsx`. Toujours : expert front, style Bolt.

## Accès production Supabase (à utiliser SANS REDEMANDER)

Pour toute tâche d'admin/DB, **fais-le toi-même** au lieu de me lister
les étapes du Dashboard Supabase. Je t'ai déjà donné les accès :

- **Pooler Postgres** : connection string construite par `scripts/_supabase.mjs`
  (`getDbUrl()`). Mot de passe lu depuis `.env.local` (`SUPABASE_DB_PASSWORD`).
  Utilisable directement avec `pg` (déjà installé) ou via `psql`.
- **Service role key** : `SUPABASE_SERVICE_ROLE_KEY` dans `.env.local`.
  Donne accès complet à `auth.admin.*` (createUser, updateUserById,
  generateLink, etc.) et bypass de tous les RLS.

### Workflow standard

| Tâche                            | Méthode                                                        |
| -------------------------------- | -------------------------------------------------------------- |
| Appliquer une migration          | écrire `supabase/migrations/00XX_*.sql` puis `npm run db:push` |
| Query / fix de données ponctuel  | `node -e "import('pg').then(...)"` avec `getDbUrl()`           |
| Créer/mettre à jour un user auth | `node scripts/admin-create-user.mjs <email> <password>`        |
| Inspecter                        | `npm run db:status`, `npm run db:inspect`, ou query directe    |

### Règles

1. **Ne demande pas la permission** pour pousser une migration ou modifier la
   DB de prod si la tâche est claire — exécute, vérifie, rapporte.
2. **Toujours nouvelle migration** pour les changements DDL/DML structurés
   (numéro suivant dispo, format `00XX_description.sql`), jamais éditer une
   migration déjà appliquée.
3. **Pour les hot-fixes data** non versionnés (ex. swap d'un email
   ponctuel), tu peux exécuter via `pg` direct sans migration — mais
   privilégie la migration dès que c'est répétable.
4. **Vérifier après écriture** : lis l'état réel de la DB (SELECT) avant de
   conclure « c'est fait ».
5. **Auto-confirm l'email** quand tu crées un user admin/test
   (`email_confirm: true`), sinon l'utilisateur reste bloqué tant qu'il ne
   clique pas le lien de confirmation.

### Push de code — TOUT SUR `main` (PRODUCTION), PAS SUR `dev`

**Règle en vigueur depuis le 09/07/2026, jusqu'à signal contraire explicite du
propriétaire.** La production **n'est pas encore ouverte au public** : elle sert
d'environnement de développement et ne contient que des **données de test**.

- **Toute évolution et tout correctif vont directement sur `main`** : commit +
  push sur `main`, sans feature branch, sans PR, sans demander.
- **Toute migration s'applique sur la DB de prod** (`npm run db:push`), en
  premier. C'est la base de référence.
- **L'environnement `dev` est en pause.** On ne développe plus dessus, on ne le
  synchronise plus à chaque commit. On y reviendra **uniquement sur demande
  explicite** du propriétaire (« remets dev et prod au même niveau »), puis, une
  fois la prod réellement livrée au public, `dev` redeviendra l'environnement de
  travail et `main` la cible de promotion.
- Ne PAS proposer de repasser sur `dev` de sa propre initiative.

Format de commit : `feat|fix|chore(scope): titre court`, corps optionnel,
co-auteur `Claude Opus 4.8 <noreply@anthropic.com>`.

## Super-admin actuels (table `platform_admins`)

- `coligo.noreply@gmail.com` — compte applicatif (mot de passe partagé avec
  le proprio)
- `gacinoufel@gmail.com` — backup (compte auth pas encore créé côté
  `auth.users`)

Pour ajouter un admin : `INSERT INTO public.platform_admins (email) VALUES ('x@y.z')`
puis créer l'auth user s'il n'existe pas.

## Convention commit / langue

- UI/code : français (commentaires, copy, labels).
- Identifiants techniques : anglais (noms de fonctions, fichiers, tables).
- Messages de commit : français accepté.

## Performance & navigation (règles permanentes, tout le projet)

Objectif : **transition entre pages ressentie < 100 ms**. Toute page s'affiche
immédiatement ; le réseau ne bloque JAMAIS l'affichage.

1. **Navigation toujours client-side** (App Router) : `<Link>` / `router.push`,
   JAMAIS de `<a href>` interne ni de full reload entre pages d'un même espace.
2. **Prefetch** des routes de navigation principale (barre du bas, onglets) —
   `<Link>` prefetch par défaut ; pour que ce soit efficace sur les routes
   dynamiques, fournir une **frontière de chargement** (`loading.tsx`).
3. **Rendu d'abord, données ensuite** : jamais de fetch bloquant au montage.
   Afficher la structure tout de suite (**skeleton via `loading.tsx`** au niveau
   du segment, pas un splash plein écran qui masque tout à chaque nav) puis
   streamer les données. Les requêtes serveur indépendantes d'une page se font
   en **`Promise.all`** (jamais en `await` séquentiels).
4. **Cache de données** côté client avec **TanStack Query** quand on lit des
   données réaffichées souvent : `staleTime` raisonnable, `placeholderData` /
   `keepPreviousData`, **pas de refetch systématique au montage** → les données
   se réaffichent depuis le cache puis se rafraîchissent en silence.
5. **Instances coûteuses persistantes** : la carte (MapLibre/OpenFreeMap) et
   autres objets lourds ne sont **jamais recréés** à chaque navigation (état
   hissé / composant monté une fois / keep-alive). Leur init ne bloque pas la
   nav.
6. **État global conservé entre pages** (Zustand) : statut en ligne / STOP,
   position GPS, solde portefeuille ne se rechargent pas à chaque onglet.
7. **Allègement du montage** : code-splitting / `dynamic(import)` des parties
   lourdes, pas de gros travail synchrone au render, mémoïsation utile.
8. **Dédup auth par requête** : les helpers de session (`getCurrentDriver`, …)
   sont enveloppés dans React `cache()` (dédupe layout + page dans un même
   rendu).
9. **`loading.tsx` OBLIGATOIRE sur toute route qui `await` côté serveur**
   (notamment toutes les pages `force-dynamic` : chauffeur, livreur, commerçant,
   client, admin). Un Server Component qui fait `await getXxxGate()` /
   `await` data AVANT de rendre **bloque la navigation** tant que le serveur n'a
   pas répondu → transition lente. La frontière `loading.tsx` (squelette au
   niveau du segment, barre de nav conservée, PAS un splash plein écran) fait
   apparaître l'écran **instantanément** au tap, puis le contenu se streame.
   C'est ce qui rend le `<Link>`/`router.push` prefetché réellement instantané :
   sans `loading.tsx`, le prefetch d'une route dynamique ne sert à rien. Régle
   non négociable — **chaque nouvelle page = son `loading.tsx`**.
10. **Toute navigation doit être ressentie instantanée**, dans les DEUX sens
    (ex. accueil chauffeur ⇄ Drive) : `<Link>` prefetché (barre du bas) +
    `loading.tsx` + rendu d'abord. Si une transition « rame », c'est un BUG à
    corriger, pas un état acceptable.
11. **Retour arrière SANS rechargement complet** (A → B → A). Le Router Cache
    client est réglé via `experimental.staleTimes` (next.config.ts :
    `dynamic: 30`) → revenir sur une page récemment visitée RÉUTILISE le segment
    déjà rendu (instantané, état/scroll préservés, pas de re-fetch serveur ni de
    flash `loading.tsx`). NE PAS remettre `dynamic` à 0. Pour la fraîcheur des
    données : (a) les mutations invalident via `revalidatePath` / `router.refresh`
    (donc pas de données périmées après écriture) ; (b) le « stale-while-
    revalidate » au RETOUR au premier plan est assuré par `RouteRefreshOnFocus`
    (monté dans les coques : CustomerShell, layout chauffeur, MerchantShell) qui
    fait un `router.refresh()` SOUPLE (re-streame le RSC sans démonter la page) ;
    (c) le live continu reste géré par polling / Realtime / **TanStack Query**
    (déjà en place côté livreur : `driver-query-provider`, `staleTime` +
    `placeholderData`). Étendre TanStack Query aux listes lourdes réaffichées
    souvent plutôt que de re-fetcher en RSC à chaque montage.

**La rapidité ne réduit JAMAIS la sécurité.** Sur chaque page : auth (session
Supabase) + RLS toujours vérifiées côté serveur ; **revalidation de session non
bloquante** (ne pas montrer de contenu sensible depuis le cache si la session a
expiré) ; **cache isolé par utilisateur** (clé de cache incluant l'`user.id`)
pour qu'aucune donnée d'un autre compte n'apparaisse ; `client_operation_id` et
contrôles existants conservés.

## RÈGLE PRODUIT — navigation client ULTRA RAPIDE (non négociable)

Objectif startup : **chaque tap doit donner un retour visuel immédiat.** Toute
navigation client (et surtout les boutons type « Historique », « Mes commandes »,
détails…) doit être ressentie **instantanée**.

- **`loading.tsx` OBLIGATOIRE sur TOUTE route qui `await` au serveur.** Sans lui,
  une page `force-dynamic` qui `await` (ex. `getDriveHistory()`) **bloque** : le
  tap « ne fait rien » tant que le serveur n'a pas répondu → l'utilisateur
  reclique en boucle. Symptôme vécu : « j'ai cliqué plusieurs fois sur Historique
  et rien ne s'affichait ». Le squelette rend l'écran **au tap**, puis les données
  se streament.
- **Changements d'état purement client (filtres, dark/clair, onglets) = ZÉRO
  round-trip serveur** : état local / store réactif + `history.replaceState` si
  l'URL doit suivre ; jamais `router.replace`/`router.refresh` qui re-render tout
  le RSC.
- **Listes réaffichées souvent = TanStack Query** (`staleTime`, `placeholderData`)
  → réaffichage instantané depuis le cache puis rafraîchissement silencieux.

**MAIS jamais au prix de la sécurité ni de l'exactitude :** auth + RLS serveur
toujours vérifiées ; cache isolé par `user.id` ; et on n'affiche **que des
informations vraies et à jour** — un cache rapide ne doit jamais montrer un
ancien prix, un ancien solde ou les données d'un autre compte. Rapidité **et**
vérité, pas l'une contre l'autre.

## Robustesse ARRIÈRE-PLAN → REPRISE (non négociable)

Symptôme vécu : un client lance une recherche de course, **quitte l'app** (verrouille
le téléphone, bascule sur Instagram/un autre onglet) pendant que des chauffeurs
répondent (l'un accepte), puis **revient** — l'écran est figé sur l'ancien état, et
« Annuler la recherche » est lent / l'écran ne revient pas vite à l'écran prix.

Cause (à connaître pour TOUT écran « live ») : en arrière-plan, le navigateur
**throttle les timers** (`setInterval`/`setTimeout`) et **ferme souvent les
WebSockets** (Supabase Realtime). À la reprise, l'état client est donc **périmé**
(une course/commande a pu changer pendant l'absence) et la 1ʳᵉ requête part sur une
**connexion froide**. Ne JAMAIS supposer que le polling/Realtime est resté vivant.

**Règle :** tout écran qui dépend d'un état serveur vivant (recherche de course,
suivi de course/commande, offres, statut en ligne, solde temps réel…) DOIT
**re-synchroniser à la reprise** au premier plan. Utiliser le hook partagé
**`useResumeResync(onResume)`** (`lib/hooks/use-resume-resync.ts`) — il écoute
`visibilitychange` + `pageshow` (bfcache) + `focus` + `online` (debounce 600 ms) et
n'agit que page réellement visible. Pattern recommandé : un `resyncNonce` bumpé par
le hook, ajouté aux deps des effets de poll **et** de Realtime → relance immédiate du
fetch ET **ré-abonnement** du canal (qui a pu tomber). Déjà appliqué au parcours
course client (`DriveRide` + `SearchScreen`) : à la reprise, statut de course +
offres re-synchronisés tout de suite → si un chauffeur a accepté pendant l'absence,
l'écran bascule aussitôt (plus d'annulation sur un état mort), et l'action part d'une
connexion réveillée.

Complément obligatoire : si l'onglet a été **déchargé** (et pas seulement gelé), la
page se **remonte** → l'effet de boot doit **restaurer l'état serveur** (course
active, etc.) pour repartir comme si on n'avait jamais quitté (cf. restauration du
trajet « searching » dans `DriveView`). Et tout handler async qui pose un verrou
(`busy`/`submitting`) garde son `try/finally` (cf. [verrou busy/submitting]) pour ne
jamais rester bloqué si la requête de reprise échoue/traîne.

## Réutiliser les composants partagés (anti-duplication)

Quand une fonctionnalité existe déjà (carte, feuille/sheet de course, sélecteur
de position, toggle dark, carte d'adresse…), **réutiliser le composant partagé**
au lieu de réécrire le markup. Le copier-coller recrée les mêmes bugs partout
(ex. une feuille de course qui n'adapte pas le dark à un seul endroit). Un
composant central corrigé une fois = corrigé partout (client + chauffeur +
livreur).

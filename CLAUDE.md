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

### Push de code

L'utilisateur veut toujours commit + push sur `main` direct (pas de feature
branch, pas de PR). Format de commit : `feat|fix|chore(scope): titre court`,
corps optionnel, co-auteur `Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

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

**La rapidité ne réduit JAMAIS la sécurité.** Sur chaque page : auth (session
Supabase) + RLS toujours vérifiées côté serveur ; **revalidation de session non
bloquante** (ne pas montrer de contenu sensible depuis le cache si la session a
expiré) ; **cache isolé par utilisateur** (clé de cache incluant l'`user.id`)
pour qu'aucune donnée d'un autre compte n'apparaisse ; `client_operation_id` et
contrôles existants conservés.

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

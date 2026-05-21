# Coligo v3 — Espace commerçant

Marketplace algérienne de commande à l'avance. **Cette version = espace commerçant** avec vraies interfaces desktop ET mobile (pas un mobile élargi).

## Ce qui est inclus

- **Inscription / connexion commerçant** (email + password)
- **Dashboard desktop** : sidebar fixe + topbar recherche + **kanban 4 colonnes**
- **Dashboard mobile** : header compact + bottom-nav + **tabs + liste verticale**
- **Sélection des 58 wilayas** d'Algérie à l'inscription
- **Tout configurable** via `.env.local` (nom de l'app, domaines, couleurs)
- **Sécurité RLS Postgres** : chaque commerçant ne voit que ses données

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Supabase (Postgres + Auth + RLS) · Lucide icons

---

## Lancement en local

### 1. Prérequis

- Node.js 20+ (npm livré avec)
- Un projet Supabase Cloud

### 2. Installer

```bash
cd coligo
npm install
```

### 3. Configurer Supabase

Crée `.env.local` (copie depuis `.env.local.example`) :

```env
NEXT_PUBLIC_SUPABASE_URL=https://TON_PROJET.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...TA_CLE_ANON
```

Récupère ces valeurs sur https://supabase.com/dashboard/project/_/settings/api (section "Project API keys" → **anon public**, jamais le service_role).

Ajoute aussi le **mot de passe de la base** (Dashboard → Settings → Database → _Database password_) :

```env
SUPABASE_DB_PASSWORD=ton_mot_de_passe_base
```

> La connection string du pooler est construite dans le code (`lib/config/database.ts`) ; seul le mot de passe est lu depuis l'environnement.

### 4. Appliquer les migrations (automatique)

Plus besoin du SQL Editor : les migrations de `supabase/migrations/` sont poussées
vers la base distante via le pooler en une commande.

```bash
npm run db:push      # applique les migrations manquantes
npm run db:status    # compare l'historique local vs distant
npm run db:new <nom> # crée un nouveau fichier de migration (local)
```

`db:push` est idempotent : il ne joue que les migrations absentes de l'historique distant.

### 5. Désactiver la confirmation email (pour tester vite)

Dashboard → Authentication → Providers → Email → décoche **"Confirm email"** → Save

### 6. Lancer

```bash
npm run dev
```

Ouvre http://localhost:3000 → redirigé vers `/login`.

---

## Tester

### Créer un compte

1. "Créer un compte commerçant"
2. Remplis : `Boulangerie El Karim` / `Boulangerie` / wilaya `Alger` / `Bab Ezzouar` / email / mot de passe (8+ car.)
3. → Dashboard (vide)

### Insérer des commandes de test

SQL Editor :

```sql
-- 1. Ton merchant_id
SELECT m.id, m.name FROM public.merchants m
JOIN auth.users u ON u.id = m.user_id;

-- 2. Crée des commandes (remplace MERCHANT_ID)
INSERT INTO public.orders (merchant_id, customer_name, customer_phone, total_da, pickup_slot_at, status)
VALUES
  ('MERCHANT_ID', 'Karim Boudjemaa', '+213555100001', 125, now() + interval '30 min', 'pending'),
  ('MERCHANT_ID', 'Yacine Mansouri', '+213555100002', 280, now() + interval '1 hour', 'accepted'),
  ('MERCHANT_ID', 'Sara Kacem', '+213555100003', 80, now() + interval '15 min', 'preparing'),
  ('MERCHANT_ID', 'Nadir Taleb', '+213555100004', 540, now() - interval '20 min', 'ready'),
  ('MERCHANT_ID', 'Amina Larbi', '+213555100005', 95, now() - interval '2 hour', 'completed');

-- 3. Items pour la première
INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da)
SELECT o.id, 'Baguette traditionnelle', 15, 3, 45 FROM public.orders o WHERE o.customer_name = 'Karim Boudjemaa';
INSERT INTO public.order_items (order_id, product_name, unit_price_da, quantity, line_total_da)
SELECT o.id, 'Croissant beurre', 40, 2, 80 FROM public.orders o WHERE o.customer_name = 'Karim Boudjemaa';
```

Rafraîchis le dashboard → 5 commandes réparties dans le kanban (desktop) ou les tabs (mobile).

### Tester le responsive

- **Desktop** : fenêtre large → sidebar fixe + topbar + kanban 4 colonnes
- **Mobile** : F12 → mode device (Ctrl+Shift+M) → header compact + bottom-nav + tabs

---

## Changer le nom de l'app

Tout est dans `.env.local`. Pour renommer "Coligo" en autre chose :

```env
NEXT_PUBLIC_APP_NAME=MonApp
NEXT_PUBLIC_APP_SHORT_NAME=MonApp
NEXT_PUBLIC_APP_DOMAIN=monapp.dz
NEXT_PUBLIC_MERCHANT_DOMAIN=commercant.monapp.dz
```

Redémarre `npm run dev` → tout l'affichage (logo, titres, emails) se met à jour.

---

## Architecture multi-domaine

Le projet est prêt pour 2 sous-domaines :

- `commercant.coligo.app` → espace commerçant (cette version)
- `coligo.app` → marketplace client (étape suivante)

En local, tout est sur `localhost:3000`. En production (Vercel), tu pointeras les sous-domaines vers le même déploiement, et le middleware routera selon le host.

---

## Structure

```
coligo/
├── app/
│   ├── (merchant)/
│   │   ├── actions.ts            login / signup / logout
│   │   ├── login/page.tsx        design 2 colonnes (marketing + form)
│   │   ├── signup/page.tsx       avec 58 wilayas
│   │   └── dashboard/
│   │       ├── layout.tsx        sidebar + topbar + mobile nav
│   │       └── page.tsx          kanban desktop / tabs mobile
│   ├── auth/confirm/route.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/                       button, card, input, label, badge, separator
│   ├── shared/logo.tsx           utilise APP_CONFIG.name
│   └── merchant/
│       ├── desktop-sidebar.tsx
│       ├── desktop-topbar.tsx
│       ├── mobile-header.tsx
│       ├── mobile-bottom-nav.tsx
│       ├── kpi-card.tsx
│       ├── order-card.tsx        2 variantes : compact (kanban) / detail (mobile)
│       ├── kanban-board.tsx      desktop
│       └── order-list-mobile.tsx mobile
├── lib/
│   ├── config/
│   │   ├── app-config.ts         toute la marque via env
│   │   └── wilayas.ts            58 wilayas FR/AR
│   ├── supabase/                 client, server, middleware
│   ├── types.ts
│   └── utils.ts
├── supabase/migrations/0001_init.sql
├── middleware.ts
└── configs (next, ts, tailwind, eslint, postcss)
```

---

## Prochaines étapes

1. **Catalogue produits** (CRUD, bilingue FR/AR)
2. **Gestion des statuts** (accepter, préparer, prête)
3. **QR + code 6 chiffres** pour validation retrait
4. **Marketplace client** (`coligo.app`, style Uber Eats : recherche par wilaya/commune, nom, catégorie)
5. **Wallet, admin, livreur**

---

## Dépannage

- **"supabaseUrl is required"** → `.env.local` manquant ou vide
- **"Email not confirmed"** → désactive la confirmation email (étape 5)
- **Erreur RLS au SQL Editor** → le SQL Editor bypass RLS par défaut, ça devrait passer
- **Page blanche** → vérifie la console navigateur (F12)

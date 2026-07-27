-- =============================================================================
-- 0414 — Brouillons d'inscription commerçant (wizard étape par étape).
--
-- À chaque étape franchie du wizard /signup (et /signup/boutique), le client
-- enregistre un BROUILLON : données saisies + position GPS + étape atteinte.
-- Le super-admin voit ainsi les inscriptions COMMENCÉES mais NON FINALISÉES
-- (onglet Inscriptions du hub Commerçants) et peut recontacter le commerçant
-- (téléphone demandé dès l'étape 1).
--
-- Sécurité : RLS activée SANS policy → lecture/écriture UNIQUEMENT via
-- service_role (action serveur `saveSignupDraft` qui n'écrit que les clés
-- soumises, et data admin self-guardée). Le `draft_key` est un UUID généré
-- côté client (localStorage) : il sert de jeton non devinable pour reprendre
-- LE MÊME brouillon à chaque étape.
-- =============================================================================

create table if not exists public.merchant_signup_drafts (
  id uuid primary key default gen_random_uuid(),
  draft_key uuid not null unique,
  source text not null default 'email'
    check (source in ('email', 'google')),
  -- in_progress → visible admin ; completed → inscription finalisée (boutique
  -- créée) ; dismissed → écartée par l'admin.
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'dismissed')),
  step_reached int not null default 1,
  steps_total int not null default 4,
  merchant_name text,
  manager_name text,
  phone text,
  email text,
  categories jsonb,
  wilaya_code text,
  city text,
  address text,
  latitude double precision,
  longitude double precision,
  -- Renseigné quand une session existe (complétion Google).
  auth_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.merchant_signup_drafts is
  'Brouillons d''inscription commerçant enregistrés à chaque étape du wizard — suivi admin des inscriptions non finalisées.';

alter table public.merchant_signup_drafts enable row level security;
-- Aucune policy : accès service_role uniquement.

-- Liste admin : brouillons en cours, plus récents d'abord.
create index if not exists idx_signup_drafts_status_updated
  on public.merchant_signup_drafts (status, updated_at desc);

-- =============================================================================
-- 0415 — Thème d'apparence piloté par le super-admin (occasions : Ramadan,
-- Aïd, été, promos…). Ligne unique :
--   • theme            : clé du preset (lib/config/app-themes.ts) — héros des
--                        portails d'auth (dégradé + blobs) via variables CSS.
--   • marketplace_hero : appliquer AUSSI un bandeau thémé à l'accueil
--                        marketplace (false = accueil simple actuel).
--
-- Lecture PUBLIQUE (anon + authenticated) : un nom de thème n'a rien de
-- sensible et les portails d'auth sont anonymes. Écriture : service_role
-- uniquement (action admin setAppTheme, adminCan plateforme).
-- =============================================================================

create table if not exists public.app_theme (
  id boolean primary key default true check (id),
  theme text not null default 'coligo',
  marketplace_hero boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.app_theme (id) values (true)
on conflict (id) do nothing;

alter table public.app_theme enable row level security;

drop policy if exists app_theme_read on public.app_theme;
create policy app_theme_read on public.app_theme
  for select to anon, authenticated using (true);

-- Lecture anon/authenticated explicite (cf. piège « RPC publique invisible en
-- anon » : toujours accorder par rôle appelant, anon compris).
grant select on public.app_theme to anon, authenticated;

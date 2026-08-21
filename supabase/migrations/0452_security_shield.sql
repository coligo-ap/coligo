-- ============================================================================
-- 0452 — Bouclier anti-abus : rate limiting générique + journal sécurité
-- ============================================================================
-- Contexte : aucune limite applicative n'existait sur les surfaces ANONYMES
-- (inscriptions ×5 rôles, logins, reset mot de passe, drafts commerçant en
-- service_role, proxy de téléchargement APK). Vercel Hobby n'offre pas de
-- rate limiting WAF et le domaine est en DNS-only chez Cloudflare → la limite
-- vit ICI, dans Postgres, appelée par les Server Actions via service_role.
--
-- Modèle : fenêtre FIXE par (bucket, subject). Un « hit » incrémente le
-- compteur de la fenêtre courante et répond permis/refusé + délai de retry.
-- p_cost = 0 permet de CONSULTER sans incrémenter (peek) — utilisé côté login
-- pour ne compter que les ÉCHECS : sinon un attaquant pourrait verrouiller le
-- compte d'une victime en spammant son identifiant avec de mauvais mots de
-- passe (le peek bloque AVANT la tentative, le hit ne part qu'après un échec).
-- ============================================================================

create table if not exists public.security_rate_limits (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null default now(),
  hits integer not null default 0,
  primary key (bucket, subject)
);

alter table public.security_rate_limits enable row level security;
-- Aucune policy : seul service_role (bypass RLS) lit/écrit cette table.

-- Journal des événements de sécurité (blocages, honeypot, captcha échoué…).
-- Consommé plus tard par le moteur d'alertes admin ; pour l'instant, trace
-- d'audit interrogeable en SQL.
create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  bucket text,
  subject text,
  ip text,
  user_agent text,
  path text,
  details jsonb not null default '{}'::jsonb
);

create index if not exists security_events_created_idx
  on public.security_events (created_at desc);
create index if not exists security_events_kind_idx
  on public.security_events (kind, created_at desc);

alter table public.security_events enable row level security;
-- Aucune policy : service_role seul.

create or replace function public.security_rate_hit(
  p_bucket text,
  p_subject text,
  p_max integer,
  p_window_seconds integer,
  p_cost integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_hits integer;
  v_start timestamptz;
  v_reset timestamptz;
begin
  if p_cost <= 0 then
    -- Peek : lit la fenêtre courante sans l'incrémenter.
    select hits, window_start
      into v_hits, v_start
      from security_rate_limits
     where bucket = p_bucket
       and subject = p_subject
       and window_start + make_interval(secs => p_window_seconds) > v_now;
    v_hits := coalesce(v_hits, 0);
    v_reset := coalesce(v_start, v_now)
               + make_interval(secs => p_window_seconds);
    return jsonb_build_object(
      'allowed', v_hits < p_max,
      'retry_after_seconds',
      greatest(0, ceil(extract(epoch from (v_reset - v_now))))::int
    );
  end if;

  insert into security_rate_limits as r (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_now, p_cost)
  on conflict (bucket, subject) do update
    set hits = case
          when r.window_start + make_interval(secs => p_window_seconds) <= v_now
            then excluded.hits
          else r.hits + excluded.hits
        end,
        window_start = case
          when r.window_start + make_interval(secs => p_window_seconds) <= v_now
            then v_now
          else r.window_start
        end
  returning hits, window_start into v_hits, v_start;

  -- Ménage probabiliste (~1 appel sur 200) : purge les fenêtres mortes sans
  -- avoir besoin d'un cron dédié.
  if random() < 0.005 then
    delete from security_rate_limits
     where window_start < v_now - interval '2 days';
  end if;

  v_reset := v_start + make_interval(secs => p_window_seconds);
  return jsonb_build_object(
    'allowed', v_hits <= p_max,
    'retry_after_seconds',
    greatest(0, ceil(extract(epoch from (v_reset - v_now))))::int
  );
end;
$$;

-- Rôle d'exécution : service_role UNIQUEMENT (règle projet : REVOKE explicite
-- et test en anon — un anon doit recevoir « permission denied »).
revoke all on function public.security_rate_hit(text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.security_rate_hit(text, text, integer, integer, integer)
  to service_role;

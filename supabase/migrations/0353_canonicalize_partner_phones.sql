-- Canonicalise les numéros de téléphone stockés.
--
-- Le téléphone est l'identifiant de connexion du livreur, du chauffeur et de
-- l'Agent Coligo Pay : il devient un email synthétique
-- `<chiffres>@<population>.coligo.local`. Jusqu'ici chaque écran normalisait à
-- sa façon (`raw.replace(/\D/g, "")`), et la colonne `phone` recevait la même
-- bouillie que l'email — d'où une ligne comme `33603044619`, un mobile français
-- amputé de son `+`. La dérivation est désormais unique
-- (`lib/auth/phone-identity.ts`, bâtie sur `composePhone()`) ; il reste à
-- réparer les lignes écrites par l'ancienne.
--
-- Formes canoniques, les seules produites ensuite :
--   • Algérie       `0XXXXXXXXX`  (mobile 05/06/07)
--   • hors Algérie  `+CC…`        (E.164)
--
-- Les emails d'authentification NE CHANGENT PAS : ils ne retiennent que les
-- chiffres, et `+33603044619` comme `33603044619` donnent `33603044619`. Aucun
-- compte existant ne devient injoignable — `scripts/test-phone-identity.mjs` le
-- vérifie ligne à ligne contre la base.

-- Fonction de travail : créée, utilisée, puis supprimée en fin de migration.
-- (Pas de `pg_temp` : rien ne garantit que le runner de migrations exécute tout
-- le fichier dans une seule session.)
create or replace function public.__canonicalize_phone(raw text)
returns text
language sql
immutable
as $$
  with digits as (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as d)
  select case
    -- Déjà canonique : on ne touche à rien.
    when raw ~ '^0[567][0-9]{8}$'  then raw
    when raw ~ '^\+[0-9]{8,15}$'   then raw
    -- Préfixe international algérien, avec ou sans 00 : on repasse en local.
    when d ~ '^00213[567][0-9]{8}$' then '0' || substring(d from 6)
    when d ~ '^213[567][0-9]{8}$'   then '0' || substring(d from 4)
    -- Mobile algérien amputé de son zéro initial.
    when d ~ '^[567][0-9]{8}$'      then '0' || d
    -- Reste international : `00…` ou chiffres nus → E.164.
    when d ~ '^00[1-9][0-9]{7,13}$' then '+' || substring(d from 3)
    when d ~ '^[1-9][0-9]{7,14}$'   then '+' || d
    -- Irrécupérable (trop court, vide…) : on laisse tel quel plutôt que de
    -- fabriquer un numéro faux. La contrainte applicative refusera la prochaine
    -- écriture.
    else raw
  end
  from digits;
$$;

update public.drivers
   set phone = public.__canonicalize_phone(phone)
 where phone is not null
   and phone <> public.__canonicalize_phone(phone);

update public.chauffeurs
   set phone = public.__canonicalize_phone(phone)
 where phone is not null
   and phone <> public.__canonicalize_phone(phone);

update public.customers
   set phone = public.__canonicalize_phone(phone)
 where phone is not null
   and phone <> public.__canonicalize_phone(phone);

update public.operator_wallets
   set phone = public.__canonicalize_phone(phone)
 where phone is not null
   and phone <> public.__canonicalize_phone(phone);

-- La fonction n'a plus de raison d'exister : la canonicalisation vit dans le
-- code applicatif, pas en base.
drop function public.__canonicalize_phone(text);

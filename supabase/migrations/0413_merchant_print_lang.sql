-- Langue d'impression des tickets commerçant.
-- Règle produit : un ticket s'imprime dans UNE seule langue (jamais FR et AR
-- mélangés — illisible en thermique). 'fr' par défaut pour tout le monde ;
-- 'ar' uniquement si le commerçant le choisit dans Paramètres → Impression.

alter table public.merchants
  add column if not exists print_lang text not null default 'fr'
  check (print_lang in ('fr', 'ar'));

comment on column public.merchants.print_lang is
  'Langue unique des tickets imprimés (fr par défaut, ar au choix du commerçant) — jamais bilingue.';

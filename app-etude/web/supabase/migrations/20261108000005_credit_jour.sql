-- Quota en crédit quotidien, calculé sur le coût réel de chaque appel (décision du 2026-11-08, option B).
-- Budget par défaut : 0,35 $ par utilisateur et par jour (350 000 micro-dollars, décision du 2026-11-08), remis à zéro à minuit, heure de Kinshasa.
-- Une relecture depuis le cache compte peu, une réponse compte plus, le mode approfondi (Sonnet) environ 20 fois plus.
-- L'ancien quota hebdomadaire en tokens (quota_semaine) n'est plus utilisé ; ses colonnes sont gardées (pas de suppression).

-- Coût de chaque appel, en micro-dollars (1 $ = 1 000 000). Calculé par la fonction serveur « chat ».
alter table public.ia_appels add column cout_microdollars bigint not null default 0 check (cout_microdollars >= 0);

-- Réglage général et exception par utilisateur.
alter table public.ia_config add column budget_jour_microdollars bigint not null default 350000 check (budget_jour_microdollars >= 0);
alter table public.ia_quotas alter column quota_semaine drop not null;
alter table public.ia_quotas add column budget_jour_microdollars bigint check (budget_jour_microdollars >= 0);

-- Coût d'un appel selon le modèle et les tokens. Prix en $ par million de tokens (entrée, sortie, cache lu, cache écrit),
-- les mêmes que dans la fonction serveur (supabase/functions/_shared/chat.ts, TARIFS).
create or replace function public.ia_cout(modele text, entree bigint, cache_ecrit bigint, cache_lu bigint, sortie bigint)
returns bigint language sql immutable set search_path = '' as $$
  with t as (
    select case
      when modele like 'claude-haiku-5-5%' and entree + cache_ecrit + cache_lu > 100000 then array[0.50, 2.50, 0.05, 0.625]
      when modele like 'claude-haiku-5-5%' then array[0.10, 0.50, 0.01, 0.125]
      when modele like 'claude-sonnet-5-5%' then array[2.00, 10.00, 0.20, 2.50]
      else array[5.00, 25.00, 0.50, 6.25]          -- autre modèle (repli en cas de refus) : tarif prudent
    end as p
  )
  select round(entree * p[1] + sortie * p[2] + cache_lu * p[3] + cache_ecrit * p[4])::bigint from t
$$;

-- Historique : coût des appels déjà enregistrés (pour le suivi des coûts).
update public.ia_appels
set cout_microdollars = public.ia_cout(modele, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens);

-- Début du jour en cours (00:00 à Kinshasa), en instant absolu.
create or replace function public.ia_debut_jour(t timestamptz default now()) returns timestamptz
language sql stable set search_path = '' as $$
  select (date_trunc('day', t at time zone 'Africa/Kinshasa')) at time zone 'Africa/Kinshasa'
$$;

-- Crédit utilisé et budget du jour (en micro-dollars), et heure de la remise à zéro. Même forme qu'avant :
-- la fonction serveur et ia_mon_quota() n'ont pas à changer.
create or replace function public.ia_quota(p_owner uuid)
returns table (utilise bigint, limite bigint, reinitialisation timestamptz)
language sql stable security definer set search_path = '' as $$
  select
    coalesce((select sum(a.cout_microdollars) from public.ia_appels a
              where a.owner = p_owner and a.created_at >= public.ia_debut_jour()), 0)::bigint,
    coalesce((select q.budget_jour_microdollars from public.ia_quotas q where q.owner = p_owner),
             (select c.budget_jour_microdollars from public.ia_config c))::bigint,
    public.ia_debut_jour() + interval '1 day'
$$;
revoke execute on function public.ia_quota(uuid) from public, anon, authenticated;
grant execute on function public.ia_quota(uuid) to service_role;

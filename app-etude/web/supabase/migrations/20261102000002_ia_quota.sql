-- Consommation de l'IA et quota hebdomadaire par testeur.
-- Quota : tokens consommés (entrée + cache écrit + cache lu + sortie), tous modèles confondus,
-- sur une semaine qui commence le lundi à 00:00, heure de Kinshasa.
-- Seule la fonction serveur (rôle service_role) écrit ici. Un testeur ne peut que lire sa propre consommation.

-- Réglage général (une seule ligne).
create table public.ia_config (
  id            boolean primary key default true check (id),
  quota_semaine bigint not null default 500000 check (quota_semaine >= 0)
);
insert into public.ia_config default values;

-- Exception pour un testeur précis (facultatif).
create table public.ia_quotas (
  owner         uuid primary key references auth.users (id) on delete cascade,
  quota_semaine bigint not null check (quota_semaine >= 0)
);

-- Un appel à Claude = une ligne (sert au quota et, plus tard, au suivi des coûts).
create table public.ia_appels (
  id                    bigint generated always as identity primary key,
  owner                 uuid not null references auth.users (id) on delete cascade,
  tache                 text not null check (tache in ('seance', 'transcription', 'plan', 'resume', 'autre')),
  modele                text not null,
  statut                text not null check (statut in ('ok', 'tronque', 'refus', 'interrompu', 'erreur')),
  input_tokens          integer not null default 0 check (input_tokens >= 0),
  cache_creation_tokens integer not null default 0 check (cache_creation_tokens >= 0),
  cache_read_tokens     integer not null default 0 check (cache_read_tokens >= 0),
  output_tokens         integer not null default 0 check (output_tokens >= 0),
  total_tokens          integer generated always as (input_tokens + cache_creation_tokens + cache_read_tokens + output_tokens) stored,
  created_at            timestamptz not null default now()
);
create index ia_appels_owner_date on public.ia_appels (owner, created_at);

-- Début de la semaine en cours (lundi 00:00 à Kinshasa), exprimé en instant absolu.
create or replace function public.ia_debut_semaine(t timestamptz default now()) returns timestamptz
language sql stable set search_path = '' as $$
  select (date_trunc('week', t at time zone 'Africa/Kinshasa')) at time zone 'Africa/Kinshasa'
$$;

-- Consommation et limite d'un testeur pour la semaine en cours.
create or replace function public.ia_quota(p_owner uuid)
returns table (utilise bigint, limite bigint, reinitialisation timestamptz)
language sql stable security definer set search_path = '' as $$
  select
    coalesce((select sum(a.total_tokens) from public.ia_appels a
              where a.owner = p_owner and a.created_at >= public.ia_debut_semaine()), 0)::bigint,
    coalesce((select q.quota_semaine from public.ia_quotas q where q.owner = p_owner),
             (select c.quota_semaine from public.ia_config c))::bigint,
    public.ia_debut_semaine() + interval '7 days'
$$;

-- Version pour le testeur connecté (affichage de son quota dans l'app).
create or replace function public.ia_mon_quota()
returns table (utilise bigint, limite bigint, reinitialisation timestamptz)
language sql stable security definer set search_path = '' as $$
  select * from public.ia_quota((select auth.uid())) where (select auth.uid()) is not null
$$;

-- Règles d'accès
alter table public.ia_config  enable row level security;
alter table public.ia_quotas  enable row level security;
alter table public.ia_appels  enable row level security;

create policy ia_appels_lecture on public.ia_appels for select to authenticated
  using (owner = (select auth.uid()));
create policy ia_quotas_lecture on public.ia_quotas for select to authenticated
  using (owner = (select auth.uid()));

revoke all on public.ia_config, public.ia_quotas, public.ia_appels from anon, authenticated;
grant select on public.ia_appels, public.ia_quotas to authenticated;
grant select, insert on public.ia_appels to service_role;
grant select on public.ia_config, public.ia_quotas to service_role;

revoke execute on function public.ia_quota(uuid) from public, anon, authenticated;
grant execute on function public.ia_quota(uuid) to service_role;
revoke execute on function public.ia_mon_quota() from public, anon;
grant execute on function public.ia_mon_quota() to authenticated;

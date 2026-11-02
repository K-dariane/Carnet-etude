-- Carnet d'étude : projets, supports et conversations (fils).
-- Noms de champs repris de la V1 (artifact) ; les colonnes composées passent en snake_case :
--   parentId → parent_id, nbSupports → nb_supports, assetId → asset_id,
--   createdAt → created_at, updatedAt → updated_at.
-- Règle d'accès : chaque utilisateur ne voit et ne modifie que ses lignes (owner = auth.uid()).

-- Identifiant par défaut au format de la V1 (20 caractères a-z0-9).
create or replace function public.carnet_id() returns text
language sql volatile as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', 1 + floor(random() * 36)::int, 1), '')
  from generate_series(1, 20)
$$;

create table public.projets (
  id          text primary key default public.carnet_id(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  titre       text not null check (char_length(titre) between 1 and 300),
  type        text not null default 'autre'
              check (type in ('etude', 'revision', 'exercices', 'devoir', 'quiz', 'examen', 'autre')),
  matiere     text not null default '' check (char_length(matiere) <= 300),
  objectif    text not null default '' check (char_length(objectif) <= 5000),
  echeance    date,
  parent_id   text,
  focus       text check (char_length(focus) <= 1000),
  nb_supports integer not null default 0 check (nb_supports >= 0),
  plan        jsonb not null default '[]' check (jsonb_typeof(plan) = 'array'),
  evolutions  jsonb not null default '[]' check (jsonb_typeof(evolutions) = 'array'),
  extra       jsonb not null default '{}' check (jsonb_typeof(extra) = 'object'),  -- champs inconnus de la V1, conservés
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner, id),
  -- Un sous-projet ne peut pointer que vers un projet du même utilisateur.
  -- Si le projet principal est supprimé, le sous-projet est gardé (comme dans la V1) et devient autonome.
  foreign key (owner, parent_id) references public.projets (owner, id) on delete set null (parent_id),
  check (parent_id is null or parent_id <> id)
);
create index projets_owner_updated on public.projets (owner, updated_at desc);
create index projets_parent on public.projets (owner, parent_id) where parent_id is not null;

create table public.supports (
  id         text primary key default public.carnet_id(),
  owner      uuid not null default auth.uid(),
  projet_id  text not null,
  nom        text not null default '' check (char_length(nom) <= 300),
  kind       text not null check (kind in ('pdf', 'image', 'note')),
  texte      text not null default '' check (char_length(texte) <= 200000),
  actif      boolean not null default true,
  url        text,
  asset_id   text,
  pages      integer,
  tronque    boolean,
  herite     boolean,
  extra      jsonb not null default '{}' check (jsonb_typeof(extra) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (owner, projet_id) references public.projets (owner, id) on delete cascade
);
create index supports_projet on public.supports (owner, projet_id);

create table public.fils (
  owner      uuid not null default auth.uid(),
  projet_id  text not null,
  id         text not null default 'principal',
  turns      jsonb not null default '[]'
             check (jsonb_typeof(turns) = 'array' and octet_length(turns::text) <= 1000000),
  updated_at timestamptz not null default now(),
  primary key (projet_id, id),
  foreign key (owner, projet_id) references public.projets (owner, id) on delete cascade
);

-- Règles d'accès
alter table public.projets  enable row level security;
alter table public.supports enable row level security;
alter table public.fils     enable row level security;

create policy projets_owner on public.projets for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy supports_owner on public.supports for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy fils_owner on public.fils for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

-- Les visiteurs non connectés n'ont aucun accès.
revoke all on public.projets, public.supports, public.fils from anon;
grant select, insert, update, delete on public.projets, public.supports, public.fils to authenticated;

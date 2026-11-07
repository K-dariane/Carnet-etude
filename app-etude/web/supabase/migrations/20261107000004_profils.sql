-- Profil de chaque utilisateur : prénom, niveau d'étude (guide le langage de Claude), âge et accord parental.
-- Rempli à la création du compte (ou à la première connexion par Google, Facebook, Apple).
create table public.profils (
  owner           uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  prenom          text not null default '' check (char_length(prenom) <= 80),
  niveau          text not null check (niveau in ('primaire', 'secondaire', 'universitaire')),
  majeur          boolean not null,
  accord_parental boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Un mineur ne peut utiliser l'app qu'avec l'accord d'un parent ou d'un tuteur.
  check (majeur or accord_parental)
);

alter table public.profils enable row level security;
create policy profils_owner on public.profils for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
revoke all on public.profils from anon;
grant select, insert, update on public.profils to authenticated;

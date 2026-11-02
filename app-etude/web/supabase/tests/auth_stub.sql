-- UNIQUEMENT POUR LES TESTS LOCAUX : imite le minimum de Supabase
-- (schéma auth, rôles anon/authenticated/service_role, auth.uid()).
-- Ne jamais exécuter sur le vrai projet Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text unique);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;

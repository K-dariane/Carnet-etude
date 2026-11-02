-- Fichiers des supports (photos, PDF) dans Supabase Storage.
-- Bucket privé « supports » ; chaque testeur a son dossier : <uid>/<…>.
-- Dans la base, `url` vaut « storage:supports/<chemin> » (l'app en fait un lien temporaire pour l'afficher)
-- et `asset_id` vaut « <chemin> » pour le support qui possède le fichier (comme dans la V1 :
-- les copies d'un sous-projet ont une url mais pas d'asset_id, et ne suppriment donc pas le fichier).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supports', 'supports', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy supports_fichiers_lecture on storage.objects for select to authenticated
  using (bucket_id = 'supports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy supports_fichiers_ajout on storage.objects for insert to authenticated
  with check (bucket_id = 'supports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy supports_fichiers_modif on storage.objects for update to authenticated
  using (bucket_id = 'supports' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'supports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy supports_fichiers_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'supports' and (storage.foldername(name))[1] = (select auth.uid())::text);

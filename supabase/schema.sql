-- Darwish Kitchen backup server (Supabase).
-- Run once in Supabase dashboard → SQL Editor. The app keeps all data on the phone;
-- this only stores a copy for backup/restore.

-- One backup row per user.
create table if not exists public.backups (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.backups enable row level security;

drop policy if exists "own backup select" on public.backups;
drop policy if exists "own backup insert" on public.backups;
drop policy if exists "own backup update" on public.backups;
drop policy if exists "own backup delete" on public.backups;
create policy "own backup select" on public.backups for select to authenticated using (auth.uid() = user_id);
create policy "own backup insert" on public.backups for insert to authenticated with check (auth.uid() = user_id);
create policy "own backup update" on public.backups for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own backup delete" on public.backups for delete to authenticated using (auth.uid() = user_id);

-- Private bucket for photos: <user id>/images/<file>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "own backup files select" on storage.objects;
drop policy if exists "own backup files insert" on storage.objects;
drop policy if exists "own backup files update" on storage.objects;
drop policy if exists "own backup files delete" on storage.objects;
create policy "own backup files select" on storage.objects for select to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own backup files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own backup files update" on storage.objects for update to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own backup files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);

-- Lets a signed-in user delete their own login (required by the App Store).
-- The app removes the user's photos and backup row first.
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

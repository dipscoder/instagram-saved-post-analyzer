-- Clear Library now lives in the web app, but every browser with the extension keeps a
-- local copy of the library. Without a signal, its next sync would think everything is
-- already uploaded and the cleared account would stay empty while the extension still
-- shows the old posts and still holds the old summaries.
--
-- `library_state.cleared_at` is that signal: clear_library() stamps it, and the extension
-- compares it with the last clear it acted on at the start of each sync. Safe to run again.

create table if not exists public.library_state (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  cleared_at timestamptz not null default now()
);

alter table public.library_state enable row level security;

-- Read-only to the user; only clear_library() writes it.
drop policy if exists "Users read their own library state" on public.library_state;
create policy "Users read their own library state" on public.library_state
  for select to authenticated using ((select auth.uid()) = user_id);

-- The first version returned void; a return type cannot be changed in place.
drop function if exists public.clear_library();
create function public.clear_library()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  stamp timestamptz := now();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  delete from public.verdicts where user_id = uid;
  delete from public.posts where user_id = uid;
  delete from public.collections where user_id = uid;
  insert into public.library_state (user_id, cleared_at) values (uid, stamp)
    on conflict (user_id) do update set cleared_at = excluded.cleared_at;
  return stamp;
end;
$$;

revoke all on function public.clear_library() from public, anon;
grant execute on function public.clear_library() to authenticated;

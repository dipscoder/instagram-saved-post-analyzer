-- Clear Library: the one deliberate exception to "nothing deletes from the ledger".
--
-- Verdicts still have no delete policy, so no ordinary request can remove a paid
-- summary. This function is the single way to, and only for the caller's own rows. The
-- extension calls it from its popup after a second, confirming press. Usage rows (what
-- was spent) are kept: erasing the library does not erase the bill.
create or replace function public.clear_library()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  delete from public.verdicts where user_id = uid;
  delete from public.posts where user_id = uid;
  delete from public.collections where user_id = uid;
end;
$$;

revoke all on function public.clear_library() from public, anon;
grant execute on function public.clear_library() to authenticated;

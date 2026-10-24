-- What each user's analysis has cost, per UTC day, so the `analyze` function can stop at
-- a daily cap. The function reads and adds to it with the caller's own session, so Row
-- Level Security applies: a user sees only their own usage and can only ever add to it.

create table public.usage (
  user_id  uuid          not null default auth.uid() references auth.users (id) on delete cascade,
  day      date          not null,
  usd      numeric(12,6) not null default 0 check (usd >= 0),
  posts    integer       not null default 0 check (posts >= 0),
  primary key (user_id, day)
);

comment on table public.usage is 'Analysis spend per user per UTC day, written only by record_usage().';

alter table public.usage enable row level security;

-- Readable by its owner. No insert, update or delete policy: writes go through
-- record_usage(), which can only add.
create policy "Users read their own usage" on public.usage
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.record_usage(p_usd numeric, p_posts integer) returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  total numeric;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if p_usd is null or p_usd < 0 or p_posts is null or p_posts < 0 then
    raise exception 'Usage can only grow.';
  end if;

  insert into public.usage (user_id, day, usd, posts)
  values (auth.uid(), (now() at time zone 'utc')::date, p_usd, p_posts)
  on conflict (user_id, day) do update
    set usd = public.usage.usd + excluded.usd,
        posts = public.usage.posts + excluded.posts
  returning usd into total;
  return total;
end;
$$;

revoke all on function public.record_usage(numeric, integer) from public, anon;
grant execute on function public.record_usage(numeric, integer) to authenticated;

-- Suggestions for posts the AI was not sure about.
--
-- A post the Decisions API could not place with confidence is still filed with no
-- category, so a wrong guess never hides it. What changes is that it keeps the categories
-- the AI found likeliest, best first, so "Needs a category" can offer them for one press
-- instead of asking the user to pick from the whole list. `sort` writes them as it files,
-- and with `suggest: true` for posts filed before this existed.
--
--   suggestions null   never asked
--   suggestions '{}'   asked, and nothing was likely enough to suggest
--
-- Safe to run again: every statement replaces or skips what is already there.

alter table public.posts
  add column if not exists suggestions text[]
    check (suggestions is null or cardinality(suggestions) <= 3);

comment on column public.posts.suggestions is
  'Categories the AI would suggest for a post it filed as not sure, best first. Null: never asked.';

-- Runs as the caller, so Row Level Security limits it to their own posts.
create or replace function public.set_suggestions(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written integer;
begin
  if jsonb_array_length(p_rows) > 25 then
    raise exception 'At most 25 posts at a time.';
  end if;
  update public.posts p set
    suggestions = (select coalesce(array_agg(left(u.s, 64) order by u.i), '{}')
                   from unnest(r.suggestions[1:3]) with ordinality as u (s, i))
  from jsonb_to_recordset(p_rows) as r (shortcode text, suggestions text[])
  where p.shortcode = r.shortcode and p.user_id = (select auth.uid());
  get diagnostics written = row_count;
  return written;
end;
$$;

revoke execute on function public.set_suggestions(jsonb) from public, anon;
grant execute on function public.set_suggestions(jsonb) to authenticated;

-- --- the web app counts posts not sure and never asked about ------------------------------

create or replace function public.library_facets()
returns table (kind text, key text, count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'total', '', count(*) from public.posts
  union all
  select 'unsorted', '', count(*) from public.posts where categorized_at is null and index_attempts < 3
  union all
  select 'failed', '', count(*) from public.posts where categorized_at is null and index_attempts >= 3
  union all
  select 'unembedded', '', count(*) from public.posts where categorized_at is not null and embedded_at is null
  union all
  select 'untranscribed', '', count(*) from public.posts
    where categorized_at is not null and embedded_at is not null
      and is_video and video_url is not null and transcribed_at is null and index_attempts < 3
  union all
  select 'unsure', '', count(*) from public.posts
    where categorized_at is not null and (category is null or category = 'Uncategorized')
  union all
  select 'unsuggested', '', count(*) from public.posts
    where categorized_at is not null and (category is null or category = 'Uncategorized')
      and suggestions is null and model_used is distinct from 'you'
  union all
  select 'category', category, count(*) from public.posts
    where category is not null and category <> 'Uncategorized' group by category
  union all
  select 'collection', c, count(*) from public.posts, unnest(collections) as c group by c;
$$;

-- Sidebar counts for the web app in one small query, instead of reading every row's
-- category and collections into the browser.
--
-- `security invoker` so Row Level Security applies exactly as for a direct select: the
-- function can only ever count the caller's own posts.

create function public.library_facets()
returns table (kind text, key text, count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'total', '', count(*) from public.posts
  union all
  select 'unsorted', '', count(*) from public.posts where category is null
  union all
  select 'unsure', '', count(*) from public.posts where category = 'Uncategorized'
  union all
  select 'category', category, count(*) from public.posts
    where category is not null and category <> 'Uncategorized' group by category
  union all
  select 'collection', c, count(*) from public.posts, unnest(collections) as c group by c;
$$;

revoke execute on function public.library_facets() from public, anon;
grant execute on function public.library_facets() to authenticated;

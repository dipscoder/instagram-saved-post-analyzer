-- Sorting on the server, so the web app can sort posts without the extension.
--
-- Two rules make that safe alongside the extension's own sync:
--
-- 1. A categorisation never goes backwards. The extension upserts its whole post row,
--    including its local category, which is still null for a post the server sorted
--    a moment ago. Without this guard that upsert would erase a verdict the user paid
--    for. An older or empty categorisation now leaves the newer one in place, on both
--    `posts` and `verdicts`.
-- 2. `apply_verdicts` writes a batch of server verdicts to both tables in one
--    transaction. It runs as the caller, so Row Level Security still limits it to the
--    caller's own rows.
--
-- Safe to run again: every statement replaces or skips what is already there.

create or replace function public.keep_newer_verdict() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.categorized_at is not null
     and (new.categorized_at is null or new.categorized_at < old.categorized_at) then
    new.category := old.category;
    new.subcategory := old.subcategory;
    new.tags := old.tags;
    new.summary := old.summary;
    new.categorized_at := old.categorized_at;
    new.model_used := old.model_used;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_keep_newer_verdict on public.posts;
create trigger posts_keep_newer_verdict
  before update on public.posts
  for each row execute function public.keep_newer_verdict();

create or replace function public.keep_newer_ledger_entry() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.categorized_at < old.categorized_at then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists verdicts_keep_newer on public.verdicts;
create trigger verdicts_keep_newer
  before update on public.verdicts
  for each row execute function public.keep_newer_ledger_entry();

-- Lets the extension ask for only the verdicts that changed since it last looked.
create index if not exists verdicts_user_updated on public.verdicts (user_id, updated_at);

create or replace function public.apply_verdicts(p_verdicts jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  applied integer;
begin
  if jsonb_array_length(p_verdicts) > 25 then
    raise exception 'At most 25 verdicts at a time.';
  end if;

  insert into public.verdicts (
    shortcode, category, subcategory, tags, summary, model_used, categorized_at,
    input_hash, taxonomy_hash, rules_hash, ledger_version
  )
  select v.shortcode, v.category, v.subcategory, coalesce(v.tags, '{}'), v.summary, v.model_used,
         v.categorized_at, v.input_hash, v.taxonomy_hash, v.rules_hash, v.ledger_version
  from jsonb_to_recordset(p_verdicts) as v (
    shortcode text, category text, subcategory text, tags text[], summary text, model_used text,
    categorized_at timestamptz, input_hash text, taxonomy_hash text, rules_hash text, ledger_version integer
  )
  on conflict (user_id, shortcode) do update set
    category = excluded.category,
    subcategory = excluded.subcategory,
    tags = excluded.tags,
    summary = excluded.summary,
    model_used = excluded.model_used,
    categorized_at = excluded.categorized_at,
    input_hash = excluded.input_hash,
    taxonomy_hash = excluded.taxonomy_hash,
    rules_hash = excluded.rules_hash,
    ledger_version = excluded.ledger_version;

  update public.posts p set
    category = v.category,
    subcategory = v.subcategory,
    tags = coalesce(v.tags, '{}'),
    summary = v.summary,
    model_used = v.model_used,
    categorized_at = v.categorized_at
  from jsonb_to_recordset(p_verdicts) as v (
    shortcode text, category text, subcategory text, tags text[], summary text, model_used text,
    categorized_at timestamptz
  )
  where p.shortcode = v.shortcode and p.user_id = (select auth.uid());
  get diagnostics applied = row_count;
  return applied;
end;
$$;

revoke execute on function public.apply_verdicts(jsonb) from public, anon;
grant execute on function public.apply_verdicts(jsonb) to authenticated;

-- "Not sorted yet" means never sorted, which is `categorized_at`, not `category`: a post
-- the model was unsure about is sorted with no category, and belongs with "not sure".
create or replace function public.library_facets()
returns table (kind text, key text, count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'total', '', count(*) from public.posts
  union all
  select 'unsorted', '', count(*) from public.posts where categorized_at is null
  union all
  select 'unsure', '', count(*) from public.posts
    where categorized_at is not null and (category is null or category = 'Uncategorized')
  union all
  select 'category', category, count(*) from public.posts
    where category is not null and category <> 'Uncategorized' group by category
  union all
  select 'collection', c, count(*) from public.posts, unnest(collections) as c group by c;
$$;

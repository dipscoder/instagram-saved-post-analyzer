-- A second category: "Also in".
--
-- A post has one category, but plenty are about two things: a funny reel about a dating
-- app is comedy and dating at once. Filed only under Humor & Misc, it never shows up when
-- you open Relationships & Dating. `also_category` is the runner-up the AI found likely
-- too, and the post appears under both: in the sidebar count, the category view and a
-- search inside that category. `sort` writes it with each verdict (see `apply_verdicts`).
--
-- It lives on posts only, not on the verdicts ledger: it is rewritten with every filing,
-- and the extension, which reads the ledger, has no use for it.
--
-- Safe to run again: every statement replaces or skips what is already there.

alter table public.posts
  add column if not exists also_category text
    check (also_category is null or char_length(also_category) <= 64);

comment on column public.posts.also_category is
  'A second category the AI found likely, so the post also appears there. Null: none.';

-- A category the user chose is the whole answer: the AI's second guess goes with the
-- AI's first. And a second category the same as the first is no second category.
-- Named to run after posts_keep_newer_verdict, which may put an older filing back.
create or replace function public.tidy_also_category() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.model_used = 'you' and old.model_used is distinct from 'you' then
    new.also_category := null;
  end if;
  if new.also_category is not distinct from new.category or new.category is null
     or new.category = 'Uncategorized' then
    new.also_category := null;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_tidy_also_category on public.posts;
create trigger posts_tidy_also_category
  before update on public.posts
  for each row execute function public.tidy_also_category();

-- --- written with each verdict ----------------------------------------------------------

-- As before, plus `also_category` on the post. A verdict without one clears it, so a post
-- filed again never keeps a second category from an earlier filing.
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
    also_category = left(v.also_category, 64),
    subcategory = v.subcategory,
    tags = coalesce(v.tags, '{}'),
    summary = v.summary,
    model_used = v.model_used,
    categorized_at = v.categorized_at
  from jsonb_to_recordset(p_verdicts) as v (
    shortcode text, category text, also_category text, subcategory text, tags text[], summary text,
    model_used text, categorized_at timestamptz
  )
  where p.shortcode = v.shortcode and p.user_id = (select auth.uid());
  get diagnostics applied = row_count;
  return applied;
end;
$$;

revoke execute on function public.apply_verdicts(jsonb) from public, anon;
grant execute on function public.apply_verdicts(jsonb) to authenticated;

-- --- searchable by its second category too ----------------------------------------------

create or replace function public.posts_search_doc() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_doc :=
    setweight(to_tsvector('english', concat_ws(' ', new.summary, new.category, new.also_category,
      new.subcategory, array_to_string(new.tags, ' '))), 'A') ||
    setweight(to_tsvector('english', concat_ws(' ', new.caption, array_to_string(new.hashtags, ' '),
      new.handle)), 'B') ||
    setweight(to_tsvector('english', concat_ws(' ', new.alt_text, new.audio_track_name,
      left(new.transcript, 4000))), 'C');
  return new;
end;
$$;

create or replace function public.reset_stale_embedding() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.embedded_at is not distinct from old.embedded_at
     and (new.summary is distinct from old.summary
       or new.category is distinct from old.category
       or new.also_category is distinct from old.also_category
       or new.subcategory is distinct from old.subcategory
       or new.tags is distinct from old.tags
       or new.caption is distinct from old.caption
       or new.alt_text is distinct from old.alt_text
       or new.transcript is distinct from old.transcript) then
    new.embedding := null;
    new.embedded_at := null;
  end if;
  return new;
end;
$$;

-- The result gains a column, so the function is replaced rather than altered.
drop function if exists public.search_posts(text, extensions.vector, text, text, boolean, integer);

create function public.search_posts(
  p_query text,
  p_embedding extensions.vector(512) default null,
  p_category text default null,
  p_collection text default null,
  p_needs_look boolean default false,
  p_limit integer default 100
)
returns table (
  shortcode text, permalink text, handle text, caption text, hashtags text[], thumbnail_url text,
  thumbnail_stored boolean, is_video boolean, thumbnail_format text, duration_sec real,
  audio_track_name text, category text, also_category text, subcategory text, tags text[],
  summary text, collections text[], saved_rank bigint, categorized_at timestamptz,
  model_used text, score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select p.* from public.posts p
    where (p_category is null or p.category = p_category or p.also_category = p_category)
      and (p_collection is null or p.collections @> array[p_collection])
      and (not p_needs_look or p.category is null or p.category = 'Uncategorized')
  ),
  q as (select websearch_to_tsquery('english', p_query) as tsq),
  keyword as (
    select b.shortcode, row_number() over (order by ts_rank_cd(b.search_doc, q.tsq, 32) desc) as rank
    from base b, q
    where b.search_doc @@ q.tsq
    order by rank
    limit 200
  ),
  meaning as (
    select b.shortcode,
           row_number() over (order by b.embedding operator(extensions.<=>) p_embedding) as rank
    from base b
    where p_embedding is not null
      and b.embedding is not null
      and b.embedding operator(extensions.<=>) p_embedding < 0.65
    order by rank
    limit 200
  ),
  fused as (
    select shortcode, sum(1.0 / (60 + rank)) as score
    from (select * from keyword union all select * from meaning) ranked
    group by shortcode
  )
  select b.shortcode, b.permalink, b.handle, b.caption, b.hashtags, b.thumbnail_url,
         b.thumbnail_stored, b.is_video, b.thumbnail_format, b.duration_sec,
         b.audio_track_name, b.category, b.also_category, b.subcategory, b.tags, b.summary,
         b.collections, b.saved_rank, b.categorized_at, b.model_used, f.score::double precision
  from fused f
  join base b using (shortcode)
  order by f.score desc, b.saved_rank desc nulls last
  limit least(greatest(p_limit, 1), 200);
$$;

revoke execute on function public.search_posts(text, extensions.vector, text, text, boolean, integer) from public, anon;
grant execute on function public.search_posts(text, extensions.vector, text, text, boolean, integer) to authenticated;

-- --- a post counts in both of its categories ---------------------------------------------

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
  select 'category', c, count(*) from public.posts, unnest(array[category, also_category]) as c
    where c is not null and c <> 'Uncategorized' group by c
  union all
  select 'collection', c, count(*) from public.posts, unnest(collections) as c group by c;
$$;

-- Existing posts get no second category until they are organised again; nothing here moves.

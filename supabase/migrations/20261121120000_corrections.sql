-- Fixing a wrong category from the web app.
--
-- `correct_category` files the post where the user says it belongs, as a verdict like any
-- other (model_used 'you', stamped now), so it wins over every older answer, the extension
-- picks it up on its next sync, and nothing ever re-files the post over it.
--
-- Each fix is also kept in `corrections` with a copy of the post's words, so the filing
-- eval can grow from real mistakes (Settings → Download corrections), even after the post
-- is unsaved.
--
-- Safe to run again: every statement replaces or skips what is already there.

create table if not exists public.corrections (
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  shortcode     text        not null check (shortcode ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- What it was filed as, and what the user says; null is Unknown.
  from_category text        check (char_length(from_category) <= 64),
  to_category   text        check (char_length(to_category) <= 64),
  handle        text        not null default '' check (char_length(handle) <= 200),
  caption       text        not null default '' check (char_length(caption) <= 5000),
  hashtags      text[]      not null default '{}' check (cardinality(hashtags) <= 100),
  corrected_at  timestamptz not null default now(),
  primary key (user_id, shortcode)
);

comment on table public.corrections is
  'Categories the user fixed by hand, with the post''s words: the filing eval''s real mistakes.';

alter table public.corrections enable row level security;

drop policy if exists "Users read their own corrections" on public.corrections;
create policy "Users read their own corrections" on public.corrections
  for select to authenticated using ((select auth.uid()) = user_id);
-- Written only through correct_category(), which runs as the caller.
drop policy if exists "Users write their own corrections" on public.corrections;
create policy "Users write their own corrections" on public.corrections
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users update their own corrections" on public.corrections;
create policy "Users update their own corrections" on public.corrections
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update on public.corrections to authenticated;

-- --- fixing a category -----------------------------------------------------------------

-- p_category is a category name, or null for Unknown. The summary and tags stay: they
-- describe the post, not its category. The subcategory goes, since it belonged to the old
-- category. Returns false when the post is not the caller's.
create or replace function public.correct_category(p_shortcode text, p_category text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  post public.posts%rowtype;
  stamp timestamptz := now();
begin
  if p_category is not null and (char_length(p_category) > 64 or p_category = 'Uncategorized') then
    raise exception 'Not a category.';
  end if;
  select * into post from public.posts where user_id = uid and shortcode = p_shortcode;
  if not found then
    return false;
  end if;

  insert into public.corrections (shortcode, from_category, to_category, handle, caption, hashtags)
  values (p_shortcode,
          nullif(post.category, 'Uncategorized'),
          p_category,
          coalesce(left(post.handle, 200), ''),
          coalesce(left(post.caption, 5000), ''),
          coalesce(post.hashtags[1:100], '{}'))
  on conflict (user_id, shortcode) do update set
    to_category = excluded.to_category,
    corrected_at = now();

  insert into public.verdicts (
    shortcode, category, subcategory, tags, summary, model_used, categorized_at,
    input_hash, taxonomy_hash, rules_hash, ledger_version
  )
  values (p_shortcode, p_category, null, coalesce(post.tags, '{}'), post.summary, 'you', stamp,
          'you', 'you', 'you', 2)
  on conflict (user_id, shortcode) do update set
    category = excluded.category,
    subcategory = null,
    model_used = 'you',
    categorized_at = excluded.categorized_at;

  update public.posts set
    category = p_category,
    subcategory = null,
    model_used = 'you',
    categorized_at = stamp
  where user_id = uid and shortcode = p_shortcode;
  return true;
end;
$$;

revoke execute on function public.correct_category(text, text) from public, anon;
grant execute on function public.correct_category(text, text) to authenticated;

-- --- Clear library erases corrections too ---------------------------------------------

create or replace function public.clear_library()
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
  delete from public.corrections where user_id = uid;
  delete from public.posts where user_id = uid;
  delete from public.collections where user_id = uid;
  insert into public.library_state (user_id, cleared_at) values (uid, stamp)
    on conflict (user_id) do update set cleared_at = excluded.cleared_at;
  return stamp;
end;
$$;

revoke all on function public.clear_library() from public, anon;
grant execute on function public.clear_library() to authenticated;

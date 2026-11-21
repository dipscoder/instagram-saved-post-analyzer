-- Indexing failures are recorded on the post, so a post that cannot be indexed is shown
-- with the reason, and is not sent (and billed) again on every run.
--
--   index_error      why the last attempt failed: nothing_to_read, no_answer,
--                    openai_error, transcribe_failed
--   index_attempts   failed attempts since the post last changed
--   index_failed_at  when the last attempt failed
--
-- After three failed attempts, Index leaves the post out until it changes (a new caption,
-- picture or transcript) or the user presses Try again. A post with nothing to read is
-- given up on at once: asking again would read the same nothing.
--
-- Safe to run again: every statement replaces or skips what is already there.

alter table public.posts
  add column if not exists index_error     text,
  add column if not exists index_attempts  smallint not null default 0,
  add column if not exists index_failed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_index_error_known') then
    alter table public.posts add constraint posts_index_error_known check (
      index_error in ('nothing_to_read', 'no_answer', 'openai_error', 'transcribe_failed'));
  end if;
end;
$$;

-- --- a failure is forgotten once the post is indexed, or has something new to read ------

create or replace function public.clear_index_failure() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.index_attempts > 0 and new.index_attempts is not distinct from old.index_attempts
     and ((new.categorized_at is not null and new.categorized_at is distinct from old.categorized_at)
       or new.caption is distinct from old.caption
       or new.alt_text is distinct from old.alt_text
       or new.transcript is distinct from old.transcript
       or (new.thumbnail_stored and not old.thumbnail_stored)) then
    new.index_error := null;
    new.index_attempts := 0;
    new.index_failed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_clear_index_failure on public.posts;
create trigger posts_clear_index_failure
  before update on public.posts
  for each row execute function public.clear_index_failure();

-- --- recording failures ---------------------------------------------------------------

-- Runs as the caller, so Row Level Security limits it to their own posts. `final` gives up
-- at once (three attempts), for a failure that asking again cannot change.
create or replace function public.record_index_failures(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written integer;
begin
  if jsonb_array_length(p_rows) > 25 then
    raise exception 'At most 25 failures at a time.';
  end if;
  update public.posts p set
    index_error = r.reason,
    index_attempts = case when coalesce(r.final, false) then greatest(p.index_attempts, 3)
                          else least(p.index_attempts + 1, 100) end,
    index_failed_at = now()
  from jsonb_to_recordset(p_rows) as r (shortcode text, reason text, final boolean)
  where p.shortcode = r.shortcode and p.user_id = (select auth.uid());
  get diagnostics written = row_count;
  return written;
end;
$$;

revoke execute on function public.record_index_failures(jsonb) from public, anon;
grant execute on function public.record_index_failures(jsonb) to authenticated;

-- Try again: the caller's given-up posts go back into the next Index run. Spends nothing
-- itself; the run is quoted and confirmed as usual.
create or replace function public.retry_index_failures()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written integer;
begin
  update public.posts set index_attempts = 0, index_error = null, index_failed_at = null
  where user_id = (select auth.uid()) and index_attempts >= 3;
  get diagnostics written = row_count;
  return written;
end;
$$;

revoke execute on function public.retry_index_failures() from public, anon;
grant execute on function public.retry_index_failures() to authenticated;

-- --- the Index bar leaves out what has been given up on, and counts it apart -------------

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
  select 'category', category, count(*) from public.posts
    where category is not null and category <> 'Uncategorized' group by category
  union all
  select 'collection', c, count(*) from public.posts, unnest(collections) as c group by c;
$$;

-- Analysis v2, part two: reels are filed and searched by what is said in them.
--
-- The extension now syncs each reel's smallest video rendition (`video_url`, a signed
-- Instagram CDN address that expires after a few days). The `sort` function downloads it,
-- transcribes it once with gpt-transcribe, and files the reel from its transcript.
--
--   transcribed_at null                  never tried
--   transcript '' , transcribed_at set   tried: nothing was said, or too long to pay for
--   transcript text, transcribed_at set  done
--   transcript null, transcribed_at set  the video could not be downloaded; tried again
--                                        when a sync brings a fresh address
--
-- Run this BEFORE loading the new extension build: its sync sends `video_url`.
-- Safe to run again: every statement replaces or skips what is already there.

alter table public.posts
  add column if not exists video_url      text,
  add column if not exists transcript     text,
  add column if not exists transcribed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_video_url_length') then
    alter table public.posts add constraint posts_video_url_length check (char_length(video_url) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_transcript_length') then
    alter table public.posts add constraint posts_transcript_length check (char_length(transcript) <= 20000);
  end if;
end;
$$;

comment on column public.posts.video_url is
  'The reel''s smallest rendition on Instagram''s CDN, from the extension. Signed and short-lived.';
comment on column public.posts.transcript is
  'What is said in the reel (gpt-transcribe). Empty when nothing was said; null when not transcribed.';

-- --- a failed download is retried when a fresh address arrives ---------------------------

create or replace function public.retry_transcript_on_new_url() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.video_url is distinct from old.video_url
     and new.video_url is not null
     and new.transcript is null
     and new.transcribed_at is not distinct from old.transcribed_at then
    new.transcribed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_retry_transcript on public.posts;
create trigger posts_retry_transcript
  before update on public.posts
  for each row execute function public.retry_transcript_on_new_url();

-- --- the transcript is searchable, and part of what is embedded ----------------------------

create or replace function public.posts_search_doc() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_doc :=
    setweight(to_tsvector('english', concat_ws(' ', new.summary, new.category, new.subcategory,
      array_to_string(new.tags, ' '))), 'A') ||
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

-- --- writing transcripts -----------------------------------------------------------------

-- Runs as the caller, so Row Level Security limits it to their own posts. A null
-- transcript records a failed download (see the table above).
create or replace function public.set_transcripts(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written integer;
begin
  if jsonb_array_length(p_rows) > 25 then
    raise exception 'At most 25 transcripts at a time.';
  end if;
  update public.posts p set
    transcript = r.transcript,
    transcribed_at = now()
  from jsonb_to_recordset(p_rows) as r (shortcode text, transcript text)
  where p.shortcode = r.shortcode and p.user_id = (select auth.uid());
  get diagnostics written = row_count;
  return written;
end;
$$;

revoke execute on function public.set_transcripts(jsonb) from public, anon;
grant execute on function public.set_transcripts(jsonb) to authenticated;

-- --- the Index bar counts reels still to transcribe ---------------------------------------

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
  select 'unembedded', '', count(*) from public.posts where categorized_at is not null and embedded_at is null
  union all
  select 'untranscribed', '', count(*) from public.posts
    where categorized_at is not null and embedded_at is not null
      and is_video and video_url is not null and transcribed_at is null
  union all
  select 'unsure', '', count(*) from public.posts
    where categorized_at is not null and (category is null or category = 'Uncategorized')
  union all
  select 'category', category, count(*) from public.posts
    where category is not null and category <> 'Uncategorized' group by category
  union all
  select 'collection', c, count(*) from public.posts, unnest(collections) as c group by c;
$$;

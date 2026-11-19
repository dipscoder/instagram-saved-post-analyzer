-- Sharper thumbnails: 800px WebP copies at {user_id}/{shortcode}.webp.
--
-- The first copies were 480px JPEGs made from Instagram's 150px candidate, so they looked
-- soft and could not be fixed by re-encoding. The extension now copies from a 640px
-- source as WebP, about 50 KB each, and replaces an old JPEG whenever a fresh URL for
-- that post turns up. `thumbnail_format` says which file a row's thumbnail is.

alter table public.posts
  add column thumbnail_format text check (thumbnail_format in ('jpg', 'webp'));

update public.posts set thumbnail_format = 'jpg' where thumbnail_stored;

comment on column public.posts.thumbnail_format is
  'Which stored file is the thumbnail: jpg (first 480px copies) or webp (800px). Null when none is stored.';

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/webp']
where id = 'thumbnails';

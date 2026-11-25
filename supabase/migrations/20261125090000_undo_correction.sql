-- Undo for "Change category".
--
-- Undo used to be a second correction back to the old category: it dropped the old
-- subcategory, stamped the post as filed by 'you', and kept a correction for a move the
-- user took back, so the eval learned from a non-mistake. `undo_correction` puts the
-- previous verdict back as it was and takes the correction away with it.
--
-- Safe to run again: every statement replaces or skips what is already there.

drop policy if exists "Users delete their own corrections" on public.corrections;
create policy "Users delete their own corrections" on public.corrections
  for delete to authenticated using ((select auth.uid()) = user_id);

grant delete on public.corrections to authenticated;

-- The p_ arguments are the post as it was before the move, which the web app still holds.
-- When it was already the user's own choice (p_model_used 'you'), that earlier fix stays a
-- correction, pointing where it pointed before; otherwise the correction goes.
-- Returns false when there is nothing to undo: the post is gone, or something has filed
-- it since the move.
create or replace function public.undo_correction(
  p_shortcode text,
  p_category text,
  p_subcategory text,
  p_model_used text
)
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
  if char_length(p_category) > 64 or char_length(p_subcategory) > 64
     or p_model_used is null or char_length(p_model_used) > 64 then
    raise exception 'Not a verdict.';
  end if;
  select * into post from public.posts where user_id = uid and shortcode = p_shortcode;
  if not found or post.model_used is distinct from 'you' then
    return false;
  end if;

  if p_model_used = 'you' then
    update public.corrections set to_category = nullif(p_category, 'Uncategorized'), corrected_at = stamp
      where user_id = uid and shortcode = p_shortcode;
  else
    delete from public.corrections where user_id = uid and shortcode = p_shortcode;
  end if;

  -- Stamped now, like any verdict, so it is newer than every copy the extension holds.
  update public.verdicts set
    category = p_category,
    subcategory = p_subcategory,
    model_used = p_model_used,
    categorized_at = stamp
  where user_id = uid and shortcode = p_shortcode;

  update public.posts set
    category = p_category,
    subcategory = p_subcategory,
    model_used = p_model_used,
    categorized_at = stamp
  where user_id = uid and shortcode = p_shortcode;
  return true;
end;
$$;

revoke execute on function public.undo_correction(text, text, text, text) from public, anon;
grant execute on function public.undo_correction(text, text, text, text) to authenticated;

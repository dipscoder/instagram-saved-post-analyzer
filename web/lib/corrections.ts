import { evalCases, type CorrectionRow } from '@saved-index/shared/corrections';
import { supabase } from './supabase';

/**
 * Files a post where the user says it belongs (null is Unknown). Free: no model runs. The
 * fix is a verdict like any other, newer than the model's, so it sticks.
 */
export async function correctCategory(shortcode: string, category: string | null): Promise<void> {
  const { data, error } = await supabase.rpc('correct_category', { p_shortcode: shortcode, p_category: category });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error('That post is no longer in your library.');
}

/** How a post was filed: what Undo puts back after a move. */
export type Filing = { category: string | null; also_category: string | null; subcategory: string | null; model_used: string | null };

/**
 * Takes a move back: the post is filed exactly as it was before, subcategory and all, and
 * the correction goes, since a move the user undid was not a mistake by the AI.
 */
export async function undoCorrection(shortcode: string, before: Filing): Promise<void> {
  const { data, error } = await supabase.rpc('undo_correction', {
    p_shortcode: shortcode,
    p_category: before.category,
    p_subcategory: before.subcategory,
    p_model_used: before.model_used ?? 'you',
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error('Couldn’t undo: the post has changed since.');
  // A move drops the AI's second category; putting the post back brings it back too.
  if (before.also_category) {
    await supabase.from('posts').update({ also_category: before.also_category }).eq('shortcode', shortcode);
  }
}

export async function countCorrections(): Promise<number> {
  const { count, error } = await supabase.from('corrections').select('shortcode', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Every fix, as a file of eval cases for `npm run eval -- --with <file>`. */
export async function downloadCorrections(): Promise<void> {
  const { data, error } = await supabase
    .from('corrections')
    .select('shortcode, from_category, to_category, handle, caption, hashtags')
    .order('corrected_at', { ascending: false })
    .returns<CorrectionRow[]>();
  if (error) throw new Error(error.message);
  const blob = new Blob([`${JSON.stringify(evalCases(data ?? []), null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'saved-index-corrections.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

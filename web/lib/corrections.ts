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

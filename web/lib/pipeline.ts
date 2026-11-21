import { embeddingText } from '@saved-index/shared/embedding';
import { needsPicture, signature, type FilingInput } from '@saved-index/shared/filing';
import { classifyByRules } from '@saved-index/shared/taxonomy';
import { supabase } from './supabase';

export { PIPELINE } from './pipeline-facts';

/** How many posts in the library sit at each stage. A count the database cannot answer yet is null. */
export interface PipelineStats {
  total: number;
  withPicture: number;
  byRules: number;
  byModel: number;
  byYou: number | null;
  unsure: number;
  notIndexed: number;
  searchable: number;
  reels: number;
  transcribed: number | null;
  failed: number | null;
  spentUsd: number;
}

type Filter = (q: ReturnType<typeof base>) => ReturnType<typeof base>;
const base = () => supabase.from('posts').select('shortcode', { count: 'exact', head: true });

/** One count, or null when the query fails (a column from a migration not yet run). */
async function count(filter: Filter = (q) => q): Promise<number | null> {
  const { count: n, error } = await filter(base());
  return error ? null : (n ?? 0);
}

export async function fetchPipelineStats(): Promise<PipelineStats> {
  const [total, withPicture, byRules, byYou, categorized, unsure, searchable, reels, transcribed, failed, usage] = await Promise.all([
    count(),
    count((q) => q.eq('thumbnail_stored', true)),
    count((q) => q.eq('model_used', 'rules')),
    count((q) => q.eq('model_used', 'you')),
    count((q) => q.not('categorized_at', 'is', null)),
    count((q) => q.not('categorized_at', 'is', null).or('category.is.null,category.eq.Uncategorized')),
    count((q) => q.not('embedded_at', 'is', null)),
    count((q) => q.eq('is_video', true)),
    count((q) => q.not('transcript', 'is', null).neq('transcript', '')),
    count((q) => q.is('categorized_at', null).gte('index_attempts', 3)),
    supabase.from('usage').select('usd'),
  ]);
  const n = (v: number | null) => v ?? 0;
  return {
    total: n(total),
    withPicture: n(withPicture),
    byRules: n(byRules),
    byModel: Math.max(0, n(categorized) - n(byRules) - n(byYou)),
    byYou,
    unsure: n(unsure),
    notIndexed: Math.max(0, n(total) - n(categorized)),
    searchable: n(searchable),
    reels: n(reels),
    transcribed,
    failed,
    spentUsd: ((usage.data ?? []) as { usd: number | string }[]).reduce((sum, r) => sum + Number(r.usd), 0),
  };
}

/** One of the user's own posts, taken apart the way the server sees it. */
export interface Walkthrough {
  shortcode: string;
  handle: string;
  /** Exactly what the model is sent for this post. */
  modelInput: string;
  /** Which way it was filed. */
  path: 'rules' | 'text' | 'picture' | 'you';
  ruleCategory: string | null;
  category: string | null;
  subcategory: string | null;
  summary: string | null;
  tags: string[];
  /** The text its search embedding is made from. */
  embedded: string;
  isEmbedded: boolean;
}

interface ExampleRow {
  shortcode: string;
  handle: string;
  caption: string;
  hashtags: string[];
  alt_text: string | null;
  is_video: boolean;
  duration_sec: number | null;
  audio_track_name: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string[] | null;
  summary: string | null;
  model_used: string | null;
  embedded_at: string | null;
}

/** The most recently saved post the model filed, or failing that any indexed post. */
export async function fetchWalkthrough(): Promise<Walkthrough | null> {
  // Typed as a plain string: the client's column-string parser gives up on a list this long.
  const columns: string =
    'shortcode, handle, caption, hashtags, alt_text, is_video, duration_sec, audio_track_name, category, subcategory, tags, summary, model_used, embedded_at';
  const pick = (modelOnly: boolean) =>
    supabase
      .from('posts')
      .select(columns)
      .not('categorized_at', 'is', null)
      .neq('category', 'Uncategorized')
      .not('model_used', 'in', modelOnly ? '(rules,you,skipped)' : '(skipped)')
      .order('saved_rank', { ascending: false, nullsFirst: false })
      .limit(1)
      .returns<ExampleRow[]>();
  const first = await pick(true);
  const row = first.data?.[0] ?? (await pick(false)).data?.[0];
  return row ? walkthrough(row) : null;
}

export function walkthrough(row: ExampleRow): Walkthrough {
  const input: FilingInput = {
    handle: row.handle ?? '',
    caption: row.caption ?? '',
    hashtags: row.hashtags ?? [],
    altText: row.alt_text,
    isVideo: row.is_video,
    durationSec: row.duration_sec,
    audioTrackName: row.audio_track_name,
  };
  const rule = classifyByRules(input);
  const path = row.model_used === 'you' ? 'you' : row.model_used === 'rules' ? 'rules' : needsPicture(input) ? 'picture' : 'text';
  return {
    shortcode: row.shortcode,
    handle: row.handle,
    modelInput: signature(input),
    path,
    ruleCategory: rule?.category ?? null,
    category: row.category,
    subcategory: row.subcategory,
    summary: row.summary,
    tags: row.tags ?? [],
    embedded: embeddingText({ ...row, hashtags: row.hashtags, tags: row.tags }),
    isEmbedded: row.embedded_at !== null,
  };
}

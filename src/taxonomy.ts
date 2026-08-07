/**
 * Fixed taxonomy + the deterministic pre-pass.
 *
 * Tier 1 of categorisation: free, instant, and good enough for the posts that carry
 * obvious hashtags. Anything ambiguous deliberately falls through to the LLM rather
 * than being guessed at — a wrong free answer is worse than a right cheap one.
 */

export const UNCATEGORIZED = 'Uncategorized';

export interface CategoryDef {
  name: string;
  subcategories: string[];
  /** Matched exactly (case-insensitive) against a post's hashtags. */
  hashtags: string[];
  /** Matched as whole words against caption + handle. */
  keywords: string[];
}

export const TAXONOMY: CategoryDef[] = [
  {
    name: 'Food & Recipes',
    subcategories: ['Recipe', 'Restaurant', 'Baking', 'Drinks', 'Meal prep'],
    hashtags: ['recipe', 'recipes', 'food', 'foodie', 'cooking', 'baking', 'homecooking', 'easyrecipes', 'mealprep', 'vegan', 'dessert', 'pasta', 'coffee', 'cocktails'],
    keywords: ['recipe', 'ingredients', 'tbsp', 'tsp', 'preheat', 'bake', 'sauté', 'marinate', 'dough', 'roast', 'simmer', 'serves', 'delicious', 'restaurant', 'brunch'],
  },
  {
    name: 'Design',
    subcategories: ['UI/UX', 'Graphic', 'Typography', 'Branding', 'Product'],
    hashtags: ['design', 'ui', 'ux', 'uidesign', 'uxdesign', 'graphicdesign', 'typography', 'branding', 'logo', 'productdesign', 'webdesign', 'figma'],
    keywords: ['typography', 'kerning', 'wireframe', 'grid system', 'design system', 'figma', 'branding', 'palette', 'layout', 'typeface', 'whitespace', 'mockup'],
  },
  {
    name: 'Travel',
    subcategories: ['Destination', 'Itinerary', 'Tips', 'Accommodation', 'Food travel'],
    hashtags: ['travel', 'travelgram', 'wanderlust', 'traveltips', 'backpacking', 'roadtrip', 'itinerary', 'hiking', 'vacation', 'explore', 'adventure'],
    keywords: ['itinerary', 'flight', 'hostel', 'visa', 'backpack', 'destination', 'road trip', 'day trip', 'things to do in', 'where to stay', 'travel guide'],
  },
  {
    name: 'Fitness & Health',
    subcategories: ['Strength', 'Cardio', 'Mobility', 'Nutrition', 'Mental health'],
    hashtags: ['fitness', 'workout', 'gym', 'training', 'mobility', 'yoga', 'running', 'strength', 'health', 'wellness', 'nutrition', 'homeworkout'],
    keywords: ['reps', 'sets', 'workout', 'squat', 'deadlift', 'mobility', 'stretch', 'cardio', 'zone 2', 'macros', 'protein', 'recovery', 'warm up'],
  },
  {
    name: 'Books & Reading',
    subcategories: ['Fiction', 'Non-fiction', 'Book list', 'Notes', 'Quotes'],
    hashtags: ['books', 'bookstagram', 'reading', 'booklist', 'bookrecommendations', 'currentlyreading', 'booktok', 'literature', 'nonfiction'],
    keywords: ['book', 'novel', 'author', 'chapter', 'reading list', 'must read', 'bookshelf', 'paperback', 'memoir'],
  },
  {
    name: 'Tools & Software',
    subcategories: ['App', 'Developer tool', 'AI', 'Productivity', 'Automation'],
    hashtags: ['tools', 'software', 'app', 'saas', 'productivity', 'ai', 'coding', 'developer', 'automation', 'notion', 'opensource', 'webdev'],
    keywords: ['open source', 'github', 'free tool', 'plugin', 'extension', 'workflow', 'automate', 'api', 'self-hosted', 'shortcut', 'app that'],
  },
  {
    name: 'Finance & Investing',
    subcategories: ['Investing', 'Budgeting', 'Tax', 'Markets', 'Personal finance'],
    hashtags: ['finance', 'investing', 'personalfinance', 'money', 'stocks', 'budgeting', 'savings', 'crypto', 'financialfreedom', 'wealth'],
    keywords: ['invest', 'portfolio', 'index fund', 'compound', 'budget', 'savings', 'tax', 'interest rate', 'net worth', 'expense ratio'],
  },
  {
    name: 'Career & Business',
    subcategories: ['Job search', 'Leadership', 'Startup', 'Marketing', 'Freelance'],
    hashtags: ['career', 'business', 'startup', 'entrepreneur', 'marketing', 'leadership', 'jobsearch', 'resume', 'freelance', 'founder', 'sales'],
    keywords: ['resume', 'interview', 'hiring', 'promotion', 'founder', 'startup', 'pitch deck', 'clients', 'freelance', 'negotiate', 'manager'],
  },
  {
    name: 'Home & DIY',
    subcategories: ['Interior', 'Organisation', 'Repair', 'Garden', 'Renovation'],
    hashtags: ['home', 'diy', 'interiordesign', 'homedecor', 'organization', 'renovation', 'gardening', 'woodworking', 'homeimprovement'],
    keywords: ['diy', 'renovation', 'declutter', 'storage', 'shelf', 'paint', 'drill', 'garden', 'plant care', 'apartment', 'living room'],
  },
  {
    name: 'Fashion & Beauty',
    subcategories: ['Outfit', 'Skincare', 'Hair', 'Shopping', 'Grooming'],
    hashtags: ['fashion', 'ootd', 'style', 'outfit', 'skincare', 'beauty', 'makeup', 'haircare', 'streetwear', 'grooming'],
    keywords: ['outfit', 'wardrobe', 'skincare', 'moisturizer', 'serum', 'styling', 'thrift', 'capsule wardrobe', 'fit check'],
  },
  {
    name: 'Art & Photography',
    subcategories: ['Photography', 'Illustration', 'Film', 'Editing', 'Music'],
    hashtags: ['art', 'photography', 'illustration', 'drawing', 'painting', 'photooftheday', 'filmphotography', 'lightroom', 'music', 'cinematography'],
    keywords: ['shutter', 'aperture', 'lightroom', 'lens', 'illustration', 'sketch', 'canvas', 'color grade', 'film stock', 'composition'],
  },
  {
    name: 'Humor & Misc',
    subcategories: ['Meme', 'Comedy', 'Animals', 'Trivia', 'Other'],
    hashtags: ['meme', 'memes', 'funny', 'comedy', 'lol', 'relatable', 'humor', 'cats', 'dogs', 'shitpost'],
    keywords: ['meme', 'lmao', 'lol', 'nobody:', 'me when', 'pov:', 'i cant', 'this is why'],
  },
];

export const CATEGORY_NAMES: string[] = TAXONOMY.map((c) => c.name);

const HASHTAG_WEIGHT = 3;
const KEYWORD_WEIGHT = 1;
/** Below this the signal is too thin to trust — send it to the model instead. */
const MIN_SCORE = 3;
/** A near-tie means the post genuinely straddles two categories. Ditto. */
const MIN_MARGIN = 2;

export interface RuleMatch {
  category: string;
  subcategory: string | null;
  score: number;
}

/**
 * Score a post against the taxonomy. Returns null when no category wins clearly —
 * the caller is expected to fall through to the LLM tier.
 */
export function classifyByRules(post: {
  caption: string;
  hashtags: string[];
  handle: string;
}): RuleMatch | null {
  const tags = new Set(post.hashtags.map((t) => t.toLowerCase().replace(/^#/, '')));
  const haystack = ` ${post.caption} ${post.handle} `.toLowerCase();

  const scored = TAXONOMY.map((cat) => {
    let score = 0;
    for (const h of cat.hashtags) if (tags.has(h)) score += HASHTAG_WEIGHT;
    for (const k of cat.keywords) if (includesWord(haystack, k)) score += KEYWORD_WEIGHT;
    return { category: cat.name, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score < MIN_SCORE) return null;
  if (runnerUp && best.score - runnerUp.score < MIN_MARGIN) return null;

  return { category: best.category, subcategory: null, score: best.score };
}

/**
 * Word-boundary-ish containment. `haystack` is pre-padded with spaces so a keyword at
 * either end still matches. Guards against "art" hitting "start" or "cardio".
 */
function includesWord(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = haystack[at - 1] ?? ' ';
    const after = haystack[at + needle.length] ?? ' ';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

/** Coerce a model's free-text answer onto the fixed taxonomy. */
export function normalizeCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const needle = raw.trim().toLowerCase();
  const exact = CATEGORY_NAMES.find((c) => c.toLowerCase() === needle);
  if (exact) return exact;
  // Models often return one half of an ampersand pair ("Food", "Fitness").
  const partial = CATEGORY_NAMES.find((c) =>
    c.toLowerCase().split(' & ').some((half) => half === needle),
  );
  return partial ?? null;
}

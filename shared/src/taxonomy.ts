/**
 * Fixed taxonomy + the deterministic pre-pass.
 *
 * Tier 1 of categorisation: free, instant, and good enough for the posts that carry
 * obvious hashtags. Anything ambiguous deliberately falls through to the LLM rather
 * than being guessed at — a wrong free answer is worse than a right cheap one.
 */

import { hashText } from './hash';

export const UNCATEGORIZED = 'Uncategorized';

export interface CategoryDef {
  name: string;
  /**
   * What belongs here, as the model is told it: the subject, examples, and where the edge
   * with a neighbouring category runs. A list of subcategories alone left the model unsure
   * whether a perfume or a watch was Fashion, so it filed neither.
   */
  description: string;
  subcategories: string[];
  /** Matched exactly (case-insensitive) against a post's hashtags. */
  hashtags: string[];
  /** Matched as whole words against the caption. */
  keywords: string[];
}

export const TAXONOMY: CategoryDef[] = [
  {
    name: 'Food & Recipes',
    description: 'Recipes, cooking, baking and drinks, and places to eat or drink: restaurants, cafes and street food, even in a city guide.',
    subcategories: ['Recipe', 'Restaurant', 'Baking', 'Drinks', 'Meal prep'],
    hashtags: ['recipe', 'recipes', 'food', 'foodie', 'cooking', 'baking', 'homecooking', 'easyrecipes', 'mealprep', 'vegan', 'dessert', 'pasta', 'coffee', 'cocktails'],
    keywords: ['recipe', 'ingredients', 'tbsp', 'tsp', 'preheat', 'bake', 'sauté', 'marinate', 'dough', 'roast', 'simmer', 'serves', 'delicious', 'restaurant', 'brunch'],
  },
  {
    name: 'Design',
    description: 'UI/UX, graphic design, typography, branding, and product or industrial design.',
    subcategories: ['UI/UX', 'Graphic', 'Typography', 'Branding', 'Product'],
    hashtags: ['design', 'ui', 'ux', 'uidesign', 'uxdesign', 'graphicdesign', 'typography', 'branding', 'logo', 'productdesign', 'webdesign', 'figma'],
    keywords: ['typography', 'kerning', 'wireframe', 'grid system', 'design system', 'figma', 'branding', 'palette', 'layout', 'typeface', 'whitespace', 'mockup'],
  },
  {
    name: 'Travel',
    description: 'Trips and destinations: where to go, itineraries, stays, packing, sights, festivals and scenic or offbeat places worth a trip.',
    subcategories: ['Destination', 'Itinerary', 'Tips', 'Accommodation', 'Food travel'],
    hashtags: ['travel', 'travelgram', 'wanderlust', 'traveltips', 'backpacking', 'roadtrip', 'itinerary', 'hiking', 'vacation', 'explore', 'adventure'],
    keywords: ['itinerary', 'flight', 'hostel', 'visa', 'backpack', 'destination', 'road trip', 'day trip', 'things to do in', 'where to stay', 'travel guide'],
  },
  {
    name: 'Fitness & Health',
    description: 'Exercise, workout plans, gym progress, sport you play, nutrition, sleep, medical health and mental health. Not skincare or cosmetics, which are Fashion & Beauty.',
    subcategories: ['Strength', 'Cardio', 'Mobility', 'Nutrition', 'Mental health'],
    hashtags: ['fitness', 'workout', 'gym', 'training', 'mobility', 'yoga', 'running', 'strength', 'health', 'wellness', 'nutrition', 'homeworkout'],
    keywords: ['reps', 'sets', 'workout', 'squat', 'deadlift', 'mobility', 'stretch', 'cardio', 'zone 2', 'macros', 'protein', 'recovery', 'warm up'],
  },
  {
    name: 'Books & Reading',
    description: 'Books, book lists, reading notes, authors and quotes from books.',
    subcategories: ['Fiction', 'Non-fiction', 'Book list', 'Notes', 'Quotes'],
    hashtags: ['books', 'bookstagram', 'reading', 'booklist', 'bookrecommendations', 'currentlyreading', 'booktok', 'literature', 'nonfiction'],
    keywords: ['book', 'novel', 'author', 'chapter', 'reading list', 'must read', 'bookshelf', 'paperback', 'memoir'],
  },
  {
    name: 'Tools & Software',
    description: 'Apps, websites, AI tools and prompts, coding and developer tools, gadgets and productivity systems.',
    subcategories: ['App', 'Developer tool', 'AI', 'Productivity', 'Automation'],
    hashtags: ['tools', 'software', 'app', 'saas', 'productivity', 'ai', 'coding', 'developer', 'automation', 'notion', 'opensource', 'webdev'],
    keywords: ['open source', 'github', 'free tool', 'plugin', 'extension', 'workflow', 'automate', 'api', 'self-hosted', 'shortcut', 'app that'],
  },
  {
    name: 'Finance & Investing',
    description: 'Money itself: investing, mutual funds, stocks, budgeting, tax, saving and personal finance. Not life advice that only mentions money.',
    subcategories: ['Investing', 'Budgeting', 'Tax', 'Markets', 'Personal finance'],
    hashtags: ['finance', 'investing', 'personalfinance', 'money', 'stocks', 'budgeting', 'savings', 'crypto', 'financialfreedom', 'wealth'],
    keywords: ['invest', 'portfolio', 'index fund', 'compound', 'budget', 'savings', 'tax', 'interest rate', 'net worth', 'expense ratio'],
  },
  {
    name: 'Career & Business',
    description: 'Jobs, the workplace, careers, startups, marketing, sales, side hustles and freelancing.',
    subcategories: ['Job search', 'Leadership', 'Startup', 'Marketing', 'Freelance'],
    hashtags: ['career', 'business', 'startup', 'entrepreneur', 'marketing', 'leadership', 'jobsearch', 'resume', 'freelance', 'founder', 'sales'],
    keywords: ['resume', 'interview', 'hiring', 'promotion', 'founder', 'startup', 'pitch deck', 'clients', 'freelance', 'negotiate', 'manager'],
  },
  {
    name: 'Home & DIY',
    description: 'Interiors, furniture, home and desk setups, organising, cleaning, repairs, gardening and home finds.',
    subcategories: ['Interior', 'Organisation', 'Repair', 'Garden', 'Renovation'],
    hashtags: ['home', 'diy', 'interiordesign', 'homedecor', 'organization', 'renovation', 'gardening', 'woodworking', 'homeimprovement'],
    keywords: ['diy', 'renovation', 'declutter', 'storage', 'shelf', 'paint', 'drill', 'garden', 'plant care', 'apartment', 'living room'],
  },
  {
    name: 'Fashion & Beauty',
    description: 'Clothes, outfits, shoes, watches, jewellery, perfume, skincare, makeup, hair and grooming, and shopping for them.',
    subcategories: ['Outfit', 'Skincare', 'Hair', 'Shopping', 'Grooming'],
    hashtags: ['fashion', 'ootd', 'style', 'outfit', 'skincare', 'beauty', 'makeup', 'haircare', 'streetwear', 'grooming'],
    keywords: ['outfit', 'wardrobe', 'skincare', 'moisturizer', 'serum', 'styling', 'thrift', 'capsule wardrobe', 'fit check'],
  },
  {
    name: 'Art & Photography',
    description: 'Making art: photography, illustration, painting, crafts such as origami, editing and visual technique.',
    subcategories: ['Photography', 'Illustration', 'Painting', 'Crafts', 'Editing'],
    hashtags: ['art', 'photography', 'illustration', 'drawing', 'painting', 'photooftheday', 'filmphotography', 'lightroom', 'origami', 'cinematography'],
    keywords: ['shutter', 'aperture', 'lightroom', 'lens', 'illustration', 'sketch', 'canvas', 'color grade', 'film stock', 'composition'],
  },
  {
    name: 'Relationships & Dating',
    description: 'Dating advice, dating apps and texting, approaching people, love, breakups and marriage, and friendship and family relationships.',
    subcategories: ['Dating advice', 'Dating apps', 'Love & breakups', 'Friendship', 'Family'],
    hashtags: ['dating', 'datingadvice', 'datingtips', 'relationships', 'relationshiptips', 'relationshipadvice', 'couplegoals', 'love', 'breakup', 'hinge'],
    keywords: ['dating', 'first date', 'hinge', 'tinder', 'bumble', 'girlfriend', 'boyfriend', 'situationship', 'breakup', 'crush', 'talking stage'],
  },
  {
    name: 'Places & Events',
    description: 'Things to do where you live: local spots, events, meetups, clubs, workshops, talks, nightlife and new venues that are not mainly for food.',
    subcategories: ['Places to go', 'Events', 'Meetups & clubs', 'Nightlife', 'Workshops'],
    hashtags: ['events', 'meetup', 'runclub', 'thingstodo', 'nightlife', 'weekendplans', 'workshop', 'popup', 'openmic', 'gig'],
    keywords: ['meetup', 'tickets', 'rsvp', 'venue', 'workshop', 'run club', 'this weekend', 'open mic', 'register now', 'happening'],
  },
  {
    name: 'Entertainment',
    description: 'Films, series and documentaries, music and songs, celebrities, games, and sport to watch.',
    subcategories: ['Film & TV', 'Documentary', 'Music', 'Games', 'Celebrities'],
    hashtags: ['movie', 'movies', 'film', 'cinema', 'bollywood', 'netflix', 'documentary', 'music', 'song', 'concert', 'anime', 'gaming'],
    keywords: ['trailer', 'episode', 'season finale', 'box office', 'soundtrack', 'album', 'watchlist', 'must watch', 'director', 'streaming'],
  },
  {
    name: 'Mindset & Self',
    description: 'Personal growth: motivation, life lessons, habits, confidence, reflection and poetry, and spirituality, astrology and manifestation.',
    subcategories: ['Motivation', 'Life lessons', 'Habits', 'Spirituality', 'Astrology'],
    hashtags: ['motivation', 'mindset', 'selfimprovement', 'selfgrowth', 'selflove', 'spirituality', 'astrology', 'manifestation', 'affirmations', 'poetry'],
    keywords: ['mindset', 'discipline', 'manifest', 'affirmation', 'horoscope', 'zodiac', 'kundli', 'self-worth', 'gratitude', 'life lessons'],
  },
  {
    name: 'Learning & Science',
    description: 'Explainers and how things work: science, history, economics, language and general knowledge.',
    subcategories: ['Science', 'History', 'Economics', 'Language', 'Explainers'],
    hashtags: ['science', 'physics', 'history', 'economics', 'education', 'learning', 'facts', 'didyouknow', 'space', 'biology', 'stem'],
    keywords: ['explained', 'theory', 'scientists', 'research shows', 'did you know', 'history of', 'physics', 'experiment', 'economists'],
  },
  {
    name: 'Humor & Misc',
    description: 'Memes, comedy sketches, funny animals and relatable jokes. Only when being funny is the point: a funny post about a clear topic belongs to that topic.',
    subcategories: ['Meme', 'Comedy', 'Animals', 'Relatable'],
    hashtags: ['meme', 'memes', 'funny', 'comedy', 'lol', 'relatable', 'humor', 'cats', 'dogs', 'shitpost'],
    keywords: ['meme', 'lmao', 'lol', 'nobody:', 'me when', 'pov:', 'i cant', 'this is why'],
  },
];

export const CATEGORY_NAMES: string[] = TAXONOMY.map((c) => c.name);

/**
 * The taxonomy exactly as the model is shown it. Built here rather than in the
 * categoriser so that the definitions and the text describing them cannot drift apart.
 */
export const TAXONOMY_PROMPT_BLOCK: string = TAXONOMY.map(
  (c) => `  ${c.name}: ${c.description}\n    Subcategories: ${c.subcategories.join(', ')}`,
).join('\n');

/**
 * Identifies the vocabulary a stored verdict was filed against.
 *
 * Derived from the definitions at module load, never typed by hand. A hand-maintained
 * generation counter is worse than no counter at all: the one time somebody forgets to
 * bump it, every stored verdict claims to be current while pointing at a category that no
 * longer exists, and the staleness check reports confidently wrong answers. Deriving it
 * means an edit to the taxonomy invalidates exactly the verdicts that edit could have
 * changed, with nothing to remember. `npm run verify` asserts the committed value, so a
 * change that would re-bill a user's whole library shows up in the diff rather than in
 * their next invoice.
 *
 * Hashed over the whole definitions rather than the prompt block, because the rule tier
 * files posts using `hashtags` and `keywords` — neither of which appears in the prompt.
 * Hashing only the prompt meant adding a keyword changed how new posts were classified
 * while every existing verdict still claimed to be current, so the re-index whose entire
 * purpose is to apply that change would have skipped the posts it applied to.
 */
export const TAXONOMY_HASH: string = hashText(JSON.stringify(TAXONOMY));

const RULES_SPEC = {
  hashtagWeight: 3,
  keywordWeight: 1,
  // One broad hashtag such as #style or #explore is not enough evidence on its own.
  minScore: 4,
  minMargin: 2,
  fields: ['caption', 'hashtags'],
} as const;

/** Invalidates free rule verdicts without throwing away still-valid paid model work. */
export const RULES_HASH: string = hashText(
  JSON.stringify({ taxonomy: TAXONOMY, rules: RULES_SPEC }),
);

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
  // The creator name is identity, not subject matter. Including it let @dailyrecipes
  // file an unrelated travel post as Food before the model ever saw it.
  const haystack = ` ${post.caption} `.toLowerCase();

  const scored = TAXONOMY.map((cat) => {
    let score = 0;
    for (const h of cat.hashtags) if (tags.has(h)) score += RULES_SPEC.hashtagWeight;
    for (const k of cat.keywords) if (includesWord(haystack, k)) score += RULES_SPEC.keywordWeight;
    return { category: cat.name, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score < RULES_SPEC.minScore) return null;
  if (runnerUp && best.score - runnerUp.score < RULES_SPEC.minMargin) return null;

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

/**
 * Coerce the model's subcategory onto the chosen category's own list.
 *
 * Naming the subcategories in the prompt is a request, not a constraint — and without
 * this, "Recipe", "recipes" and "cooking tutorial" all landed in the database as distinct
 * values, which is the exact failure the closed vocabulary was introduced to prevent.
 */
export function normalizeSubcategory(category: string | null, raw: unknown): string | null {
  if (!category || typeof raw !== 'string') return null;
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;
  const def = TAXONOMY.find((c) => c.name === category);
  return def?.subcategories.find((s) => s.toLowerCase() === needle) ?? null;
}

/** Coerce a model's free-text answer onto the fixed taxonomy. */
export function normalizeCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Models write "Food and Recipes" about as often as "Food & Recipes". Returning null
  // for the first spelling threw away an answer that had already been paid for — and now
  // that verdicts are banked, that discard would have been permanent.
  const needle = raw.trim().toLowerCase().replace(/\s+and\s+/g, ' & ');
  const exact = CATEGORY_NAMES.find((c) => c.toLowerCase() === needle);
  if (exact) return exact;
  // Models often return one half of an ampersand pair ("Food", "Fitness").
  const partial = CATEGORY_NAMES.find((c) =>
    c.toLowerCase().split(' & ').some((half) => half === needle),
  );
  return partial ?? null;
}

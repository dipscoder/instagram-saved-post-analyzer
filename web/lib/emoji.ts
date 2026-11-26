import { UNCATEGORIZED } from '@saved-index/shared/taxonomy';

/**
 * One emoji per category, so a category reads at a glance in the sidebar, on a card and in
 * the panel. Chosen to say what the category holds to anyone: no faces with a gender or a
 * skin tone, nothing that reads as for one crowd. Kept out of the taxonomy on purpose,
 * since changing the taxonomy changes its hash and asks for every post to be filed again.
 * `npm run verify` checks that every category has one.
 */
export const CATEGORY_EMOJI: Readonly<Record<string, string>> = {
  'Food & Recipes': '🍜',
  Design: '📐',
  Travel: '✈️',
  'Fitness & Health': '💪',
  'Books & Reading': '📚',
  'Tools & Software': '🛠️',
  'Finance & Investing': '💸',
  'Career & Business': '💼',
  'Home & DIY': '🏡',
  'Fashion & Beauty': '👟',
  'Art & Photography': '🎨',
  'Relationships & Dating': '💞',
  'Places & Events': '📍',
  Entertainment: '🍿',
  'Mindset & Self': '🧠',
  'Learning & Science': '🔬',
  'Humor & Misc': '😂',
};

/** For a post the AI could not place yet. */
export const NO_CATEGORY_EMOJI = '🤔';

/** The emoji for a category, or the not-sure one for none. */
export function emojiOf(category: string | null | undefined): string {
  if (!category || category === UNCATEGORIZED) return NO_CATEGORY_EMOJI;
  return CATEGORY_EMOJI[category] ?? '🔖';
}

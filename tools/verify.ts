/**
 * Checks for the two pure functions the whole pipeline leans on.
 *
 * `extractPosts` is the reason this extension keeps working when Instagram rotates its
 * doc_id or renames a GraphQL field, so the GraphQL case below deliberately uses a
 * made-up field name — if it still parses, the shape-driven design is doing its job.
 *
 *   npm run verify
 */

import { extractPosts } from '../src/capture/extract';
import { classifyByRules, normalizeCategory } from '../src/taxonomy';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, extra ?? '');
  }
}

console.log('\nextractPosts — REST shape (items[].media)');
const rest = {
  num_results: 1,
  items: [
    {
      media: {
        code: 'C8xK2mLp3qR',
        pk: '123',
        media_type: 2,
        video_duration: 47.3,
        taken_at: 1722200000,
        user: { username: 'cafe.oshi', full_name: 'Oshi' },
        caption: { text: 'Miso butter pasta in 15 minutes #recipe #food' },
        accessibility_caption: 'Photo by cafe.oshi',
        image_versions2: {
          candidates: [
            { url: 'https://cdn/big.jpg', width: 1080, height: 1080 },
            { url: 'https://cdn/small.jpg', width: 150, height: 150 },
          ],
        },
        clips_metadata: {
          music_info: { music_asset_info: { title: 'Sunset', display_artist: 'Nils' } },
        },
      },
    },
  ],
};
const a = extractPosts(rest);
check('one post', a.length === 1, a.length);
check('shortcode', a[0]?.shortcode === 'C8xK2mLp3qR', a[0]?.shortcode);
check('handle', a[0]?.handle === '@cafe.oshi', a[0]?.handle);
check('smallest thumbnail chosen', a[0]?.thumbnailUrl === 'https://cdn/small.jpg', a[0]?.thumbnailUrl);
check('isVideo from media_type 2', a[0]?.isVideo === true);
check('duration', a[0]?.durationSec === 47.3);
check('hashtags parsed', JSON.stringify(a[0]?.hashtags) === '["recipe","food"]', a[0]?.hashtags);
check('audio track', a[0]?.audioTrackName === 'Sunset — Nils', a[0]?.audioTrackName);
check('savedAt ms', a[0]?.savedAt === 1722200000000, a[0]?.savedAt);
check('permalink', a[0]?.permalink === 'https://www.instagram.com/p/C8xK2mLp3qR/');

console.log('\nextractPosts — GraphQL shape (renamed field)');
const gql = {
  data: {
    xdt_api__v1__feed__saved__posts: {
      edges: [
        {
          node: {
            media: {
              shortcode: 'XYZ99abc',
              owner: { username: 'studio.mkbd' },
              __typename: 'XDTGraphImage',
              taken_at_timestamp: 1722100000,
              edge_media_to_caption: { edges: [{ node: { text: 'Grid systems #design' } }] },
              display_url: 'https://cdn/display.jpg',
            },
          },
        },
      ],
    },
  },
};
const b = extractPosts(gql);
check('one post', b.length === 1, b.length);
check('shortcode from `shortcode`', b[0]?.shortcode === 'XYZ99abc');
check('owner fallback', b[0]?.handle === '@studio.mkbd');
check('nested caption', b[0]?.caption === 'Grid systems #design', b[0]?.caption);
check('display_url fallback', b[0]?.thumbnailUrl === 'https://cdn/display.jpg');
check('not video', b[0]?.isVideo === false);

console.log('\nextractPosts — noise rejection + dedupe');
check('no false positive on country code', extractPosts({ code: 'US', user: {} }).length === 0);
check('no match without owner', extractPosts({ code: 'C8xK2mLp3qR' }).length === 0);
check('dedupes repeats', extractPosts({ a: rest, b: rest }).length === 1);
check('survives cycles-free deep nest', extractPosts({ x: { y: { z: rest } } }).length === 1);
check('empty payload', extractPosts({}).length === 0);
check('null-safe', extractPosts(null).length === 0);

console.log('\nclassifyByRules');
const food = classifyByRules({
  caption: 'Miso butter pasta, preheat the oven, 2 tbsp miso',
  hashtags: ['recipe', 'food'],
  handle: '@cafe.oshi',
});
check('clear food match', food?.category === 'Food & Recipes', food);

const weak = classifyByRules({ caption: 'nice', hashtags: [], handle: '@x' });
check('weak signal falls through to LLM', weak === null, weak);

const ambiguous = classifyByRules({
  caption: 'meal prep for the gym',
  hashtags: ['mealprep', 'gym'],
  handle: '@x',
});
check('near-tie falls through to LLM', ambiguous === null, ambiguous);

check('word boundary: "art" not matched inside "start"',
  classifyByRules({ caption: 'start of the cardio', hashtags: [], handle: '@x' }) === null);

console.log('\nnormalizeCategory');
check('exact', normalizeCategory('Food & Recipes') === 'Food & Recipes');
check('case-insensitive', normalizeCategory('travel') === 'Travel');
check('half of ampersand pair', normalizeCategory('Fitness') === 'Fitness & Health');
check('unknown → null', normalizeCategory('Sports') === null);
check('null-safe', normalizeCategory(null) === null);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

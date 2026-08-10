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
import { migrate } from '../src/background/settings';

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

console.log('\nextractPosts — saved scope (the reported "it indexed posts I never saved")');
{
  // What a profile grid / related-reels / home-feed GraphQL answer looks like: same
  // endpoint, same media shape, no saved-feed container anywhere in it.
  const notSaved = {
    data: {
      xdt_api__v1__feed__user_timeline: {
        edges: [
          {
            node: {
              code: 'ZZnotsaved1',
              user: { username: 'same.creator' },
              media_type: 2,
              caption: { text: 'another reel by someone you saved once' },
            },
          },
        ],
      },
    },
  };

  check('unsaved GraphQL payload yields nothing under saved scope',
    extractPosts(notSaved, 'saved').length === 0, extractPosts(notSaved, 'saved'));
  check('…and it is the scope rejecting it, not the extractor',
    extractPosts(notSaved, 'any').length === 1);

  check('saved GraphQL container still extracts', extractPosts(gql, 'saved').length === 1);
  check('legacy edge_saved_media container is recognised',
    extractPosts({ data: { user: { edge_saved_media: gql.data } } }, 'saved').length === 1);

  // A media node carrying a saved-ish *scalar* must not open a container.
  const flagOnly = {
    data: {
      xdt_api__v1__feed__user_timeline: {
        edges: [{ node: { code: 'ZZnotsaved2', user: { username: 'x' }, has_viewer_saved: false } }],
      },
    },
  };
  check('a boolean like has_viewer_saved is not a container',
    extractPosts(flagOnly, 'saved').length === 0);

  check('REST saved payload is unaffected (it is URL-trusted, scope any)',
    extractPosts(rest, 'any').length === 1);
}

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

console.log('\nsettings migration');
{
  const fresh = migrate(undefined);
  check('fresh install gets the overlay bar',
    fresh.scrubberSkin === 'overlay' && fresh.settingsVersion === 2, fresh.scrubberSkin);

  // The reported bug: a profile created when 'native' was the default kept it, and
  // native controls are the ones Instagram's click-catcher swallows.
  const legacyNative = migrate({ scrubberSkin: 'native', apiKey: 'sk-keep-me' } as never);
  check('v1 profile on native is switched over',
    legacyNative.scrubberSkin === 'overlay', legacyNative.scrubberSkin);
  check('migration touches nothing else',
    legacyNative.apiKey === 'sk-keep-me', legacyNative.apiKey);

  check('legacy "thin" still maps to overlay',
    migrate({ scrubberSkin: 'thin' } as never).scrubberSkin === 'overlay');

  // Once migrated, the toggle has to win — otherwise native becomes unreachable.
  const chosen = migrate({ scrubberSkin: 'native', settingsVersion: 2 } as never);
  check('a deliberate native choice survives', chosen.scrubberSkin === 'native', chosen.scrubberSkin);

  check('idempotent', migrate(migrate({ scrubberSkin: 'native' } as never)).scrubberSkin === 'overlay');
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

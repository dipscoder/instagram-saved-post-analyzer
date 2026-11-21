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
import {
  CATEGORY_NAMES,
  classifyByRules,
  normalizeCategory,
  normalizeSubcategory,
  RULES_HASH,
  TAXONOMY_HASH,
} from '@saved-index/shared/taxonomy';
import { hashText } from '@saved-index/shared/hash';
import { searchFilters, searchTerms } from '@saved-index/shared/search';
import { applyVerdict, parseVerdict, type Verdict } from '../src/background/ledger';
import { mergeCaptured, upgrade } from '../src/background/db';
import { reserveRanks } from '../src/background/order';
import { collectionFromPath, isFullSavedFeed, isSavedRoute, savedFeedPath } from '../src/routes';
import { migrate } from '../src/background/settings';
import { toRecord } from '../src/types';
import { pillButton, pillStatus, type PillState } from '../src/page/flow';
import { validCollection } from '../src/background/collections';
import {
  BadRequest,
  combine,
  costUsd,
  decisionsBody,
  MAX_POSTS,
  MIN_PROBABILITY,
  parseRequest,
  readDecisions,
  readSummaries,
  salvageResults,
  summaryBody,
} from '../../supabase/functions/analyze/decide';
import {
  changed,
  fromVerdictRow,
  planSync,
  planThumbnails,
  afterCopy,
  adoptVerdicts,
  toRow,
  toVerdictRow,
} from '../src/background/sync-plan';
import {
  cleanQuery,
  EMBEDDING_DIMENSIONS,
  embeddingCostUsd,
  embeddingText,
  readEmbeddings,
  vectorLiteral,
} from '@saved-index/shared/embedding';
import { CORRECTION_TARGETS, evalCases, isCorrectionTarget } from '@saved-index/shared/corrections';
import { filedFromResult, needsPicture, SERVER_QUOTE_USD_PER_POST, signature, type FilingInput } from '@saved-index/shared/filing';
import {
  cleanTranscript,
  isInstagramVideoUrl,
  MAX_TRANSCRIBE_POSTS,
  needsTranscript,
  readTranscript,
  tooLong,
  transcribeCostUsd,
  transcribeQuoteUsd,
} from '@saved-index/shared/transcript';
import { BadSearch, parseSearch } from '../../supabase/functions/search/parse';
import labeled from '../../supabase/eval/labeled.json';
import { score, verdictOf, type Labeled } from '../../supabase/eval/score';
import {
  embeddingFields,
  hasAnyText,
  MAX_ATTEMPTS,
  MAX_SORT_POSTS,
  parseSortRequest,
  pickTranscribe,
  planSort,
  verdictRow,
  type SortRow,
} from '../../supabase/functions/sort/plan';
import {
  DEFAULT_FRAME_SECONDS,
  frameDuration,
  frameFilename,
  shortcodeFrom,
  stepTarget,
  timecode,
} from '../src/page/frames';

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
check('the grid-size thumbnail is chosen, not the 150px one', a[0]?.thumbnailUrl === 'https://cdn/big.jpg', a[0]?.thumbnailUrl);
{
  const sized = extractPosts({ items: [{ media: { ...(rest as { items: { media: object }[] }).items[0]!.media,
    image_versions2: { candidates: [1080, 750, 640, 320, 150].map((w) => ({ url: `https://cdn/${w}.jpg`, width: w, height: w * 1.25 })) } } }] });
  check('the smallest candidate at least 640px wide wins', sized[0]?.thumbnailUrl === 'https://cdn/640.jpg', sized[0]?.thumbnailUrl);
  const reel = extractPosts({ items: [{ media: { ...(rest as { items: { media: object }[] }).items[0]!.media,
    video_versions: [720, 480, 360].map((w) => ({ url: `https://cdn/${w}.mp4`, width: w, height: w * 1.78 })) } }] });
  check('a reel keeps its smallest video rendition', reel[0]?.videoUrl === 'https://cdn/360.mp4', reel[0]?.videoUrl);
  check('a post without a video has no video address', a[0]?.videoUrl === null, a[0]?.videoUrl);
}
check('isVideo from media_type 2', a[0]?.isVideo === true);
check('duration', a[0]?.durationSec === 47.3);
check('hashtags parsed', JSON.stringify(a[0]?.hashtags) === '["recipe","food"]', a[0]?.hashtags);
check('audio track', a[0]?.audioTrackName === 'Sunset — Nils', a[0]?.audioTrackName);
check('postedAt ms', a[0]?.postedAt === 1722200000000, a[0]?.postedAt);
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
check('a saved carousel stays one saved post', extractPosts({
  code: 'PARENT1', user: { username: 'maker' }, carousel_media: [
    { code: 'CHILD1', user: { username: 'maker' } },
    { code: 'CHILD2', user: { username: 'maker' } },
  ],
}).length === 1);
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
check('one broad hashtag still falls through',
  classifyByRules({ caption: 'nice', hashtags: ['explore'], handle: '@x' }) === null);

const ambiguous = classifyByRules({
  caption: 'meal prep for the gym',
  hashtags: ['mealprep', 'gym'],
  handle: '@x',
});
check('near-tie falls through to LLM', ambiguous === null, ambiguous);

check('word boundary: "art" not matched inside "start"',
  classifyByRules({ caption: 'start of the cardio', hashtags: [], handle: '@x' }) === null);
check('creator handle does not decide the subject',
  classifyByRules({ caption: 'A weekend in Kyoto', hashtags: [], handle: '@dailyrecipes' }) === null);

console.log('\nmodel result validation');
{
  const post = toRecord({
    shortcode: 'MODEL1', permalink: '', handle: '@x', caption: 'A useful pasta recipe',
    hashtags: [], thumbnailUrl: '', isVideo: false, durationSec: null,
    audioTrackName: null, altText: null, postedAt: null,
  });
  const missingConfidence = filedFromResult(
    post,
    { id: 0, category: 'Food & Recipes', tags: [' Pasta ', 'pasta', 'X'.repeat(80)], summary: '  Useful   pasta  ' },
  );
  check('missing confidence never files a guessed category', missingConfidence.category === null);
  check('tags are normalised, deduped and bounded',
    JSON.stringify(missingConfidence.tags) === JSON.stringify(['pasta', 'x'.repeat(48)]),
    missingConfidence.tags);
  check('summary whitespace is normalised', missingConfidence.summary === 'Useful pasta');

  const confident = filedFromResult(
    post,
    { id: 0, category: 'food and recipes', subcategory: 'recipe', confidence: 'medium' },
  );
  check('medium-confidence closed vocabulary is accepted',
    confident.category === 'Food & Recipes' && confident.subcategory === 'Recipe');
}

console.log('\nnormalizeCategory');
check('exact', normalizeCategory('Food & Recipes') === 'Food & Recipes');
check('case-insensitive', normalizeCategory('travel') === 'Travel');
check('half of ampersand pair', normalizeCategory('Fitness') === 'Fitness & Health');
check('unknown → null', normalizeCategory('Sports') === null);
check('null-safe', normalizeCategory(null) === null);

console.log('\nroute fences');
{
  check('saved grid captures', isSavedRoute('/dips/saved/'));
  check('a collection captures too', isSavedRoute('/dips/saved/recipes/17925/'));
  check('home feed does not', !isSavedRoute('/'));
  check('an open post does not', !isSavedRoute('/p/C8xK2mLp3qR/'));
  check('a reel does not', !isSavedRoute('/reel/C8xK2mLp3qR/'));
  check('a profile does not', !isSavedRoute('/cafe.oshi/'));
  check('explore does not', !isSavedRoute('/explore/'));

  // A census may only run where the sweep can see *everything* saved. Getting this wrong
  // offers to delete every post outside the collection being viewed.
  check('full feed may take a census', isFullSavedFeed('/dips/saved/'));
  check('all-posts may take a census', isFullSavedFeed('/dips/saved/all-posts/'));
  check('a collection may NOT', !isFullSavedFeed('/dips/saved/recipes/17925/'));
  check('an unrecognised saved path may NOT', !isFullSavedFeed('/dips/saved/x/y/z/'));
}

console.log('\nrecord migration');
{
  const v1 = {
    shortcode: 'C8xK2mLp3qR',
    caption: 'kept',
    savedAt: 1722200000000,
    category: 'Travel',
    categorizedAt: 1722300000000,
    schemaVersion: 1,
  };
  const up = upgrade(v1, 1);

  check('savedAt becomes postedAt', up['postedAt'] === 1722200000000, up['postedAt']);
  check('the old key is gone', !('savedAt' in up));
  check('categorisation is untouched', up['category'] === 'Travel' && up['caption'] === 'kept');
  // Nothing here may be invented: we never recorded either, and back-dating firstSeenAt
  // from postedAt would read like a fact.
  check('firstSeenAt is null, not guessed', up['firstSeenAt'] === null);
  check('savedRank is null, not guessed', up['savedRank'] === null);
  check('seenInSavedFeed is null so the next sweep decides', up['seenInSavedFeed'] === null);
  check('stamped to current schema', up['schemaVersion'] === 4, up['schemaVersion']);

  const fromV2 = upgrade({ shortcode: 'x', savedAt: 5, seenInSavedFeed: 99 }, 2);
  check('a v2 record keeps the stamp it already earned', fromV2['seenInSavedFeed'] === 99);
  check('idempotent', upgrade(upgrade(v1, 1), 3)['postedAt'] === 1722200000000);
}

console.log('\nsave order');
{
  // Feed order is save order, but only within one visit; a later visit saw newer saves.
  // The rank folds both so a single descending sort gets it right.
  const store: Record<string, unknown> = {};
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: store[k] }),
        set: async (patch: Record<string, unknown>) => void Object.assign(store, patch),
      },
    },
  };

  const backlog = await reserveRanks('visit-1', 3); // newest-saved first
  const more = await reserveRanks('visit-1', 2); // further down the same feed
  const later = await reserveRanks('visit-2', 1); // a post saved since, seen next visit

  check('within a visit, feed order descends', backlog[0]! > backlog[1]! && backlog[1]! > backlog[2]!);
  check('resuming the same visit continues where it stopped', more[0]! < backlog[2]!);
  check('a later visit outranks the whole backlog', later[0]! > backlog[0]!, { later, backlog });
}

console.log('\nsettings migration');
{
  const fresh = migrate(undefined);
  check('fresh install gets the overlay bar and the light theme',
    fresh.scrubberSkin === 'overlay' && fresh.theme === 'light' && fresh.settingsVersion === 3, fresh);

  // A profile created when 'native' was the default kept it, and native controls are the
  // ones Instagram's click-catcher swallows.
  check('v1 profile on native is switched over', migrate({ scrubberSkin: 'native' } as never).scrubberSkin === 'overlay');
  check('legacy "thin" still maps to overlay', migrate({ scrubberSkin: 'thin', settingsVersion: 2 } as never).scrubberSkin === 'overlay');
  // Once migrated, the toggle has to win — otherwise native becomes unreachable.
  check('a deliberate native choice survives', migrate({ scrubberSkin: 'native', settingsVersion: 2 } as never).scrubberSkin === 'native');
  check('idempotent', JSON.stringify(migrate(migrate({ scrubberSkin: 'native', theme: 'dark' } as never))) === JSON.stringify(migrate({ scrubberSkin: 'native', theme: 'dark' } as never)));

  check('a dark choice survives migration', migrate({ theme: 'dark', settingsVersion: 2 } as never).theme === 'dark');
  check('an unknown theme falls back to light', migrate({ theme: 'sepia' } as never).theme === 'light');

  // The extension stopped indexing. A key nothing reads must not stay in the browser.
  const old = migrate({ provider: 'openai', model: 'gpt-5.6-luna', apiKey: 'sk-proj-old', autoIndex: true, theme: 'dark', settingsVersion: 2 } as never);
  check('an older build\'s OpenAI key is dropped', !('apiKey' in old) && !JSON.stringify(old).includes('sk-'), old);
  check('only the appearance settings remain', Object.keys(old).sort().join() === 'scrubberSkin,settingsVersion,theme' && old.theme === 'dark', old);
}

console.log('\nroute fences');
{
  check('the saved grid is a saved route', isSavedRoute('/dipscoder/saved/'));
  check('a collection is a saved route', isSavedRoute('/dipscoder/saved/travel/'));
  // Unanchored, this matched — and a hashtag grid would have been captured as saved posts
  // and then counted as a census of them.
  check('a hashtag page named saved is not', !isSavedRoute('/explore/tags/saved/'));
  check('the home feed is not', !isSavedRoute('/'));

  check('all-posts is the full feed', isFullSavedFeed('/dipscoder/saved/all-posts/'));
  check('a collection is not the full feed', !isFullSavedFeed('/dipscoder/saved/travel/'));
  check('a hashtag page is never the full feed', !isFullSavedFeed('/explore/tags/saved/'));

  check('a collection opens the full saved feed', savedFeedPath('/dipscoder/saved/travel/1792/') === '/dipscoder/saved/all-posts/');
  check('a non-saved page has no library', savedFeedPath('/dipscoder/') === null);
  check('a hashtag page has no library', savedFeedPath('/explore/tags/saved/') === null);

  // The pill appears inside a collection and nowhere else.
  check('the saved overview shows no pill', collectionFromPath('/dipscoder/saved/') === null);
  check('the overview without a slash shows no pill', collectionFromPath('/dipscoder/saved') === null);
  check('all posts is a collection', collectionFromPath('/dipscoder/saved/all-posts/')?.name === 'All posts');
  check('audio is a collection', collectionFromPath('/dipscoder/saved/audio/')?.id === 'audio');
  const travel = collectionFromPath('/dipscoder/saved/travel-ideas/17925063/');
  check('a named collection carries its id and name',
    travel?.id === '17925063' && travel.name === 'Travel ideas', travel);
  check('an encoded collection name is decoded',
    collectionFromPath('/dipscoder/saved/caf%C3%A9s/1792/')?.name === 'Cafés');
  check('an unknown saved page shows no pill', collectionFromPath('/dipscoder/saved/travel/') === null);
  check('a post opened from a collection shows no pill', collectionFromPath('/p/C8xK2mLp3qR/') === null);
  check('a hashtag page shows no pill', collectionFromPath('/explore/tags/saved/') === null);
}

console.log('\nhashText');
{
  check('stable across calls', hashText('pasta') === hashText('pasta'));
  check('16 hex characters', /^[0-9a-f]{16}$/.test(hashText('pasta')));
  check('sensitive to one character', hashText('pasta') !== hashText('pastb'));
  check('empty is not special-cased', /^[0-9a-f]{16}$/.test(hashText('')));
}

console.log('\ntaxonomy hash');
{
  // The value at the last deliberate taxonomy change. Editing a category name, a
  // subcategory, a hashtag or a keyword changes it — all legitimate, and all of which
  // invalidate stored verdicts and re-bill every affected post in every installed
  // library. Updating this line is how that decision gets made on purpose, in the diff,
  // rather than discovered on someone's invoice.
  const COMMITTED = '28eade380b3dc684';
  check('matches the committed taxonomy', TAXONOMY_HASH === COMMITTED, TAXONOMY_HASH);
}

console.log('\nrules hash');
{
  const COMMITTED = '5adfad21b4b2f3dd';
  check('matches the committed rule behaviour', RULES_HASH === COMMITTED, RULES_HASH);
}

console.log('\nsave order across two tabs');
{
  // Both tabs sweep at once when Index now is pressed, so their messages interleave. A
  // single global cursor treated every alternation as a new visit — bumping the session
  // by a full stride and resetting the position — so ranks grew with depth into the feed,
  // which inverts the whole library under the default sort.
  const a1 = await reserveRanks('tab-a', 3);
  const b1 = await reserveRanks('tab-b', 3);
  const a2 = await reserveRanks('tab-a', 3);
  const b2 = await reserveRanks('tab-b', 3);

  check('tab A keeps descending through the interleave', a2[0]! < a1[2]!, { a1, a2 });
  check('tab B keeps descending through the interleave', b2[0]! < b1[2]!, { b1, b2 });
  check('the two tabs stay in separate bands', Math.abs(a1[0]! - b1[0]!) >= 1_000_000);
}

console.log('\ncategory normalisation');
{
  check('exact name', normalizeCategory('Food & Recipes') === 'Food & Recipes');
  check('case-insensitive', normalizeCategory('food & recipes') === 'Food & Recipes');
  check('half an ampersand pair', normalizeCategory('Food') === 'Food & Recipes');
  // Models write this about as often as the ampersand, and discarding it threw away an
  // answer that had already been paid for.
  check('"and" spelled out', normalizeCategory('Food and Recipes') === 'Food & Recipes', normalizeCategory('Food and Recipes'));
  check('nonsense stays null', normalizeCategory('Blorp') === null);

  check('subcategory from the right list', normalizeSubcategory('Food & Recipes', 'recipe') === 'Recipe');
  check('subcategory from another list is refused',
    normalizeSubcategory('Food & Recipes', 'Typography') === null);
  check('free text is refused', normalizeSubcategory('Food & Recipes', 'cooking tutorial') === null);
}

console.log('\nverdicts from the account');
{
  const post = toRecord({
    shortcode: 'C8xK2mLp3qR',
    permalink: 'https://www.instagram.com/p/C8xK2mLp3qR/',
    handle: '@cafe.oshi',
    caption: 'Miso butter pasta',
    hashtags: ['recipe'],
    thumbnailUrl: 'https://cdn/small.jpg',
    isVideo: false,
    durationSec: null,
    audioTrackName: null,
    altText: null,
    postedAt: 1722200000000,
  });
  const banked: Verdict = {
    shortcode: post.shortcode, category: 'Food & Recipes', subcategory: null, tags: ['pasta'],
    summary: 'Miso butter pasta', modelUsed: 'gpt-5.6-luna', categorizedAt: 1, inputHash: 'h',
    taxonomyHash: TAXONOMY_HASH, rulesHash: RULES_HASH, ledgerVersion: 2,
  };
  const restored = applyVerdict(post, banked);
  check('applying a verdict fills the categorisation', restored.category === 'Food & Recipes' && restored.modelUsed === 'gpt-5.6-luna');
  check('applying a verdict leaves captured fields alone',
    restored.caption === post.caption && restored.savedRank === post.savedRank);
}

console.log('\nrecord migration completeness');
{
  // A v1 record as it was actually written, minus everything added since.
  const v1 = upgrade({ shortcode: 'AAAAA', caption: 'hi', savedAt: 1722200000000 }, 1);
  for (const field of ['tags', 'hashtags'] as const) {
    check(`${field} is an array, not undefined`, Array.isArray(v1[field]), v1[field]);
  }
  for (const field of ['category', 'summary', 'categorizedAt', 'savedRank', 'seenInSavedFeed'] as const) {
    check(`${field} is present and null`, v1[field] === null, v1[field]);
  }
  check('savedAt is renamed, not duplicated',
    v1['postedAt'] === 1722200000000 && v1['savedAt'] === undefined);
  check('idempotent', JSON.stringify(upgrade(v1, 1)) === JSON.stringify(v1));
}

console.log('\nfresh capture merge');
{
  const old = {
    ...toRecord({
      shortcode: 'REFRESH1',
      permalink: 'https://www.instagram.com/p/REFRESH1/',
      handle: '@maker',
      caption: 'Original caption',
      hashtags: ['original'],
      thumbnailUrl: 'https://cdn/expired.jpg',
      isVideo: false,
      durationSec: 30,
      audioTrackName: null,
      altText: 'Old description',
      postedAt: 1722200000000,
    }),
    category: 'Art & Design',
    summary: 'A useful saved idea',
    categorizedAt: 10,
    modelUsed: 'test-model',
    savedRank: 100,
  };
  const fresh = {
    ...toRecord({
      shortcode: 'REFRESH1',
      permalink: 'https://www.instagram.com/reel/REFRESH1/',
      handle: '@maker',
      caption: 'Updated caption',
      hashtags: ['updated'],
      thumbnailUrl: 'https://cdn/fresh.jpg',
      isVideo: true,
      durationSec: 30,
      audioTrackName: 'New track',
      altText: 'Fresh description',
      postedAt: 1722200000000,
    }),
    savedRank: 999,
  };
  const merged = mergeCaptured(old, fresh);
  check('a fresh CDN URL replaces the expired one', merged?.thumbnailUrl === fresh.thumbnailUrl);
  check('mutable captured text is refreshed',
    merged?.caption === fresh.caption && merged.altText === fresh.altText && merged.isVideo);
  check('paid categorisation survives media refresh',
    merged?.category === old.category && merged.summary === old.summary && merged.modelUsed === old.modelUsed);
  check('the original save rank is stable', merged?.savedRank === old.savedRank);
  check('an identical capture causes no rewrite', mergeCaptured(fresh, fresh) === null);
}

console.log('\naccount sync plan');
{
  const base = toRecord({
    shortcode: 'SYNC1',
    permalink: 'https://www.instagram.com/p/SYNC1/',
    handle: 'chef',
    caption: 'pasta night',
    hashtags: ['pasta'],
    thumbnailUrl: '',
    isVideo: false,
    durationSec: null,
    audioTrackName: null,
    altText: null,
    postedAt: Date.UTC(2026, 0, 2),
  }, 7);
  const row = toRow(base);
  check('timestamps become ISO strings', row.posted_at === '2026-01-02T00:00:00.000Z', row.posted_at);
  check('save order is kept', row.saved_rank === 7);
  check('the sweep stamp is not uploaded', !('seen_in_saved_feed' in row));

  const first = planSync([base], new Map());
  check('a new post is uploaded', first.upserts.length === 1 && first.deletes.length === 0);

  const synced = new Map(first.upserts.map(({ row: r, hash }) => [r.shortcode, hash]));
  check('an unchanged post is not uploaded again', planSync([base], synced).upserts.length === 0);

  // Every visit to the saved grid re-stamps seenInSavedFeed. That alone must not
  // re-send the whole library.
  const reswept = { ...base, seenInSavedFeed: (base.seenInSavedFeed ?? 0) + 60_000 };
  check('a re-sweep alone uploads nothing', planSync([reswept], synced).upserts.length === 0);

  const categorised = { ...base, category: 'Food & Recipes', categorizedAt: Date.now() };
  check('a new category is uploaded', planSync([categorised], synced).upserts.length === 1);

  const pruned = planSync([], synced);
  check('a pruned post is deleted from the account',
    pruned.deletes.length === 1 && pruned.deletes[0] === 'SYNC1');

  // Thumbnails: only for posts the account already has, newest saved first, and an
  // expired URL is not retried until the post comes back with a fresh one.
  const cdn = 'https://scontent.cdninstagram.com/a.jpg';
  const older = { ...base, shortcode: 'OLD', thumbnailUrl: cdn, savedRank: 1 };
  const newer = { ...base, shortcode: 'NEW', thumbnailUrl: cdn, savedRank: 9 };
  const inAccount = new Map([['OLD', 'h'], ['NEW', 'h']]);
  const todo = planThumbnails([older, newer], inAccount, new Map());
  check('thumbnails are copied newest saved first', todo.map((t) => t.shortcode).join() === 'NEW,OLD');
  check('no thumbnail before its post is in the account',
    planThumbnails([older], new Map(), new Map()).length === 0);
  const failed = new Map([['OLD', { shortcode: 'OLD', stored: false, url: cdn }]]);
  check('an expired thumbnail URL is not retried', planThumbnails([older], inAccount, failed).length === 0);
  check('a fresh URL retries a failed thumbnail',
    planThumbnails([{ ...older, thumbnailUrl: `${cdn}?v=2` }], inAccount, failed).length === 1);
  const stored = new Map([['OLD', { shortcode: 'OLD', stored: true, url: '', format: 'webp' as const }]]);
  check('a sharp stored thumbnail is never copied again',
    planThumbnails([{ ...older, thumbnailUrl: `${cdn}?v=3` }], inAccount, stored).length === 0);
  const soft = new Map([['OLD', { shortcode: 'OLD', stored: true, url: cdn, format: 'jpg' as const }]]);
  check('a soft old copy is replaced once a fresh URL arrives',
    planThumbnails([{ ...older, thumbnailUrl: `${cdn}?v=4` }], inAccount, soft).length === 1 &&
    planThumbnails([older], inAccount, soft).length === 0);
  const softState = soft.get('OLD');
  const small = afterCopy(softState, 'OLD', `${cdn}?v=4`, { sourceEdge: 150 });
  check('a small source never overwrites the old copy',
    !small.upload && small.state.stored && small.state.format === 'jpg' && small.state.url.endsWith('v=4'), small);
  const failedUpgrade = afterCopy(softState, 'OLD', `${cdn}?v=5`, 'failed');
  check('a failed upgrade keeps the old copy marked stored', !failedUpgrade.upload && failedUpgrade.state.stored);
  const fresh = afterCopy(undefined, 'NEW', cdn, { sourceEdge: 640 });
  check('a new copy is stored as WebP', fresh.upload && fresh.state.format === 'webp');
  check('a first copy that fails is remembered as failed', !afterCopy(undefined, 'NEW', cdn, 'failed').state.stored);
}

console.log('\naccount ledger');
{
  const verdict: Verdict = {
    shortcode: 'PAID1',
    category: 'Food & Recipes',
    subcategory: null,
    tags: ['pasta'],
    summary: 'A pasta recipe.',
    modelUsed: 'gpt-5.6-luna',
    categorizedAt: Date.UTC(2026, 9, 24, 9, 30),
    inputHash: 'abc',
    taxonomyHash: 'tax',
    rulesHash: 'rules',
    ledgerVersion: 2,
  };
  const row = toVerdictRow(verdict);
  // Postgres hands timestamps back as "+00:00" rather than "Z".
  const fromServer = fromVerdictRow({ ...row, categorized_at: '2026-10-24T09:30:00+00:00' });
  const back = parseVerdict(fromServer);
  check('a verdict survives the round trip through the account',
    JSON.stringify(back) === JSON.stringify(verdict), back);
  const synced = new Map(changed([row], new Map()).map(({ row: r, hash }) => [r.shortcode, hash]));
  check('a pulled verdict is not uploaded straight back',
    back !== null && changed([toVerdictRow(back)], synced).length === 0);
  check('a garbled verdict from the account is refused', parseVerdict(fromVerdictRow({ shortcode: 'X' })) === null);
}

console.log('\nserver analysis');
{
  const refused = (body: unknown): boolean => {
    try {
      parseRequest(body);
      return false;
    } catch (err) {
      return err instanceof BadRequest;
    }
  };
  check('an empty batch is refused', refused({ posts: [] }));
  check('more than 25 posts are refused', refused({ posts: Array.from({ length: 26 }, () => ({ text: 'x' })) }));
  check('an image with several posts is refused', refused({ posts: [{ text: 'a' }, { text: 'b' }], image: 'data:image/jpeg;base64,AAAA' }));
  check('an image that is not a data URL is refused', refused({ posts: [{ text: 'a' }], image: 'https://example.com/a.jpg' }));
  const req = parseRequest({ posts: [{ id: 7, text: 'chef | caption: pasta' }, { id: 7, text: 'cat | caption: lol' }] });
  check('post ids are positions, whatever the caller sent', req.posts.map((p) => p.id).join() === '0,1');

  const body = decisionsBody(req) as { questions: { name: string; choices: { value: string }[] }[] };
  check('one choice question per post', body.questions.map((q) => q.name).join() === 'post_0,post_1');
  check('every question offers unknown', body.questions.every((q) => q.choices.some((c) => c.value === 'unknown')));

  const decisions = readDecisions({
    answers: [
      { type: 'choice', name: 'post_0', choice: 'Food & Recipes', probabilities: [{ value: 'Food & Recipes', probability: 0.92 }], confidence: 0.9 },
      { type: 'choice', name: 'post_1', choice: 'Humor & Misc', probabilities: [{ value: 'Humor & Misc', probability: MIN_PROBABILITY - 0.1 }] },
    ],
  });
  check('a confident decision keeps its category', decisions.get(0)?.category === 'Food & Recipes');
  check('an unsure decision files as Uncategorized', decisions.get(1)?.category === null);
  check('a refusal is simply absent', readDecisions({ answers: [{ type: 'refusal', name: 'post_0' }] }).size === 0);

  const summaries = readSummaries({ output_text: JSON.stringify({ results: [
    { id: 0, category: 'Travel', subcategory: 'Recipe', tags: ['pasta'], summary: 'Pasta.', confidence: 'high' },
    { id: 1, category: 'Humor & Misc', subcategory: null, tags: ['cat'], summary: 'A cat.', confidence: 'high' },
  ] }) });
  const combined = combine(req, decisions, summaries);
  check('the Decisions API chooses the category', combined[0]?.category === 'Food & Recipes' && combined[0]?.confidence === 'high');
  check('a subcategory from the category it chose is kept', combined[0]?.subcategory === 'Recipe');
  check('an unsure post keeps its summary but no category',
    combined[1]?.confidence === 'low' && combined[1]?.summary === 'A cat.');
  check('the result files the post as Uncategorized',
    filedFromResult(toRecord({ shortcode: 'S1', permalink: '', handle: 'cat', caption: 'lol', hashtags: [], thumbnailUrl: '', isVideo: false, durationSec: null, audioTrackName: null, altText: null, postedAt: null }), combined[1]!).category === null);
  check('without a decision the summary call\'s own answer stands',
    combine(req, new Map(), summaries)[0]?.category === 'Travel');
  check('an unreadable summary reply is no answers', readSummaries({ output_text: 'sorry' }).length === 0);
  check('the Decisions API bills input only',
    Math.abs(costUsd({ inputTokens: 1_000_000, outputTokens: 999 }, { inputTokens: 0, outputTokens: 0 }) - 0.1) < 1e-9);
}

console.log('\nvideo frames');
{
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  check('frame length defaults to 30 fps with nothing observed', frameDuration([]) === DEFAULT_FRAME_SECONDS);
  check('frame length is the smallest believable gap (a dropped frame doubles one)',
    near(frameDuration([1 / 15, 1 / 30, 1 / 30]), 1 / 30));
  check('60 fps is learned', near(frameDuration([1 / 60, 1 / 60, 1 / 30]), 1 / 60));
  check('a zero or absurd gap is ignored', near(frameDuration([0, 0.0001, 2, 1 / 25]), 1 / 25));

  const f = 1 / 30;
  const next = stepTarget(1, f, 1, 10);
  check('next frame lands inside the following frame, not on its edge', next > 1 + f && next < 1 + 2 * f);
  const prev = stepTarget(1, f, -1, 10);
  check('previous frame lands inside the preceding frame', prev > 1 - f && prev < 1);
  check('stepping back from the first frame stays at 0', stepTarget(0, f, -1, 10) === 0);
  check('stepping past the end stays on the last frame', stepTarget(10, f, 1, 10) === 10 - f / 2);

  check('timecode while playing is m:ss', timecode(67.48) === '1:07');
  check('timecode when still shows hundredths', timecode(67.48, true) === '1:07.48');
  check('timecode never shows 60 seconds', timecode(59.999, true) === '0:59.99');
  check('timecode of a missing duration is 0:00', timecode(NaN) === '0:00');

  check('shortcode from a reel path', shortcodeFrom('/reel/C8xYz12AbCd/') === 'C8xYz12AbCd');
  check('shortcode from a post link', shortcodeFrom('https://www.instagram.com/p/AbC_d-123/?img_index=2') === 'AbC_d-123');
  check('no shortcode on the saved grid', shortcodeFrom('/someone/saved/') === null);
  check('frame filename names the post and the moment',
    frameFilename('C8xYz12AbCd', 72.48) === 'instagram-C8xYz12AbCd-1m12.480s.png');
  check('frame filename without a post', frameFilename(null, 3.5) === 'instagram-video-0m03.500s.png');
}

console.log('\ninstagram collections');
{
  const capture = {
    shortcode: 'Coll123ab', permalink: 'https://www.instagram.com/p/Coll123ab/', handle: 'a',
    caption: 'c', hashtags: [], thumbnailUrl: 'https://cdn/x.jpg', isVideo: false,
    durationSec: null, audioTrackName: null, altText: null, postedAt: null,
  };
  check('a post captured outside a collection has none', toRecord(capture).collections.length === 0);
  const inTravel = toRecord(capture, 1, '1792');
  check('a post captured in a collection records it', inTravel.collections.join() === '1792');

  const alsoFood = mergeCaptured(inTravel, toRecord(capture, 2, '2001'));
  check('seeing it in a second collection adds that one', alsoFood?.collections.join() === '1792,2001');
  check('seeing it again in the same collection rewrites nothing',
    mergeCaptured(inTravel, { ...toRecord(capture, 1, '1792'), thumbnailUrl: inTravel.thumbnailUrl }) === null);
  const fromAll = mergeCaptured(inTravel, { ...toRecord(capture, 3), caption: 'new' });
  check('seeing it under All posts never removes a collection', fromAll?.collections.join() === '1792');

  check('an older record gains an empty collection list',
    Array.isArray(upgrade({ shortcode: 'Old12', caption: 'x' }, 3)['collections']));
  check('the account row carries collections', toRow(inTravel).collections.join() === '1792');

  check('a numeric collection is accepted', validCollection({ id: '1792', name: 'Travel' })?.name === 'Travel');
  check('a non-numeric id is refused', validCollection({ id: 'all-posts', name: 'All' }) === null);
  check('a forged object is refused', validCollection({ id: ['1'], name: 'x' }) === null);
  check('a missing collection is null', validCollection(undefined) === null);
  check('a long name is cut to 100', validCollection({ id: '1', name: 'x'.repeat(500) })?.name.length === 100);
  check('control characters are stripped', validCollection({ id: '1', name: 'a\u0007b' })?.name === 'ab');
}

console.log('\nthe pill');
{
  const s = (over: Partial<PillState>): PillState => ({
    finding: false, total: 0, strays: 0, confirming: false, message: null, ...over,
  });
  check('nothing found yet: find', pillButton(s({})).action === 'find');
  check('finding: stop', pillButton(s({ finding: true, strays: 3 })).action === 'stop');
  check('the extension never offers to index', !['Index', 'Sort'].some((w) => pillButton(s({ total: 40 })).label.includes(w)));
  check('strays need two presses',
    pillButton(s({ strays: 3 })).action === 'remove' && pillButton(s({ strays: 3, confirming: true })).action === 'confirm-remove');
  check('status while finding', pillStatus(s({ finding: true, total: 1200 })) === 'Finding posts · 1,200 posts so far');
  check('status when idle', pillStatus(s({ total: 1 })) === '1 post found · synced to your library');
  check('status for strays', pillStatus(s({ total: 9, strays: 2 })) === '2 posts no longer saved on Instagram');
  check('a rate-limit message is shown as is',
    pillStatus(s({ total: 9, message: 'Instagram rate-limited the page.' })) === 'Instagram rate-limited the page.');
}

console.log('\nweb app search');
{
  check('terms are lower-cased words', searchTerms('Pasta  RECIPE').join() === 'pasta,recipe');
  check('single letters and repeats are dropped', searchTerms('a pasta Pasta').join() === 'pasta');
  check('accented letters survive', searchTerms('Café crème').join() === 'café,crème');
  check('at most six terms', searchTerms('aa bb cc dd ee ff gg hh').length === 6);
  const hostile = searchFilters('x),user_id.neq.0,(caption.ilike.*%_*');
  const safe = /^[a-z_]+\.(ilike\.\*[\p{L}\p{N}]+\*|cs\.\{[\p{L}\p{N}]+\})$/u;
  check('filter syntax in a query cannot escape its term',
    hostile.every((f) => f.split(',').length === 9 && f.split(',').every((c) => safe.test(c))), hostile);
  const one = searchFilters('tokyo')[0] ?? '';
  check('one term matches text by substring and arrays by element',
    one.includes('caption.ilike.*tokyo*') && one.includes('tags.cs.{tokyo}'), one);
  check('an empty query adds no filter', searchFilters('  !! ').length === 0);
}

console.log('\nserver sorting');
{
  const row = (over: Partial<SortRow>): SortRow => ({
    shortcode: 'S1', handle: '@cafe.oshi', caption: '', hashtags: [], alt_text: null, is_video: false,
    duration_sec: null, audio_track_name: null, categorized_at: null, thumbnail_stored: false, thumbnail_format: null,
    category: null, subcategory: null, tags: [], summary: null, embedded_at: null,
    video_url: null, transcript: null, transcribed_at: null, index_attempts: 0,
    ...over,
  });
  const textual = row({ shortcode: 'T', caption: 'A slow Sunday walk along the canal, thinking about nothing much' });
  const ruled = row({ shortcode: 'R', caption: 'Easy pasta recipe for dinner', hashtags: ['recipe', 'food', 'cooking'] });
  const picture = row({ shortcode: 'P', thumbnail_stored: true, thumbnail_format: 'webp' });
  const blank = row({ shortcode: 'B' });
  const done = row({ shortcode: 'D', caption: textual.caption, categorized_at: '2026-11-19T10:00:00Z', embedded_at: '2026-11-19T10:00:01Z' });
  const plan = planSort([textual, ruled, picture, blank, done]);
  check('an already sorted post is never sent again', ![...plan.text, ...plan.vision, ...plan.unreadable].some((r) => r.shortcode === 'D') && !plan.ruled.some((r) => r.row.shortcode === 'D'));
  check('keyword rules file a post for free', plan.ruled.length === 1 && plan.ruled[0]!.row.shortcode === 'R', plan.ruled);
  check('a post with text goes to the text batch', plan.text.map((r) => r.shortcode).join() === 'T');
  check('a post with only a stored thumbnail goes to vision', plan.vision.map((r) => r.shortcode).join() === 'P');
  check('a post with neither is reported, not billed', plan.unreadable.map((r) => r.shortcode).join() === 'B');
  const many = planSort(Array.from({ length: 6 }, (_, i) => row({ shortcode: `V${i}`, thumbnail_stored: true })));
  check('at most four vision posts per request', many.vision.length === 4 && many.unreadable.length === 2);

  const post = toRecord({
    shortcode: 'T', permalink: '', handle: '@cafe.oshi', caption: textual.caption, hashtags: [],
    thumbnailUrl: '', isVideo: false, durationSec: null, audioTrackName: null, altText: null, postedAt: null,
  });
  const v = verdictRow(textual, { category: 'Travel', subcategory: null, tags: [], summary: 'x' }, 'm', new Date());
  check('the server hashes exactly what the extension hashes', v['input_hash'] === hashText(signature(post)));

  check('a sort request is de-duplicated', parseSortRequest({ shortcodes: ['A', 'A', 'B'] }).join() === 'A,B');
  let refused = 0;
  for (const bad of [{}, { shortcodes: [] }, { shortcodes: ['a/b'] }, { shortcodes: Array(MAX_SORT_POSTS + 1).fill('A') }]) {
    try { parseSortRequest(bad); } catch { refused++; }
  }
  check('a malformed sort request is refused', refused === 4);

  const verdict = (shortcode: string, at: number, modelUsed = 'm') => ({
    shortcode, category: 'Travel', subcategory: null, tags: [], summary: 's', modelUsed, categorizedAt: at,
    inputHash: 'h', taxonomyHash: 't', rulesHash: 'r', ledgerVersion: 2,
  });
  const unsorted = { ...post, shortcode: 'U' };
  const newer = { ...post, shortcode: 'N', category: 'Food', categorizedAt: 5_000 };
  const adopted = adoptVerdicts([unsorted, newer, { ...post, shortcode: 'K' }], [verdict('U', 1_000), verdict('N', 2_000), verdict('K', 1_000, 'skipped')]);
  check('a server verdict sorts a post the extension never sorted', adopted.length === 1 && adopted[0]!.shortcode === 'U' && adopted[0]!.category === 'Travel', adopted);
}

console.log('\nanalysis v2');
{
  const row = (over: Partial<SortRow>): SortRow => ({
    shortcode: 'S1', handle: '@cafe.oshi', caption: '', hashtags: [], alt_text: null, is_video: false,
    duration_sec: null, audio_track_name: null, categorized_at: null, thumbnail_stored: true, thumbnail_format: 'webp',
    category: null, subcategory: null, tags: [], summary: null, embedded_at: null,
    video_url: null, transcript: null, transcribed_at: null, index_attempts: 0, ...over,
  });
  const thin = { caption: 'obsessed 😍 #interiors #home', hashtags: ['interiors', 'home'], altText: null };
  check('a caption of a few words needs the picture', needsPicture(thin));
  check('alt text makes a thin caption enough', !needsPicture({ ...thin, altText: 'Photo of a living room with a green velvet sofa' }));
  check('a real caption does not need the picture',
    !needsPicture({ caption: 'A slow Sunday walk along the canal, thinking about nothing much', hashtags: [], altText: null }));
  check('no text at all needs the picture', needsPicture({ caption: '', hashtags: [], altText: null }));

  const plan = planSort([
    row({ shortcode: 'THIN', caption: thin.caption, hashtags: thin.hashtags }),
    row({ shortcode: 'OLD', categorized_at: '2026-11-19T10:00:00Z', summary: 'kyoto in three days' }),
    row({ shortcode: 'NOW', categorized_at: '2026-11-19T10:00:00Z', embedded_at: '2026-11-19T10:00:01Z' }),
  ]);
  check('a thin caption with a stored picture goes to vision', plan.vision.map((r) => r.shortcode).join() === 'THIN', plan);
  check('a filed post without an embedding is only embedded', plan.embedOnly.map((r) => r.shortcode).join() === 'OLD');
  check('a filed and embedded post is left alone',
    ![...plan.text, ...plan.vision, ...plan.embedOnly, ...plan.unreadable].some((r) => r.shortcode === 'NOW'));
  const noPicture = planSort([row({ shortcode: 'T', caption: thin.caption, hashtags: thin.hashtags, thumbnail_stored: false })]);
  check('a thin caption without a stored picture still goes by text', noPicture.text.length === 1);

  const fields = embeddingFields(row({ caption: 'Fushimi Inari at dawn', hashtags: ['japan'] }), {
    category: 'Travel', subcategory: 'City guides', tags: ['kyoto', 'temples'], summary: 'Three days in Kyoto',
  });
  const text = embeddingText(fields);
  check('an embedding leads with what the post is about', text.startsWith('Three days in Kyoto\nTravel\nCity guides\nkyoto, temples'), text);
  check('an embedding keeps the post\'s own words', text.includes('Fushimi Inari at dawn') && text.includes('#japan') && text.includes('@cafe.oshi'));
  check('an embedding never says Uncategorized', !embeddingText({ ...fields, category: 'Uncategorized' }).includes('Uncategorized'));
  check('an embedding text is bounded', embeddingText({ ...fields, caption: 'x'.repeat(10_000) }).length <= 2_400);

  const vec = (n: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => n);
  const reply = { data: [{ index: 1, embedding: vec(0.2) }, { index: 0, embedding: vec(0.1) }], usage: { total_tokens: 1_000_000 } };
  const read = readEmbeddings(reply, 2);
  check('embeddings come back in input order', read?.[0]?.[0] === 0.1 && read?.[1]?.[0] === 0.2);
  check('a missing embedding discards the reply', readEmbeddings({ data: [reply.data[0]] }, 2) === null);
  check('a wrong-sized embedding discards the reply', readEmbeddings({ data: [{ index: 0, embedding: [1, 2] }] }, 1) === null);
  check('a duplicate index discards the reply',
    readEmbeddings({ data: [{ index: 0, embedding: vec(1) }, { index: 0, embedding: vec(1) }] }, 2) === null);
  check('a non-number discards the reply', readEmbeddings({ data: [{ index: 0, embedding: [...vec(1).slice(1), 'x'] }] }, 1) === null);
  check('a million embedding tokens cost two cents', Math.abs(embeddingCostUsd(reply) - 0.02) < 1e-9);
  check('a vector is written as pgvector text', vectorLiteral([0.1234567, -2, 0]) === '[0.123457,-2,0]');

  check('a query is cleaned and bounded', cleanQuery('  quick\u0000  dinner ') === 'quick dinner' && cleanQuery('a'.repeat(500)).length === 200);
  check('a search is parsed', parseSearch({ query: 'quick dinner', collection: '1792' }).collection === '1792');
  let refused = 0;
  for (const bad of [{ query: 'a' }, { query: 'ok ok', category: 'Nope' }, { query: 'ok ok', collection: '1,2' }, { query: 5 }]) {
    try { parseSearch(bad); } catch (e) { if (e instanceof BadSearch) refused++; }
  }
  check('a malformed search is refused', refused === 4);
}

console.log('\ncategory corrections');
{
  check('every category, and Unknown, can be chosen', CORRECTION_TARGETS.length === CATEGORY_NAMES.length + 1 && CORRECTION_TARGETS.includes(null));
  check('Uncategorized is not a category you can choose', !isCorrectionTarget('Uncategorized') && !isCorrectionTarget('Nope') && isCorrectionTarget(null));
  const file = evalCases([
    { shortcode: 'C1', from_category: 'Travel', to_category: 'Food & Recipes', handle: '@eater', caption: 'tonkatsu in Shinjuku', hashtags: ['tokyo'] },
    { shortcode: 'C2', from_category: null, to_category: null, handle: 'x', caption: 'obsessed', hashtags: [] },
    { shortcode: 'C3', from_category: 'Design', to_category: 'Retired category', handle: 'y', caption: 'z', hashtags: [] },
  ]);
  check('a fix becomes an eval case labeled with your answer',
    file.posts.length === 2 && file.posts[0]?.id === 'you-C1' && file.posts[0]?.expected === 'Food & Recipes' && file.posts[0]?.handle === 'eater', file);
  check('a fix to Unknown is labeled null, as the eval expects', file.posts[1]?.expected === null);
  check('a fix to a category that no longer exists is left out', !file.posts.some((p) => p.id === 'you-C3'));
  const scored = score(file.posts.map((p) => ({ id: p.id, expected: p.expected, got: null, byRules: false })));
  check('the eval scores your corrections like any labeled post', scored.total === 2 && scored.right === 1);
}

console.log('\nreel transcripts');
{
  const row = (over: Partial<SortRow>): SortRow => ({
    shortcode: 'S1', handle: '@cafe.oshi', caption: '', hashtags: [], alt_text: null, is_video: true,
    duration_sec: 30, audio_track_name: null, categorized_at: null, thumbnail_stored: true, thumbnail_format: 'webp',
    category: null, subcategory: null, tags: [], summary: null, embedded_at: null,
    video_url: 'https://scontent.cdninstagram.com/v/reel.mp4?oe=1', transcript: null, transcribed_at: null, index_attempts: 0, ...over,
  });
  check('a reel with a video and no transcript needs one', needsTranscript(row({})));
  check('a photo never needs a transcript', !needsTranscript(row({ is_video: false })));
  check('a reel tried once is not tried again', !needsTranscript(row({ transcribed_at: '2026-11-20T10:00:00Z' })));
  check('a reel without a video address cannot be transcribed', !needsTranscript(row({ video_url: null })));

  const fresh = Array.from({ length: 6 }, (_, i) => row({ shortcode: `R${i}` }));
  check('at most four reels are transcribed per request', pickTranscribe(fresh).length === MAX_TRANSCRIBE_POSTS && MAX_TRANSCRIBE_POSTS === 4);
  const waiting = planSort(fresh);
  check('a reel waiting for its transcript is not filed blind',
    waiting.waiting.length === 6 && waiting.text.length + waiting.vision.length + waiting.ruled.length === 0, waiting);
  const heard = planSort([row({ shortcode: 'H', transcript: 'Today I am showing you how to make a proper Neapolitan pizza dough at home', transcribed_at: 'x', thumbnail_stored: false })]);
  check('a transcript alone is enough to file from text', heard.text.map((r) => r.shortcode).join() === 'H', heard);
  const silent = planSort([row({ shortcode: 'Q', transcript: '', transcribed_at: 'x' })]);
  check('a silent reel falls back to its picture', silent.vision.map((r) => r.shortcode).join() === 'Q', silent);

  const base: FilingInput = { handle: '@a', caption: 'pizza', hashtags: [], altText: null, isVideo: true, durationSec: 30, audioTrackName: null };
  check('a post without a transcript hashes as it always did', signature(base) === signature({ ...base, transcript: null }) && signature(base) === signature({ ...base, transcript: '  ' }));
  const said = signature({ ...base, transcript: 'x'.repeat(5_000) });
  check('a transcript reaches the model, bounded', said.includes('transcript: x') && said.length < 1_500, said.length);
  const embedded = embeddingText(embeddingFields(row({ caption: 'pizza night', transcript: 'stretch the dough with your knuckles' })));
  check('a transcript is part of what is embedded', embedded.includes('said: stretch the dough'), embedded);

  check('a minute of audio costs $0.0045', Math.abs(transcribeCostUsd(60) - 0.0045) < 1e-12);
  check('an unknown length is quoted as a long reel', transcribeCostUsd(null) > transcribeCostUsd(30));
  check('a reel over ten minutes is never transcribed or quoted', tooLong({ duration_sec: 601 }) && transcribeQuoteUsd({ duration_sec: 601 }) === 0);
  check('a transcript reply is read and billed by its own seconds',
    JSON.stringify(readTranscript({ text: ' make  the dough ', usage: { type: 'duration', seconds: 12 } }, 30)) === '{"text":"make the dough","seconds":12}');
  check('silence is recorded as nothing said', readTranscript({ text: ' ' }, 30).text === '');
  check('a reply that is not one is no transcript', readTranscript({ error: 'x' }, 30).text === null);
  check('a transcript is bounded', (cleanTranscript('y '.repeat(30_000)) ?? '').length === 20_000);

  check('the server fetches video only from Instagram\'s CDN',
    isInstagramVideoUrl('https://scontent-nrt1-1.cdninstagram.com/o1/v/t16/f2/m86/x.mp4?efg=1') &&
      isInstagramVideoUrl('https://video.fbcdn.net/v.mp4') &&
      !isInstagramVideoUrl('http://scontent.cdninstagram.com/x.mp4') &&
      !isInstagramVideoUrl('https://scontent.cdninstagram.com.evil.example/x.mp4') &&
      !isInstagramVideoUrl('https://evil.example@scontent.cdninstagram.com/x.mp4') &&
      !isInstagramVideoUrl('https://scontent.cdninstagram.com:8443/x.mp4') &&
      !isInstagramVideoUrl('https://169.254.169.254/latest') &&
      !isInstagramVideoUrl(`https://a.cdninstagram.com/${'x'.repeat(4_000)}`));
}

console.log('\nindexing failures');
{
  const row = (over: Partial<SortRow>): SortRow => ({
    shortcode: 'S1', handle: '@cafe.oshi', caption: '', hashtags: [], alt_text: null, is_video: false,
    duration_sec: null, audio_track_name: null, categorized_at: null, thumbnail_stored: false, thumbnail_format: null,
    category: null, subcategory: null, tags: [], summary: null, embedded_at: null,
    video_url: null, transcript: null, transcribed_at: null, index_attempts: 0, ...over,
  });
  const caption = 'A slow Sunday walk along the canal, thinking about nothing much';
  const plan = planSort([row({ shortcode: 'G', caption, index_attempts: MAX_ATTEMPTS }), row({ shortcode: 'T', caption, index_attempts: 2 })]);
  check('a post that failed three times is never sent again', plan.skipped.map((r) => r.shortcode).join() === 'G' && plan.text.map((r) => r.shortcode).join() === 'T', plan);
  const filed = planSort([row({ shortcode: 'F', caption, index_attempts: MAX_ATTEMPTS, categorized_at: 'x' })]);
  check('a filed post is still embedded whatever its failures', filed.embedOnly.length === 1);
  check('a given-up reel is not transcribed',
    pickTranscribe([row({ is_video: true, video_url: 'https://a.cdninstagram.com/1.mp4', index_attempts: MAX_ATTEMPTS })]).length === 0);
  check('a thin post whose picture cannot be read still has its words', hasAnyText(row({ caption: 'obsessed' })) && !hasAnyText(row({})));

  check('the summary call has room for a full batch to answer',
    (summaryBody({ posts: Array.from({ length: MAX_POSTS }, (_, id) => ({ id, text: 'x' })) }) as { max_output_tokens: number }).max_output_tokens >= 100 * MAX_POSTS);
  const cut = '{"results":[{"id":0,"category":"Travel","tags":["a{b"],"summary":"one \\"quoted\\" }"},{"id":1,"category":"Design","summary":"two"},{"id":2,"categ';
  const saved = salvageResults(cut);
  check('an answer cut off mid-post keeps every complete post before the cut',
    saved.map((r) => r.id).join() === '0,1' && saved[0]?.summary === 'one "quoted" }', saved);
  check('a cut-off answer is read through readSummaries', readSummaries({ output_text: cut }).length === 2);
  check('the quote covers a post filed alone with its picture', SERVER_QUOTE_USD_PER_POST >= 0.0011);
}

console.log('\nfiling eval');
{
  const o = (expected: string | null, got: string | null, byRules = false) => ({ id: 'x', expected, got, byRules });
  const s = score([o('Travel', 'Travel', true), o('Design', null), o('Food & Recipes', 'Travel'), o(null, null)]);
  check('right, unknown and wrong are counted apart', s.right === 2 && s.unknown === 1 && s.wrong === 1, s);
  check('precision counts only posts given a category', s.precision === 0.5, s.precision);
  check('a thin post left Unknown is right', verdictOf(o(null, null)) === 'right');

  // The free keyword rules must never put a labeled post in the wrong category: a wrong
  // category is the mistake nobody notices. Missing one is fine; the model picks it up.
  const posts = labeled.posts as Labeled[];
  const ruled = posts.flatMap((p) => {
    const hit = classifyByRules({ handle: p.handle, caption: p.caption, hashtags: p.hashtags, altText: null, isVideo: false, durationSec: null, audioTrackName: null });
    return hit ? [o(p.expected, hit.category, true)] : [];
  });
  const misfiled = ruled.filter((r) => verdictOf(r) === 'wrong');
  check(`the keyword rules misfile none of the ${posts.length} labeled posts`, misfiled.length === 0, misfiled);
  check('every label is a real category or null',
    posts.every((p) => p.expected === null || CATEGORY_NAMES.includes(p.expected)), posts.filter((p) => p.expected && !CATEGORY_NAMES.includes(p.expected)));
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

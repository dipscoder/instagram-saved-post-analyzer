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
  classifyByRules,
  normalizeCategory,
  normalizeSubcategory,
  RULES_HASH,
  TAXONOMY_HASH,
} from '@saved-index/shared/taxonomy';
import { hashText } from '@saved-index/shared/hash';
import { applyVerdict, isFresh, verdictFrom, type Verdict } from '../src/background/ledger';
import { matchesSearch, mergeCaptured, tokenize, upgrade } from '../src/background/db';
import { reserveRanks } from '../src/background/order';
import { isFullSavedFeed, isSavedRoute } from '../src/routes';
import { migrate } from '../src/background/settings';
import { toRecord } from '../src/types';
import { applyResult } from '../src/background/categorize';
import { estimateUsd, PROVIDERS } from '../src/background/providers/index';
import { usesResponsesApi } from '../src/background/providers/openai';

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

console.log('\nsearch');
{
  const post = toRecord({
    shortcode: 'C8xK2mLp3qR',
    permalink: 'https://www.instagram.com/p/C8xK2mLp3qR/',
    handle: '@cafe.oshi',
    caption: 'Miso butter pasta in 15 minutes #recipe #weeknight',
    hashtags: ['recipe', 'weeknight'],
    thumbnailUrl: '',
    isVideo: true,
    durationSec: 47,
    audioTrackName: 'Sunset — Nils',
    altText: 'A bowl of noodles on a wooden table',
    postedAt: null,
  });
  const indexed = { ...post, summary: 'Recipe for creamy pasta', category: 'Food & Recipes', subcategory: 'Dinner', tags: ['quick'] };

  const hit = (q: string) => matchesSearch(indexed, tokenize(q));

  check('single term', hit('pasta'));
  // The old single-substring match failed this: the words are in the other order.
  check('words match in any order', hit('pasta recipe'));
  check('every word has to match', !hit('pasta risotto'));
  check('finds by subcategory', hit('dinner'));
  check('finds by hashtag, with or without the #', hit('weeknight') && hit('#weeknight'));
  check('finds by alt text', hit('noodles'));
  check('finds by audio track', hit('nils'));
  check('finds by handle', hit('oshi'));
  check('empty query matches everything', hit('') && hit('   '));

  // An uncategorised post is still findable by what Instagram gave us.
  check('works before categorisation', matchesSearch(post, tokenize('miso butter')));
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
  const missingConfidence = applyResult(
    post,
    { id: 0, category: 'Food & Recipes', tags: [' Pasta ', 'pasta', 'X'.repeat(80)], summary: '  Useful   pasta  ' },
    'test-model',
  );
  check('missing confidence never files a guessed category', missingConfidence.category === null);
  check('tags are normalised, deduped and bounded',
    JSON.stringify(missingConfidence.tags) === JSON.stringify(['pasta', 'x'.repeat(48)]),
    missingConfidence.tags);
  check('summary whitespace is normalised', missingConfidence.summary === 'Useful pasta');

  const confident = applyResult(
    post,
    { id: 0, category: 'food and recipes', subcategory: 'recipe', confidence: 'medium' },
    'test-model',
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
  check('stamped to current schema', up['schemaVersion'] === 3, up['schemaVersion']);

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

  // Anthropic, Gemini and OpenRouter were removed. Their keys mean nothing to OpenAI.
  const removed = migrate({ provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'sk-ant-old' } as never);
  check('a removed provider falls back to OpenAI',
    removed.provider === 'openai' && removed.model === 'gpt-5.6-luna', removed);
  check('a removed provider\'s key is dropped', removed.apiKey === '', removed.apiKey);
  check('an OpenAI key survives migration',
    migrate({ provider: 'openai', apiKey: 'sk-keep-me' } as never).apiKey === 'sk-keep-me');
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

console.log('\nledger freshness');
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
  const banked: Verdict = verdictFrom(
    { ...post, category: 'Food & Recipes', summary: 'Miso butter pasta', modelUsed: 'rules', categorizedAt: 1 },
    'signature-v1',
  );

  check('a matching verdict is reused', isFresh(banked, hashText('signature-v1')));
  check('a changed caption is not', !isFresh(banked, hashText('signature-v2')));
  check('a changed taxonomy is not', !isFresh({ ...banked, taxonomyHash: 'stale' }, hashText('signature-v1')));
  check('an old rule strategy is not reused',
    !isFresh({ ...banked, rulesHash: 'stale' }, hashText('signature-v1')));
  check('a paid verdict survives a rule-only change',
    isFresh({ ...banked, modelUsed: 'test-model', rulesHash: 'stale' }, hashText('signature-v1')));
  check('nothing on file is not', !isFresh(undefined, hashText('signature-v1')));
  // A skipped post is almost always an expired thumbnail rather than a fact about the
  // post, so re-indexing has to be allowed to try again.
  check('a skipped verdict is never reused',
    !isFresh({ ...banked, modelUsed: 'skipped' }, hashText('signature-v1')));

  const restored = applyVerdict(post, banked);
  check('applying a verdict fills the categorisation', restored.category === 'Food & Recipes');
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

console.log('\nsearch folding');
{
  const post = toRecord({
    shortcode: 'B',
    permalink: '',
    handle: '@chef',
    caption: 'crème brûlée, properly',
    hashtags: [],
    thumbnailUrl: '',
    isVideo: false,
    durationSec: null,
    audioTrackName: null,
    altText: null,
    postedAt: null,
  });
  // Someone who saved this will type it without the accents, which is exactly the user
  // whose library is not in English.
  check('accents are optional', matchesSearch(post, tokenize('creme brulee')));
  check('accents still match themselves', matchesSearch(post, tokenize('crème')));
  check('every term must appear', !matchesSearch(post, tokenize('creme pasta')));
}

console.log('\ncurrent model catalogue');
{
  const openaiModels = PROVIDERS.openai.models.map((model) => model.id);
  check('OpenAI is the only provider', Object.keys(PROVIDERS).join() === 'openai');
  check('OpenAI includes GPT-5.6 Luna', openaiModels.includes('gpt-5.6-luna'));
  check('OpenAI includes GPT-5.6 Terra', openaiModels.includes('gpt-5.6-terra'));
  check('GPT-5.6 uses the reasoning-aware Responses API',
    usesResponsesApi('gpt-5.6-luna') && usesResponsesApi('gpt-5.6-terra'));
  check('GPT-4o keeps its proven Chat Completions path', !usesResponsesApi('gpt-4o-mini'));

  const luna = PROVIDERS.openai.models.find((model) => model.id === 'gpt-5.6-luna');
  check('estimate uses list prices',
    Math.abs(estimateUsd(luna, 1_000) - (145_000 * 0.2 + 50_000 * 1.2) / 1_000_000) < 1e-9);
}

console.log('\nreasoning-model request contracts');
{
  const originalFetch = globalThis.fetch;
  const seen = new Map<string, Record<string, unknown>>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    seen.set(url, body);
    if (url.endsWith('/responses')) {
      const input = body['input'] as { content?: { type?: string; text?: string }[] }[] | undefined;
      const userText = input?.flatMap((message) => message.content ?? [])
        .find((part) => part.type === 'input_text')?.text ?? '';
      // Mirror the provider's validation so this exact regression fails locally instead
      // of waiting for a real key test to discover it.
      if (!/json/i.test(userText)) {
        return new Response(JSON.stringify({
          error: { message: "Response input messages must contain the word 'json'." },
        }), { status: 400 });
      }
      return new Response(JSON.stringify({
        output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }],
        usage: { input_tokens: 7, output_tokens: 5 },
      }));
    }
    return new Response(JSON.stringify({ error: { message: `Unexpected URL ${url}` } }), { status: 404 });
  }) as typeof fetch;

  try {
    const request = { system: 'Return JSON.', user: 'Classify this.', maxTokens: 64 };
    const openaiResult = await PROVIDERS.openai.chat(request, 'test-key', 'gpt-5.6-luna');
    const openaiBody = seen.get('https://api.openai.com/v1/responses');
    const openaiReasoning = openaiBody?.['reasoning'] as Record<string, unknown> | undefined;

    check('GPT-5.6 request uses low reasoning', openaiReasoning?.['effort'] === 'low');
    const openaiInput = openaiBody?.['input'] as { content?: { text?: string }[] }[] | undefined;
    check('GPT-5.6 JSON mode is declared in the user input',
      /json/i.test(openaiInput?.[0]?.content?.[0]?.text ?? ''));
    check('GPT-5.6 response storage is disabled', openaiBody?.['store'] === false);
    check('GPT-5.6 reserves room beyond hidden reasoning', openaiBody?.['max_output_tokens'] === 256);
    check('GPT-5.6 output and usage are parsed',
      openaiResult.text === '{"ok":true}' && openaiResult.usage.outputTokens === 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

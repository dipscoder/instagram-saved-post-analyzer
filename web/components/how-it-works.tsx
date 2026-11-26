'use client';

import { ArrowLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Mark } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { fetchPipelineStats, fetchWalkthrough, PIPELINE, type PipelineStats, type Walkthrough } from '@/lib/pipeline';
import { cn } from '@/lib/utils';

const P = PIPELINE.price;

function n(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString();
}

/** A list price: two decimals, or as many as a smaller one needs. */
function rate(value: number): string {
  return `$${value >= 0.1 ? value.toFixed(2) : String(value)}`;
}

function usd(value: number): string {
  return value > 0 && value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`;
}

/**
 * How organising works: the path a saved post takes from Instagram to the search box, drawn
 * as one diagram with the user's own library counted at each stop, then what organising
 * again does, one of their posts taken apart, the prices and the guardrails.
 */
export function HowItWorks() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [example, setExample] = useState<Walkthrough | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPipelineStats().then(setStats, (e: Error) => setError(e.message));
    fetchWalkthrough().then(setExample, () => setExample(null));
  }, []);

  const organised = stats ? stats.total - stats.notIndexed : null;
  const sure = Math.round(PIPELINE.minProbability * 100);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Mark />
          <span className="max-sm:hidden">Saved Index</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-24 pt-10 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Library
        </Link>
        <p className="mt-8 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">Under the hood</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">How organising works</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          The extension collects your saves. When you press Organise, the server files each one under a topic, writes a short
          summary and makes it searchable by meaning. The numbers are your own library, counted just now.
        </p>
        {error && <p className="mt-4 text-sm text-destructive">Couldn’t count your library: {error}</p>}

        <dl className="mt-8 grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-4">
          <Stat label="Saved posts" value={n(stats?.total)} />
          <Stat label="Organised" value={n(organised)} />
          <Stat label="Searchable by meaning" value={n(stats?.searchable)} />
          <Stat label="Spent, all time" value={stats ? usd(stats.spentUsd) : '—'} />
        </dl>

        <Section title="The path of a post" lead="Three places, top to bottom. Only the steps marked AI or with a price cost anything.">
          <Diagram stats={stats} />
        </Section>

        <Section title="Each step, in a sentence or two" lead="What the diagram leaves out.">
          <dl className="divide-y overflow-hidden rounded-lg border text-[14px]">
            {details(stats).map((d) => (
              <div key={d.title} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
                <dt className="font-medium">{d.title}</dt>
                <dd className="leading-relaxed text-muted-foreground">{d.body}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Organising again" lead="Every choice lives in the Organise menu beside the page title, and shows its price first.">
          <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
            <Guard title="Organise new posts">Only posts never organised. The everyday button.</Guard>
            <Guard title="Ask the AI again">
              Every post in Needs a category is read afresh; the ones it is now sure of move to a category. Posts you put
              there yourself stay.
            </Guard>
            <Guard title="Re-organise all">
              Every post is read afresh and gets a new category, summary and tags. Categories you chose by hand are kept.
            </Guard>
            <Guard title="One post">
              Open a post and press Organise again. Useful after you notice a single wrong answer.
            </Guard>
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Or don’t spend at all: Change category in a post is free, and Sort them one by one goes through Needs a category with
            the AI’s suggestions, one press each.
          </p>
        </Section>

        <Section title="Follow one of your posts" lead="Your most recently saved post the AI filed, taken apart.">
          {example === undefined ? (
            <div className="h-48 animate-pulse rounded-lg bg-muted" />
          ) : example === null ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Organise a few posts and one of them appears here.
            </p>
          ) : (
            <WalkthroughView w={example} />
          )}
        </Section>

        <Section title="What it costs" lead="List prices, paid from the app’s OpenAI account. Nothing is spent until you confirm the quote.">
          <div className="overflow-hidden rounded-lg border text-[13px]">
            <PriceRow what="Keyword rules, search, Change category, Sort one by one" price="Free" />
            <PriceRow what={`Choosing a category (${PIPELINE.decisionsModel})`} price={`${rate(P.decisionsInput)} per million tokens read`} />
            <PriceRow
              what={`Summary and tags (${PIPELINE.summaryModel})`}
              price={`${rate(P.summaryInput)} read · ${rate(P.summaryOutput)} written, per million tokens`}
            />
            <PriceRow what={`Search by meaning (${PIPELINE.embeddingModel})`} price={`${rate(P.embeddings)} per million tokens`} />
            <PriceRow what={`Reel transcripts (${PIPELINE.transcribeModel})`} price={`$${P.transcribePerMinute} per minute of audio`} />
            <PriceRow what="A typical post, all steps" price="about $0.0002" strong />
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            A token is roughly ¾ of a word. Posts go {PIPELINE.batchSize} at a time and share one set of instructions, which
            is why it is cheap. Quotes show the most a run can cost, so the real bill is usually lower.
          </p>
        </Section>

        <Section title="Guardrails" lead="What keeps it accurate, and the bill honest.">
          <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
            <Guard title="No category over a guess">
              Under {sure}% likely, a post goes to Needs a category with the AI’s best guesses as suggestions. A wrong category
              hides a post where you would never look. A close call between two goes under both.
            </Guard>
            <Guard title="Quote, then confirm">
              Every run shows its most possible cost and spends nothing until a second press. Stop ends it after the current
              batch.
            </Guard>
            <Guard title="Paid once">
              An organised post is never sent again unless you ask. A batch sent twice by a flaky connection is billed once.
            </Guard>
            <Guard title="Your choices stick">
              A category you pick by hand beats every AI answer, and no bulk run replaces it.
            </Guard>
            <Guard title="A daily cap">
              The server refuses new work once the day’s spend reaches the cap, and the run stops with a clear message.
            </Guard>
            <Guard title="Failures are counted">
              A post that can’t be organised records why. After three tries it waits for you instead of being billed again.
            </Guard>
          </div>
        </Section>
      </main>
    </div>
  );
}

/** One stop on the diagram. */
function Node({ title, note, stat, cost, muted }: { title: string; note: string; stat?: string; cost?: string; muted?: boolean }) {
  return (
    <div className={cn('min-w-0 flex-1 rounded-lg border bg-background px-3 py-2.5', muted && 'border-dashed')}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium">{title}</p>
        {cost && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{cost}</span>}
      </div>
      <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{note}</p>
      {stat && <p className="mt-1.5 font-mono text-[11px] tabular-nums text-foreground">{stat}</p>}
    </div>
  );
}

/** The arrow between stops: across on a wide screen, down on a phone. */
function Arrow() {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center text-muted-foreground/60 max-md:h-4 md:w-4">
      <ChevronRight className="size-4 max-md:rotate-90" />
    </span>
  );
}

function Lane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">{label}</p>
      <div className="flex gap-1 max-md:flex-col md:items-center">{children}</div>
    </div>
  );
}

/** The lanes stack, joined by a short line, so the eye reads them as one path. */
function Join() {
  return <span aria-hidden className="mx-auto block h-4 w-px bg-border" />;
}

/**
 * The whole path as one picture: collect in the browser, organise on the server, search in
 * the database. The decision splits in two, because where a post ends up depends on how
 * sure the AI is.
 */
function Diagram({ stats }: { stats: PipelineStats | null }) {
  const sure = Math.round(PIPELINE.minProbability * 100);
  const count = (v: number | null | undefined, what: string) => (stats && v != null ? `${n(v)} ${what}` : undefined);
  return (
    <figure aria-label="How a saved post is organised">
      <Lane label="In your browser · when you press Find new posts">
        <Node title="Instagram" note="Your saved feed, scrolled in a visible tab" />
        <Arrow />
        <Node title="Extension" note="Reads what Instagram already sends: caption, hashtags, alt text, reel or not" cost="free" />
        <Arrow />
        <Node title="Your account" note="Each post and a small picture of it" stat={count(stats?.total, 'posts')} />
      </Lane>
      <Join />
      <Lane label="On the server · when you press Organise">
        <Node title="Keyword rules" note="Files a post when one category clearly wins" cost="free" stat={count(stats?.byRules, 'filed')} />
        <Arrow />
        <Node title="Listen" note="A reel’s words, written down once" cost={`$${P.transcribePerMinute}/min`} stat={count(stats?.transcribed, 'reels')} />
        <Arrow />
        <Node title="Decide + Describe" note={`${PIPELINE.decisionsModel} picks a category; ${PIPELINE.summaryModel} writes a summary and tags`} cost="AI" />
        <Arrow />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Node title={`Sure (≥ ${sure}%)`} note="Filed under a category, and Also in a second when it fits" stat={count(stats?.byModel, 'by the AI')} />
          <Node title="Not sure" note="Needs a category, with suggestions for you to confirm" stat={count(stats?.unsure, 'waiting')} muted />
        </div>
        <Arrow />
        <Node title="Embed" note={`${PIPELINE.embeddingDimensions} numbers that place it on a map of meaning`} cost="AI" stat={count(stats?.searchable, 'searchable')} />
      </Lane>
      <Join />
      <Lane label="When you search">
        <Node title="By words" note="Handle, caption, summary and tags" cost="free" />
        <span aria-hidden className="flex shrink-0 items-center justify-center font-mono text-[13px] text-muted-foreground/60 max-md:h-4 md:w-4">+</span>
        <Node title="By meaning" note="“quick dinner” also finds “sheet-pan chicken”" cost="free" />
        <Arrow />
        <Node title="One list" note="Both rankings merged, best match first" />
      </Lane>
    </figure>
  );
}

/** The detail behind each stop, kept to a sentence or two. */
function details(stats: PipelineStats | null): { title: string; body: ReactNode }[] {
  const sure = Math.round(PIPELINE.minProbability * 100);
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  return [
    {
      title: 'Collect',
      body: 'The extension only reads responses Instagram already sends your browser. It never calls Instagram itself and never talks to a model.',
    },
    {
      title: 'Keyword rules',
      body: (
        <>
          Each category has its own hashtags and words, like <Code>#recipe</Code>. A post is filed free only when one category
          is well ahead of every other; anything closer goes to the AI.
        </>
      ),
    },
    {
      title: 'Listen',
      body: 'For a reel, what is said is usually the best clue. The server fetches its smallest version from Instagram’s servers and transcribes it once. Reels over ten minutes are skipped.',
    },
    {
      title: 'Decide + Describe',
      body: (
        <>
          Up to {PIPELINE.batchSize} posts go together, as a few short lines each. A post with almost no words also sends its
          picture. One model picks one of {PIPELINE.categories} categories and how likely it is; another, at the same moment,
          writes the summary and tags.
        </>
      ),
    },
    {
      title: 'Also in',
      body: (
        <>
          Plenty of posts are about two things, like a funny reel about a dating app. When a second category is at least{' '}
          {pct(PIPELINE.alsoProbability)} likely, the post shows up there too. And when the AI is torn between two (each at
          least {pct(PIPELINE.splitEach)}, together {pct(PIPELINE.splitTotal)} or more), it files the post under both rather
          than neither, so you find it from either side.
        </>
      ),
    },
    {
      title: 'Not sure',
      body: (
        <>
          Below {sure}%, and not split between two, the post gets no category but keeps the AI’s likeliest ones as suggestions.
          {stats && stats.unsure > 0 ? ` ${n(stats.unsure)} of yours are waiting in Needs a category.` : ''} Confirming one is a
          single press, and free.
        </>
      ),
    },
    {
      title: 'Embed',
      body: 'The summary, category and tags, then the post’s own words, become a list of numbers. Posts about the same thing sit close together even when they share no words.',
    },
    {
      title: 'Search',
      body: 'Your query runs by words and by meaning at once, and the two rankings are merged, so an exact handle still comes first.',
    },
  ];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-r p-4 last:border-r-0 max-sm:[&:nth-child(2)]:border-r-0 sm:border-b-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xl tabular-nums tracking-tight">{value}</dd>
    </div>
  );
}

function Section({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <section className="mt-16">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{lead}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

const PATH_LABEL: Record<Walkthrough['path'], string> = {
  rules: 'Filed free by the keyword rules',
  text: 'Filed from its words, in a batch',
  picture: 'Filed from its words and its picture',
  you: 'Filed by you',
};

function WalkthroughView({ w }: { w: Walkthrough }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5 text-[13px]">
        <span className="font-medium">@{w.handle.replace(/^@/, '')}</span>
        <span className="text-muted-foreground">{PATH_LABEL[w.path]}</span>
      </div>

      <Panel label="1 · What the model was sent">
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-[12px] leading-relaxed">
          {w.modelInput}
        </pre>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {w.ruleCategory ? `The keyword rules matched ${w.ruleCategory}.` : 'No keyword rule matched, so it went to the model.'}
        </p>
      </Panel>

      <Panel label="2 · What came back">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-[13px]">
          <dt className="text-muted-foreground">Category</dt>
          <dd className="font-medium">
            {w.category ?? 'No category'}
            {w.subcategory && <span className="font-normal text-muted-foreground"> · {w.subcategory}</span>}
          </dd>
          <dt className="text-muted-foreground">Summary</dt>
          <dd>{w.summary ?? '—'}</dd>
          <dt className="text-muted-foreground">Tags</dt>
          <dd className="flex flex-wrap gap-1.5">
            {w.tags.length
              ? w.tags.map((t) => (
                  <span key={t} className="rounded-full border px-2 py-px text-[12px] text-muted-foreground">
                    {t}
                  </span>
                ))
              : '—'}
          </dd>
        </dl>
      </Panel>

      <Panel label="3 · What search remembers" last>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-[12px] leading-relaxed">
          {w.embedded}
        </pre>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {w.isEmbedded
            ? `Turned into ${PIPELINE.embeddingDimensions} numbers and stored with the post.`
            : 'Not embedded yet: Improve search adds it, for a fraction of a cent.'}
        </p>
      </Panel>
    </div>
  );
}

function Panel({ label, last, children }: { label: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={cn('px-4 py-4', !last && 'border-b')}>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">{label}</p>
      {children}
    </div>
  );
}

function PriceRow({ what, price, strong }: { what: string; price: string; strong?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b px-4 py-2.5 last:border-b-0', strong && 'bg-muted/40')}>
      <span className={strong ? 'font-medium' : 'text-muted-foreground'}>{what}</span>
      <span className={cn('font-mono text-[12px] tabular-nums', strong && 'font-medium')}>{price}</span>
    </div>
  );
}

function Guard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-background p-4">
      <p className="text-[13px] font-medium">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-px font-mono text-[12px] text-foreground">{children}</code>;
}

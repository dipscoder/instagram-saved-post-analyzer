'use client';

import { ArrowLeft } from 'lucide-react';
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
 * "How indexing works": the pipeline a saved post goes through, with the user's own
 * library counted at each stage and one of their posts taken apart step by step.
 */
export function HowItWorks() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [example, setExample] = useState<Walkthrough | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPipelineStats().then(setStats, (e: Error) => setError(e.message));
    fetchWalkthrough().then(setExample, () => setExample(null));
  }, []);

  const indexed = stats ? stats.total - stats.notIndexed : null;

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

      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Library
        </Link>
        <p className="mt-8 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">Under the hood</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">How indexing works</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          What happens to a saved post between Instagram and your search box. Every number here is your own library, counted
          just now.
        </p>
        {error && <p className="mt-4 text-sm text-destructive">Couldn’t count your library: {error}</p>}

        <dl className="mt-8 grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-4">
          <Stat label="Saved posts" value={n(stats?.total)} />
          <Stat label="Indexed" value={n(indexed)} />
          <Stat label="Searchable by meaning" value={n(stats?.searchable)} />
          <Stat label="Spent, all time" value={stats ? usd(stats.spentUsd) : '—'} />
        </dl>

        <Section title="The pipeline" lead="The steps a post meets, in order. Only the model steps cost anything.">
          <ol className="relative">
            {steps(stats).map((step, i, all) => (
              <Step key={step.title} n={i + 1} title={step.title} where={step.where} stat={step.stat} last={i === all.length - 1}>
                {step.body}
              </Step>
            ))}
          </ol>
        </Section>

        <Section title="Follow one of your posts" lead="Your most recently saved post the model filed, taken apart.">
          {example === undefined ? (
            <div className="h-48 animate-pulse rounded-lg bg-muted" />
          ) : example === null ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Index a few posts and one of them appears here.
            </p>
          ) : (
            <WalkthroughView w={example} />
          )}
        </Section>

        <Section title="What it costs" lead="List prices, paid from the app’s OpenAI account. Nothing is spent until you confirm the quote.">
          <div className="overflow-hidden rounded-lg border text-[13px]">
            <PriceRow what={stats?.byYou != null ? 'Keyword rules, search, fixing a category' : 'Keyword rules and search'} price="Free" />
            <PriceRow what={`Choosing a category (${PIPELINE.decisionsModel})`} price={`${rate(P.decisionsInput)} per million tokens read`} />
            <PriceRow
              what={`Summary and tags (${PIPELINE.summaryModel})`}
              price={`${rate(P.summaryInput)} read · ${rate(P.summaryOutput)} written, per million tokens`}
            />
            <PriceRow what={`Search by meaning (${PIPELINE.embeddingModel})`} price={`${rate(P.embeddings)} per million tokens`} />
            {stats?.transcribed != null && (
              <PriceRow what={`Reel transcripts (${PIPELINE.transcribeModel})`} price={`$${P.transcribePerMinute} per minute of audio`} />
            )}
            <PriceRow what="A typical post, all steps" price="about $0.0002" strong />
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            A token is roughly ¾ of a word. A batch of 25 shares one set of instructions, which is why batching
            is cheap.
          </p>
        </Section>

        <Section title="Guardrails" lead="The rules that keep it accurate and keep the bill honest.">
          <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
            <Guard title="Paid once">
              Every answer is kept with a fingerprint of what the model read. The same post is never paid for twice, even
              across browsers.
            </Guard>
            <Guard title="Unknown over a guess">
              A category under {Math.round(PIPELINE.minProbability * 100)}% likely is not used. You decide those, from Needs a
              look.
            </Guard>
            <Guard title="Quote, then confirm">
              Index shows the most a run can cost and spends nothing until the second press. Stop ends it after the current
              batch.
            </Guard>
            <Guard title="A daily cap">
              The server refuses new work once the day’s spend reaches the cap, and the run stops with a clear message.
            </Guard>
            {stats?.byYou != null && (
              <Guard title="Your fixes stick">
                A category you choose by hand beats every model answer, and nothing files the post over it again.
              </Guard>
            )}
            {stats?.failed != null && (
              <Guard title="Failures are counted">
                A post that cannot be indexed records why. After three tries it waits for you instead of being billed again.
              </Guard>
            )}
          </div>
        </Section>
      </main>
    </div>
  );
}

interface StepDef {
  title: string;
  where: string;
  stat?: [string, string];
  body: ReactNode;
}

/** The pipeline as this account's database runs it: a step whose migration has not run is left out. */
function steps(stats: PipelineStats | null): StepDef[] {
  const reels = stats?.transcribed != null;
  const list: (StepDef | false)[] = [
    {
      title: 'Collect',
      where: 'Extension · your browser',
      stat: [n(stats?.total), 'posts collected'],
      body: (
        <>
          When you press Find new posts, the extension scrolls your saved feed in a visible tab and reads the answers
          Instagram is already sending your browser: handle, caption, hashtags, alt text, whether it is a reel. It never calls
          Instagram itself, and nothing goes to a model. Each post and a small picture of it sync to your account.
        </>
      ),
    },
    {
      title: 'Keyword rules',
      where: 'Free · instant',
      stat: [n(stats?.byRules), 'filed by rules'],
      body: (
        <>
          Every category has its own hashtags and keywords, such as <Code>#recipe</Code> or <Code>#hypertrophy</Code>. A post
          is filed for nothing only when one category wins clearly, well ahead of every other; anything closer goes on to the
          model. Who posted it is ignored, so a food account’s travel post is not filed as food.
        </>
      ),
    },
    reels && {
      title: 'Listen',
      where: `${PIPELINE.transcribeModel} · $${P.transcribePerMinute} a minute`,
      stat: [n(stats?.transcribed), `of ${n(stats?.reels)} reels transcribed`],
      body: (
        <>
          For a reel, what is said in it is usually the best clue. The server downloads the reel’s smallest version from
          Instagram’s own servers and writes down the words, once. Reels over ten minutes are skipped.
        </>
      ),
    },
    {
      title: 'Read',
      where: 'What the model sees',
      stat: [n(stats?.withPicture), 'with a picture stored'],
      body: (
        <>
          Each post becomes a few short lines: the handle, the first 400 characters of the caption, up to twelve hashtags and
          the alt text{reels ? ', and for a reel the opening of its transcript' : ''}. A post with fewer than six words and no
          alt text also sends its picture, because there is nothing else to go on.
        </>
      ),
    },
    {
      title: 'Decide',
      where: `${PIPELINE.decisionsModel} · Decisions API`,
      stat: [n(stats?.byModel), 'filed by the model'],
      body: (
        <>
          Up to {PIPELINE.batchSize} posts go together. For each one the model picks one of {PIPELINE.categories} categories,
          or Unknown, and says how likely it is. Below {Math.round(PIPELINE.minProbability * 100)}% the post is filed as Unknown
          instead: a wrong category hides a post where you would never look, while Unknown keeps it in To review.
          {stats && stats.unsure > 0 && ` ${n(stats.unsure)} of your posts are there now.`}
        </>
      ),
    },
    {
      title: 'Describe',
      where: `${PIPELINE.summaryModel} · at the same time`,
      body: (
        <>
          A second model, sent the same posts at the same moment, writes a one-line summary, up to four tags and a
          subcategory. The subcategory is kept only if it belongs to the category the first model chose.
        </>
      ),
    },
    {
      title: 'Embed',
      where: `${PIPELINE.embeddingModel} · ${PIPELINE.embeddingDimensions} numbers`,
      stat: [n(stats?.searchable), 'searchable by meaning'],
      body: (
        <>
          The summary, category and tags come first, then the post’s own words. All of it is turned into{' '}
          {PIPELINE.embeddingDimensions} numbers that place the post on a map of meaning, near posts about the same thing even
          when they share no words.
        </>
      ),
    },
    {
      title: 'Search',
      where: 'Free · in your database',
      body: (
        <>
          Your search runs two ways at once: by words, weighted toward the summary and tags, and by meaning, comparing your
          query’s numbers with every post’s. The two rankings are merged, so an exact handle still comes first and “quick
          dinner” also finds “sheet-pan harissa chicken”.
        </>
      ),
    },
  ];
  return list.filter((s): s is StepDef => s !== false);
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

function Step({
  n: index,
  title,
  where,
  stat,
  last,
  children,
}: {
  n: number;
  title: string;
  where: string;
  stat?: [string, string];
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-4 pb-8 last:pb-0">
      {!last && <span aria-hidden className="absolute left-[13px] top-8 bottom-0 w-px bg-border" />}
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-[12px] tabular-nums">
        {index}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-[15px] font-medium">
            {title}
            <span className="ml-2 text-[12px] font-normal text-muted-foreground">{where}</span>
          </h3>
          {stat && (
            <span className="text-[12px] text-muted-foreground">
              <span className="font-mono text-[13px] tabular-nums text-foreground">{stat[0]}</span> {stat[1]}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
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
            {w.category ?? 'Unknown'}
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
            : 'Not embedded yet: the next Index run adds it, for a fraction of a cent.'}
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

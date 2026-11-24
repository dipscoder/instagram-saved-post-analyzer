'use client';

import { needsTranscript } from '@saved-index/shared/transcript';
import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { fetchPost, type Post, type PostDetails } from '@/lib/library';
import { indexOne, oneQuoteUsd, priceLabel } from '@/lib/sorting';

/**
 * Indexes one post from its panel, with its price in view.
 *
 * A post never indexed gets an Index this post button: one press, since one post costs a
 * fraction of a cent. A filed post gets Index again, beside Change category, which replaces
 * an answer already paid for (or the user's own choice), so it asks first.
 *
 * Renders as items of the panel's button row: the note, the question and any error take
 * a full line of their own below it.
 */
export function IndexPost({
  post,
  details,
  onIndexed,
}: {
  post: Post;
  /** Null while the panel is still reading it, and for a filed post that is not a reel. */
  details: PostDetails | null;
  /** The post as the server now holds it, filed or with the reason it could not be. */
  onIndexed: (post: Post) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const filed = post.categorized_at !== null;
  // A reel, or a post not indexed yet, is priced and labelled from its details.
  const ready = details !== null || (filed && !post.is_video);
  const givenUp = (details?.indexAttempts ?? 0) >= 3;
  const reel = { is_video: post.is_video, video_url: details?.videoUrl ?? null, transcribed_at: details?.transcribedAt ?? null, duration_sec: post.duration_sec };
  const listens = needsTranscript(reel);
  const price = priceLabel(oneQuoteUsd(reel));
  const note = `${price[0]!.toUpperCase()}${price.slice(1)}${listens ? ', including listening to the reel' : ''}.`;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      // The keyword rules may file a new post for free; anything else goes to the model.
      const ok = await indexOne(post.shortcode, filed || givenUp);
      const fresh = await fetchPost(post.shortcode);
      if (fresh) onIndexed(fresh);
      setAsking(false);
      if (!ok) setError('Couldn’t index this post this time.');
      else if (fresh?.category && fresh.category !== 'Uncategorized') toast(`Indexed as ${fresh.category}`);
      else toast('Indexed. The AI wasn’t sure, so it stays in To review.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const spinner = running && <Loader2 className="animate-spin" />;
  const errorLine = error && <p className="order-last basis-full text-[12px] text-destructive">{error}</p>;

  if (!filed) {
    return (
      <>
        <Button size="sm" onClick={() => void run()} disabled={!ready || running}>
          {spinner || <Sparkles />}
          {running ? (listens ? 'Listening and indexing…' : 'Indexing…') : givenUp ? 'Try again' : 'Index this post'}
        </Button>
        {ready && !error && <p className="order-last basis-full text-[12px] text-muted-foreground">{note}</p>}
        {errorLine}
      </>
    );
  }

  const again = (
    <Tooltip label="Ask the AI to file it again">
      <Button variant="outline" size="sm" className="order-1" onClick={() => setAsking(true)} disabled={asking || running}>
        <Sparkles />
        Index again
      </Button>
    </Tooltip>
  );
  if (!asking && !running && !error) return again;

  const close = () => {
    setError(null);
    setAsking(false);
  };
  return (
    <>
      {again}
      <div className="order-last basis-full rounded-lg border p-3 text-[13px]">
        <p className="font-medium">Index this post again?</p>
        <p className="mt-0.5 text-muted-foreground">
          {post.model_used === 'you'
            ? 'The AI reads it afresh and replaces the category you chose, along with its summary and tags.'
            : 'The AI reads it afresh and replaces its category, summary and tags.'}{' '}
          {ready ? note : ''}
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => void run()} disabled={!ready || running}>
            {spinner}
            {running ? 'Indexing…' : 'Yes, index again'}
          </Button>
          <Button size="sm" variant="ghost" onClick={close} disabled={running}>
            {error ? 'Close' : 'Cancel'}
          </Button>
        </div>
        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      </div>
    </>
  );
}

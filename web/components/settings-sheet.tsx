'use client';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { clearLibrary, fetchSpend, type Spend } from '@/lib/account';
import { countCorrections, downloadCorrections } from '@/lib/corrections';
import type { Facets } from '@/lib/library';
import { supabase } from '@/lib/supabase';

function usd(n: number): string {
  return n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
}

/** Account, spend and the one destructive action: everything the extension used to hold. */
export function SettingsSheet({
  open,
  onOpenChange,
  session,
  facets,
  onCleared,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  facets: Facets | null;
  onCleared: () => void;
}) {
  const [spend, setSpend] = useState<Spend | null>(null);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const [corrections, setCorrections] = useState<number | null>(null);
  const [correctionsError, setCorrectionsError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfirming(false);
    setClearError(null);
    setCleared(false);
    fetchSpend().then(setSpend, (e: Error) => setSpendError(e.message));
    countCorrections().then(setCorrections, () => setCorrections(null));
  }, [open]);

  const total = facets?.total ?? 0;
  const indexed = facets ? facets.total - facets.unsorted : 0;

  async function clear() {
    setClearing(true);
    setClearError(null);
    try {
      await clearLibrary(session.user.id);
      setConfirming(false);
      setCleared(true);
      onCleared();
    } catch (e) {
      setClearError((e as Error).message);
    } finally {
      setClearing(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <div className="flex-1 overflow-y-auto p-6">
          <SheetTitle className="text-lg font-semibold tracking-tight">Settings</SheetTitle>
          <SheetDescription className="sr-only">Your account, what indexing has cost, and clearing your library.</SheetDescription>

          <Section title="Account">
            <Row label="Signed in as" value={session.user.email ?? ''} />
            <div className="pt-3">
              <Button variant="outline" size="sm" onClick={() => void supabase.auth.signOut()}>
                Sign out
              </Button>
            </div>
          </Section>

          <Section title="Library">
            <Row label="Posts" value={total.toLocaleString()} />
            <Row label="Indexed" value={indexed.toLocaleString()} />
            <p className="pt-2 text-[13px] leading-relaxed text-muted-foreground">
              New posts come from the Saved Index extension. Open your saved posts on Instagram and press Find new posts.
            </p>
          </Section>

          <Section title="Spend">
            {spendError ? (
              <p className="text-[13px] text-destructive">{spendError}</p>
            ) : (
              <>
                <Row label="This month" value={spend ? usd(spend.monthUsd) : '…'} />
                <Row label="All time" value={spend ? `${usd(spend.usd)} · ${spend.posts.toLocaleString()} posts` : '…'} />
              </>
            )}
          </Section>

          <Section title="Corrections">
            <Row label="Categories you fixed" value={corrections === null ? '…' : corrections.toLocaleString()} />
            <p className="pt-2 text-[13px] leading-relaxed text-muted-foreground">
              Each fix is a real mistake to measure filing against. Download them to run the accuracy eval on your own posts.
            </p>
            <div className="pt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={!corrections}
                onClick={() => downloadCorrections().catch((e: Error) => setCorrectionsError(e.message))}
              >
                Download corrections
              </Button>
            </div>
            {correctionsError && <p className="pt-2 text-[13px] text-destructive">{correctionsError}</p>}
          </Section>

          <Section title="Clear library">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Erases every post, picture, collection, AI summary and correction in your account, and in each browser running the
              extension the next time it syncs. You can then find and index from scratch. Indexing is paid again, and
              your spend record is kept.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-3">
              {confirming ? (
                <>
                  <Button variant="destructive" size="sm" disabled={clearing} onClick={() => void clear()}>
                    {clearing ? 'Clearing…' : `Erase ${total.toLocaleString()} posts and ${indexed.toLocaleString()} summaries`}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={clearing} onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" className="text-destructive" disabled={total === 0} onClick={() => setConfirming(true)}>
                  Clear library
                </Button>
              )}
            </div>
            {cleared && <p className="pt-2 text-[13px]">Library cleared.</p>}
            {clearError && <p className="pt-2 text-[13px] text-destructive">{clearError}</p>}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 border-t pt-5">
      <h2 className="mb-2 text-[13px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate tabular-nums">{value}</span>
    </div>
  );
}

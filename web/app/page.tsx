'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Library } from '@/components/library';
import { SignIn } from '@/components/sign-in';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  // Undefined while the stored session is read: render nothing rather than flash sign-in.
  if (session === undefined) return null;
  return session ? <Library session={session} /> : <SignIn />;
}

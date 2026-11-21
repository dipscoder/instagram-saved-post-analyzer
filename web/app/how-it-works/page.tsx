'use client';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { HowItWorks } from '@/components/how-it-works';
import { SignIn } from '@/components/sign-in';
import { supabase } from '@/lib/supabase';

export default function HowItWorksPage() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  return session ? <HowItWorks /> : <SignIn />;
}

'use client';

import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';

/** What every page shares: tooltips that know about each other, and one toast at a time. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>{children}</ToastProvider>
    </TooltipProvider>
  );
}

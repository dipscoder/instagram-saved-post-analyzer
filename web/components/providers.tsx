'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * What every page shares: tooltips that know about each other, one toast at a time, and
 * motion that steps aside for anyone who asked their system for less of it.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}

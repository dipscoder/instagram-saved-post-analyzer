'use client';

import * as Radix from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

/** One provider for the page, so moving between icons shows the next tip at once. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Radix.Provider delayDuration={300} skipDelayDuration={200}>
      {children}
    </Radix.Provider>
  );
}

/**
 * A few words on hover or focus: what a control does, and its shortcut when it has one.
 * Never instructions; anything longer belongs on the page.
 */
export function Tooltip({ label, shortcut, side = 'bottom', children }: { label: string; shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactElement }) {
  return (
    <Radix.Root>
      {/* Focus from the keyboard shows the tip; focus a dialog or menu moves by itself does not. */}
      <Radix.Trigger asChild onFocus={(e) => !e.currentTarget.matches(':focus-visible') && e.preventDefault()}>
        {children}
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          side={side}
          sideOffset={6}
          className="z-[60] flex items-center gap-2 rounded-md bg-foreground px-2 py-1 text-[12px] text-background shadow-md data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          {label}
          {shortcut && <kbd className="font-mono text-[10px] opacity-60">{shortcut}</kbd>}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Sheet = Dialog.Root;
export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;

/** A panel that slides in from the right, over a dimmed page. */
export function SheetContent({ className, children, ...props }: ComponentProps<typeof Dialog.Content> & { children: ReactNode }) {
  // Pressing Undo on a toast is not a click outside the panel: the panel stays open.
  const keepOpenFor = (e: { target: EventTarget | null; preventDefault: () => void }) => {
    if (e.target instanceof Element && e.target.closest('[data-toast]')) e.preventDefault();
  };
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <Dialog.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-xl outline-none sm:max-w-md',
          'data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
          className,
        )}
        onPointerDownOutside={keepOpenFor}
        onInteractOutside={keepOpenFor}
        // Focus the panel, not its first button: the arrow keys work at once, and nothing
        // inside lights up or opens a tip before the user has touched it.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus({ preventScroll: true });
        }}
        {...props}
      >
        {children}
        <Dialog.Close className="absolute right-3 top-3 rounded-md bg-background/80 p-1.5 text-muted-foreground backdrop-blur hover:bg-accent hover:text-foreground">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

import { cn } from '@/lib/utils';

/** The Notch mark: a solid tile with a bookmark notch cut from its foot. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('size-5', className)}>
      <path
        fill="currentColor"
        d="M5 2.5h14a1.5 1.5 0 0 1 1.5 1.5v17.2a.6.6 0 0 1-.97.47L12 15.9l-7.53 5.77a.6.6 0 0 1-.97-.47V4A1.5 1.5 0 0 1 5 2.5Z"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
      <Mark />
      Saved Index
    </span>
  );
}

'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

const ToastContext = createContext<(message: string, action?: Toast['action']) => void>(() => {});

/** Says what just happened, at the bottom of the screen, with an undo where there is one. */
export function useToast() {
  return useContext(ToastContext);
}

const VISIBLE_MS = 6_000;

/** One toast at a time: a new one replaces the last, which is never what you are reading. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const next = useRef(0);

  const show = useCallback((message: string, action?: Toast['action']) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: ++next.current, message, action });
    timer.current = setTimeout(() => setToast(null), VISIBLE_MS);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
        {toast && (
          <div
            key={toast.id}
            data-toast
            className="pointer-events-auto flex items-center gap-4 rounded-lg bg-foreground py-2.5 pl-4 pr-2 text-[13px] text-background shadow-lg animate-in fade-in-0 slide-in-from-bottom-2"
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                data-toast
                onClick={() => {
                  toast.action?.run();
                  setToast(null);
                }}
                className="rounded-md px-2 py-1 font-medium underline-offset-2 hover:underline"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

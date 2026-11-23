'use client';

import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

export function ThemeToggle() {
  function toggle() {
    const dark = document.documentElement.classList.toggle('dark');
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      // Private windows can refuse storage; the toggle still works for this visit.
    }
  }
  return (
    <Tooltip label="Light or dark">
      <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle dark mode">
        <Sun className="hidden dark:block" />
        <Moon className="dark:hidden" />
      </Button>
    </Tooltip>
  );
}

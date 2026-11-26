import { useEffect, useState } from 'react';

/**
 * False for a moment after a confirm step appears, then true. A confirm button that spends
 * money is disabled until then, so the second click of a double-click on the button that
 * asked can never land on it.
 */
export function useArmed(ms = 500): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return armed;
}

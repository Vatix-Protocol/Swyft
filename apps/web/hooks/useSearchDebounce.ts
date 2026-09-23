'use client';

import { useState, useEffect } from 'react';

/**
 * Debounces a search string so that rapid keystrokes do not trigger an API
 * call on every character.  The returned `debouncedValue` only updates after
 * the caller has stopped typing for `delay` milliseconds (default 300 ms).
 *
 * Usage:
 *   const debouncedSearch = useSearchDebounce(rawInput);
 *   // pass debouncedSearch to usePools / useTokens instead of rawInput
 */
export function useSearchDebounce(value: string, delay = 300): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

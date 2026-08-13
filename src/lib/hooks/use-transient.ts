"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_MS = 3000;

function useTimeouts() {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
}

/**
 * A confirmation that shows for `ms` and then clears itself — the
 * "Announcement sent!" / "Company created!" pattern.
 *
 * Repeated triggers each get their own timer rather than resetting a shared
 * one, which is what the pages did before this was extracted.
 */
export function useTransientFlag(ms = DEFAULT_MS): [boolean, () => void] {
  const [shown, setShown] = useState(false);
  const schedule = useTimeouts();

  const trigger = useCallback(() => {
    setShown(true);
    schedule(() => setShown(false), ms);
  }, [ms, schedule]);

  return [shown, trigger];
}

/** As `useTransientFlag`, but carries a value and can run a reset on expiry. */
export function useTransientValue<T>(
  ms = DEFAULT_MS,
  onExpire?: () => void,
): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null);
  const schedule = useTimeouts();

  // Kept in a ref so callers can pass an inline closure without re-arming.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const show = useCallback(
    (next: T) => {
      setValue(next);
      schedule(() => {
        setValue(null);
        onExpireRef.current?.();
      }, ms);
    },
    [ms, schedule],
  );

  return [value, show];
}

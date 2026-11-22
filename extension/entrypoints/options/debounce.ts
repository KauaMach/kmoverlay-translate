/** A call held back until the calls stop for a while. */
export interface Debounced<Args extends unknown[]> {
  /** Schedules a call with these arguments, replacing the call still waiting, if any. */
  call(...args: Args): void;
  /** Runs the waiting call now, if any. */
  flush(): void;
  /** Drops the waiting call, if any. */
  cancel(): void;
  /** True while a call is waiting. */
  isPending(): boolean;
}

/**
 * Delays `callback` until `delayMs` have passed without a new call. Only the
 * last arguments are used, so typing in a field saves once, not per key.
 */
export function debounce<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: Args | undefined;

  const cancel = (): void => {
    clearTimeout(timer);
    timer = undefined;
    pendingArgs = undefined;
  };

  const flush = (): void => {
    if (pendingArgs === undefined) {
      return;
    }
    const args = pendingArgs;
    cancel();
    callback(...args);
  };

  return {
    call(...args: Args): void {
      clearTimeout(timer);
      pendingArgs = args;
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel,
    isPending: () => pendingArgs !== undefined,
  };
}

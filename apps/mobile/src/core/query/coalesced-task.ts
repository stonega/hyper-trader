export interface CoalescedTask {
  readonly schedule: () => void;
  readonly cancel: () => void;
}

interface CoalescedTaskTimers {
  readonly set: (callback: () => void, delayMs: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

const systemTimers: CoalescedTaskTimers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Runs at most once per fixed window without extending that window for every
 * new event. This keeps a continuous stream responsive while still collapsing
 * bursts into one authoritative refresh.
 */
export function createCoalescedTask(
  task: () => void,
  delayMs: number,
  timers: CoalescedTaskTimers = systemTimers,
): CoalescedTask {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("A coalesced task delay must be a non-negative number.");
  }
  let pending: unknown | null = null;
  return {
    schedule() {
      if (pending !== null) return;
      pending = timers.set(() => {
        pending = null;
        task();
      }, delayMs);
    },
    cancel() {
      if (pending === null) return;
      timers.clear(pending);
      pending = null;
    },
  };
}

export const SIGNER_ACTIVITY_SETTLE_MS = 1_500;

export interface SignerActivityGate {
  isActiveAndFocused(): boolean;
  setActiveAndFocused(value: boolean): void;
  interrupt(): void;
  waitUntilActiveAndFocused(): Promise<boolean>;
  dispose(): void;
}

interface ActivityGateTimer {
  schedule(durationMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

const nativeTimer: ActivityGateTimer = {
  schedule: (durationMs, callback) => setTimeout(callback, durationMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createSignerActivityGate(options: {
  readonly initiallyActiveAndFocused: boolean;
  readonly timer?: ActivityGateTimer;
  readonly settleWindowMs?: number;
}): SignerActivityGate {
  const timer = options.timer ?? nativeTimer;
  const settleWindowMs = options.settleWindowMs ?? SIGNER_ACTIVITY_SETTLE_MS;
  if (!Number.isSafeInteger(settleWindowMs) || settleWindowMs < 1) {
    throw new TypeError("The signer activity settle window is invalid.");
  }
  let activeAndFocused = options.initiallyActiveAndFocused;
  let disposed = false;
  const waiters = new Set<(value: boolean) => void>();

  const settle = (value: boolean) => {
    const pending = [...waiters];
    for (const waiter of pending) waiter(value);
  };

  return {
    isActiveAndFocused: () => !disposed && activeAndFocused,
    setActiveAndFocused(value) {
      if (disposed) return;
      activeAndFocused = value;
      if (value) settle(true);
    },
    interrupt() {
      if (disposed) return;
      activeAndFocused = false;
      settle(false);
    },
    waitUntilActiveAndFocused() {
      if (disposed) return Promise.resolve(false);
      if (activeAndFocused) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        let timerHandle: unknown = null;
        const finish = (value: boolean) => {
          if (!waiters.delete(finish)) return;
          if (timerHandle !== null) timer.cancel(timerHandle);
          resolve(value);
        };
        waiters.add(finish);
        timerHandle = timer.schedule(settleWindowMs, () => finish(false));
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activeAndFocused = false;
      settle(false);
    },
  };
}

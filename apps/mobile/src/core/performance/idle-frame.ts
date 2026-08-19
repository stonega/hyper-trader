export interface IdleFrameScheduler {
  requestIdle(callback: () => void): number;
  cancelIdle(handle: number): void;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

const nativeIdleFrameScheduler: IdleFrameScheduler = {
  requestIdle: (callback) => requestIdleCallback(callback),
  cancelIdle: (handle) => cancelIdleCallback(handle),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

export function scheduleAfterIdleFrame(
  callback: () => void,
  scheduler: IdleFrameScheduler = nativeIdleFrameScheduler,
): () => void {
  let frame: number | null = null;
  let canceled = false;
  const idle = scheduler.requestIdle(() => {
    if (canceled) return;
    frame = scheduler.requestFrame(() => {
      if (!canceled) callback();
    });
  });

  return () => {
    canceled = true;
    scheduler.cancelIdle(idle);
    if (frame !== null) scheduler.cancelFrame(frame);
  };
}

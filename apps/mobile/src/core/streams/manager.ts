export interface ManagedStreamSubscription {
  readonly key: string;
  readonly wire: unknown;
}

export interface ManagedStreamBaseline {
  readonly sequence?: number;
  readonly data: unknown;
}

export interface ManagedStreamMessage {
  readonly key: string;
  readonly sequence?: number;
  readonly stableId: string;
  readonly data: unknown;
  readonly isSnapshot?: boolean;
}

export interface ManagedStreamConnection {
  subscribe(
    subscription: unknown,
    listener: (message: ManagedStreamMessage) => void,
  ): () => void;
  ping(): void;
  close(): void;
  onDisconnect?(listener: (error?: unknown) => void): () => void;
}

type TimerHandle = unknown;

export interface ForegroundStreamManagerOptions {
  readonly connect: (options: {
    readonly signal: AbortSignal;
    readonly generation: number;
  }) => Promise<ManagedStreamConnection>;
  readonly loadBaseline: (
    subscription: ManagedStreamSubscription,
    options: { readonly signal: AbortSignal; readonly generation: number },
  ) => Promise<ManagedStreamBaseline>;
  readonly applyBaseline: (
    key: string,
    baseline: ManagedStreamBaseline,
  ) => void;
  readonly applyDelta: (key: string, message: ManagedStreamMessage) => void;
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle;
  readonly clearTimeout?: (handle: TimerHandle) => void;
  readonly random?: () => number;
  readonly heartbeatMs?: number;
  readonly reconnectBaseMs?: number;
  readonly reconnectMaxMs?: number;
  readonly maxReconnectAttempts?: number;
  readonly maxResyncAttempts?: number;
  readonly maxBufferedMessages?: number;
  readonly onError?: (error: unknown) => void;
}

export interface ForegroundStreamManager {
  setSubscriptions(subscriptions: readonly ManagedStreamSubscription[]): void;
  setEnvironment(environment: {
    readonly foreground: boolean;
    readonly online: boolean;
  }): Promise<void>;
  whenIdle(): Promise<void>;
  close(): void;
  currentGeneration(): number;
}

interface SubscriptionRunState {
  readonly subscription: ManagedStreamSubscription;
  lastSequence: number | null;
  readonly seenIds: Set<string>;
  readonly buffer: ManagedStreamMessage[];
  bufferOverflowed: boolean;
  baselineReady: boolean;
  baselinePromise: Promise<void> | null;
}

interface GenerationRun {
  readonly generation: number;
  readonly controller: AbortController;
  readonly states: Map<string, SubscriptionRunState>;
  connection: ManagedStreamConnection | null;
  subscriptionCleanups: Array<() => void>;
  disconnectCleanup: (() => void) | null;
  heartbeatTimer: TimerHandle | null;
  failed: boolean;
}

const defaultSetTimeout = (callback: () => void, delay: number): TimerHandle =>
  setTimeout(callback, delay);
const defaultClearTimeout = (handle: TimerHandle): void =>
  clearTimeout(handle as ReturnType<typeof setTimeout>);

export function createForegroundStreamManager(
  options: ForegroundStreamManagerOptions,
): ForegroundStreamManager {
  const schedule = options.setTimeout ?? defaultSetTimeout;
  const unschedule = options.clearTimeout ?? defaultClearTimeout;
  const random = options.random ?? Math.random;
  const heartbeatMs = options.heartbeatMs ?? 45_000;
  const reconnectBaseMs = options.reconnectBaseMs ?? 500;
  const reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 8;
  const maxResyncAttempts = options.maxResyncAttempts ?? 2;
  const maxBufferedMessages = options.maxBufferedMessages ?? 256;

  let subscriptions: readonly ManagedStreamSubscription[] = [];
  let foreground = false;
  let online = false;
  let generation = 0;
  let currentRun: GenerationRun | null = null;
  let reconnectTimer: TimerHandle | null = null;
  let reconnectAttempts = 0;
  let closed = false;
  const activeTasks = new Set<Promise<void>>();

  const eligible = () =>
    !closed && foreground && online && subscriptions.length > 0;

  const track = (promise: Promise<void>): Promise<void> => {
    activeTasks.add(promise);
    promise.finally(() => activeTasks.delete(promise)).catch(() => undefined);
    return promise;
  };

  const isCurrent = (run: GenerationRun) =>
    currentRun === run &&
    run.generation === generation &&
    !run.controller.signal.aborted &&
    eligible();

  const teardownRun = (run: GenerationRun | null) => {
    if (!run) {
      return;
    }
    run.controller.abort();
    if (run.heartbeatTimer !== null) {
      unschedule(run.heartbeatTimer);
      run.heartbeatTimer = null;
    }
    run.disconnectCleanup?.();
    run.disconnectCleanup = null;
    for (const cleanup of run.subscriptionCleanups) {
      cleanup();
    }
    run.subscriptionCleanups = [];
    run.connection?.close();
    run.connection = null;
    run.states.clear();
  };

  const advanceGeneration = (): number => {
    generation += 1;
    if (reconnectTimer !== null) {
      unschedule(reconnectTimer);
      reconnectTimer = null;
    }
    const previous = currentRun;
    currentRun = null;
    teardownRun(previous);
    return generation;
  };

  const rememberId = (state: SubscriptionRunState, stableId: string) => {
    state.seenIds.add(stableId);
    if (state.seenIds.size <= 256) {
      return;
    }
    const oldest = state.seenIds.values().next().value;
    if (oldest !== undefined) {
      state.seenIds.delete(oldest);
    }
  };

  const bufferMessage = (
    state: SubscriptionRunState,
    message: ManagedStreamMessage,
  ) => {
    if (state.buffer.length >= maxBufferedMessages) {
      state.buffer.shift();
      state.bufferOverflowed = true;
    }
    state.buffer.push(message);
  };

  let rebaseline: (
    run: GenerationRun,
    state: SubscriptionRunState,
  ) => Promise<void>;
  let failRun: (run: GenerationRun, error: unknown) => void;

  const processReadyMessage = (
    run: GenerationRun,
    state: SubscriptionRunState,
    message: ManagedStreamMessage,
    allowRebaseline = true,
  ): "applied" | "ignored" | "gap" => {
    if (!isCurrent(run) || state.seenIds.has(message.stableId)) {
      return "ignored";
    }
    if (message.sequence !== undefined && state.lastSequence !== null) {
      if (message.sequence <= state.lastSequence) {
        return "ignored";
      }
      if (message.sequence !== state.lastSequence + 1) {
        if (allowRebaseline) {
          state.baselineReady = false;
          bufferMessage(state, message);
          track(rebaseline(run, state).catch((error) => failRun(run, error)));
        }
        return "gap";
      }
    }
    if (message.sequence !== undefined) {
      state.lastSequence = message.sequence;
    }
    rememberId(state, message.stableId);
    options.applyDelta(message.key, message);
    return "applied";
  };

  const handleMessage = (run: GenerationRun, message: ManagedStreamMessage) => {
    if (!isCurrent(run) || message.isSnapshot === true) {
      return;
    }
    const state = run.states.get(message.key);
    if (!state) {
      return;
    }
    if (!state.baselineReady) {
      bufferMessage(state, message);
      return;
    }
    processReadyMessage(run, state, message);
  };

  rebaseline = (run, state) => {
    if (state.baselinePromise) {
      return state.baselinePromise;
    }
    state.baselineReady = false;
    const operation = (async () => {
      let attempts = 0;
      while (isCurrent(run)) {
        attempts += 1;
        const baseline = await options.loadBaseline(state.subscription, {
          signal: run.controller.signal,
          generation: run.generation,
        });
        if (!isCurrent(run)) {
          return;
        }
        options.applyBaseline(state.subscription.key, baseline);
        state.lastSequence = baseline.sequence ?? null;
        state.seenIds.clear();
        const buffered = state.buffer.splice(0);
        const overflowed = state.bufferOverflowed;
        state.bufferOverflowed = false;
        if (overflowed) {
          continue;
        }
        state.baselineReady = true;
        let persistentGap = false;
        for (const message of buffered) {
          if (!state.baselineReady || !isCurrent(run)) {
            bufferMessage(state, message);
            continue;
          }
          if (processReadyMessage(run, state, message, false) === "gap") {
            persistentGap = true;
            bufferMessage(state, message);
          }
        }
        if (persistentGap) {
          state.baselineReady = false;
          if (attempts >= maxResyncAttempts) {
            throw new Error(
              `Stream ${state.subscription.key} remained discontinuous after ${attempts} baselines.`,
            );
          }
          continue;
        }
        return;
      }
    })();
    const trackedOperation = operation.finally(() => {
      if (state.baselinePromise === trackedOperation) {
        state.baselinePromise = null;
      }
    });
    state.baselinePromise = trackedOperation;
    return trackedOperation;
  };

  const scheduleHeartbeat = (run: GenerationRun) => {
    let schedulerReturned = false;
    run.heartbeatTimer = schedule(() => {
      if (!isCurrent(run) || !run.connection) {
        return;
      }
      run.connection.ping();
      run.heartbeatTimer = null;
      if (schedulerReturned) {
        scheduleHeartbeat(run);
      }
    }, heartbeatMs);
    schedulerReturned = true;
  };

  let startGeneration: (candidateGeneration: number) => Promise<void>;

  const scheduleReconnect = (candidateGeneration: number) => {
    if (
      candidateGeneration !== generation ||
      !eligible() ||
      reconnectAttempts >= maxReconnectAttempts
    ) {
      return;
    }
    const exponential = Math.min(
      reconnectMaxMs,
      reconnectBaseMs * 2 ** reconnectAttempts,
    );
    const jitter = Math.floor(random() * Math.min(1_000, exponential / 2));
    reconnectAttempts += 1;
    reconnectTimer = schedule(() => {
      reconnectTimer = null;
      if (candidateGeneration !== generation || !eligible()) {
        return;
      }
      const nextGeneration = advanceGeneration();
      track(startGeneration(nextGeneration));
    }, exponential + jitter);
  };

  failRun = (run, error) => {
    if (!isCurrent(run) || run.failed) {
      return;
    }
    run.failed = true;
    options.onError?.(error);
    const reconnectGeneration = advanceGeneration();
    scheduleReconnect(reconnectGeneration);
  };

  startGeneration = async (candidateGeneration) => {
    const run: GenerationRun = {
      generation: candidateGeneration,
      controller: new AbortController(),
      states: new Map(),
      connection: null,
      subscriptionCleanups: [],
      disconnectCleanup: null,
      heartbeatTimer: null,
      failed: false,
    };
    currentRun = run;
    try {
      const opened = await options.connect({
        signal: run.controller.signal,
        generation: run.generation,
      });
      if (!isCurrent(run)) {
        opened.close();
        return;
      }
      run.connection = opened;
      for (const subscription of subscriptions) {
        run.states.set(subscription.key, {
          subscription,
          lastSequence: null,
          seenIds: new Set(),
          buffer: [],
          bufferOverflowed: false,
          baselineReady: false,
          baselinePromise: null,
        });
      }
      run.subscriptionCleanups = subscriptions.map((subscription) =>
        opened.subscribe(subscription.wire, (message) =>
          handleMessage(run, message),
        ),
      );
      run.disconnectCleanup =
        opened.onDisconnect?.((error) => failRun(run, error)) ?? null;
      scheduleHeartbeat(run);
      await Promise.all(
        [...run.states.values()].map((state) => rebaseline(run, state)),
      );
      if (isCurrent(run)) {
        reconnectAttempts = 0;
      }
    } catch (error) {
      failRun(run, error);
    }
  };

  const restartIfEligible = (): Promise<void> => {
    const nextGeneration = advanceGeneration();
    if (!eligible()) {
      return Promise.resolve();
    }
    return track(startGeneration(nextGeneration));
  };

  return {
    setSubscriptions(next) {
      subscriptions = [...next];
      if (eligible()) {
        void restartIfEligible();
      } else if (currentRun !== null) {
        advanceGeneration();
      }
    },
    setEnvironment(next) {
      if (foreground === next.foreground && online === next.online) {
        return Promise.resolve();
      }
      foreground = next.foreground;
      online = next.online;
      return restartIfEligible();
    },
    async whenIdle() {
      while (activeTasks.size > 0) {
        await Promise.allSettled([...activeTasks]);
      }
    },
    close() {
      closed = true;
      advanceGeneration();
    },
    currentGeneration: () => generation,
  };
}

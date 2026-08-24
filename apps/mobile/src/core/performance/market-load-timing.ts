import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";

type MarketTimingValue = boolean | number | string | null | undefined;

export type MarketTimingDetails = Readonly<Record<string, MarketTimingValue>>;

export interface MarketTimingEvent extends MarketTimingDetails {
  readonly durationMs: number;
  readonly source: string;
  readonly step: string;
  readonly totalMs: number;
  readonly traceId: string;
}

export interface MarketTimingSpan {
  finish(details?: MarketTimingDetails): void;
}

export interface MarketLoadTrace {
  readonly traceId: string;
  mark(step: string, details?: MarketTimingDetails): void;
  record(step: string, durationMs: number, details?: MarketTimingDetails): void;
  startStep(step: string, details?: MarketTimingDetails): MarketTimingSpan;
}

export interface InitialMarketDataState {
  readonly content: "empty" | "loading" | "ready" | "unavailable";
  readonly fetchStatus: "fetching" | "idle" | "paused";
  readonly preferencesStatus: "error" | "loading" | "ready";
}

interface MarketLoadTraceOptions {
  readonly enabled?: boolean;
  readonly now?: () => number;
  readonly write?: (event: MarketTimingEvent) => void;
}

let nextTraceId = 0;

export function marketTimingNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function isInitialMarketDataSettled(
  state: InitialMarketDataState,
): boolean {
  return (
    state.content !== "loading" &&
    state.fetchStatus !== "fetching" &&
    state.preferencesStatus !== "loading"
  );
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function defaultEnabled(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

function defaultWrite(event: MarketTimingEvent): void {
  console.info("[Markets timing]", event);
}

export function createMarketLoadTrace(
  context: {
    readonly source: string;
    readonly network?: HyperliquidNetwork;
  },
  options: MarketLoadTraceOptions = {},
): MarketLoadTrace {
  const now = options.now ?? marketTimingNow;
  const enabled = options.enabled ?? defaultEnabled();
  const write = options.write ?? defaultWrite;
  const startedAt = now();
  const traceId = `markets-${++nextTraceId}`;

  const emit = (
    step: string,
    durationMs: number,
    details: MarketTimingDetails = {},
  ) => {
    if (!enabled) return;
    write({
      ...details,
      ...(context.network === undefined ? {} : { network: context.network }),
      traceId,
      source: context.source,
      step,
      durationMs: roundMs(durationMs),
      totalMs: roundMs(now() - startedAt),
    });
  };

  return {
    traceId,
    mark: (step, details) => emit(step, 0, details),
    record: (step, durationMs, details) => emit(step, durationMs, details),
    startStep(step, initialDetails = {}) {
      const stepStartedAt = now();
      let finished = false;
      return {
        finish(details = {}) {
          if (finished) return;
          finished = true;
          emit(step, now() - stepStartedAt, {
            ...initialDetails,
            ...details,
          });
        },
      };
    },
  };
}

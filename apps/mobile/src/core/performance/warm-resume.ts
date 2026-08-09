export const WARM_RESUME_MARKS = {
  resumeStarted: "hyper-trader:resume-started",
  publicCacheReady: "hyper-trader:public-cache-ready",
  usableTrade: "hyper-trader:usable-trade",
} as const;

export interface PerformanceMarkSink {
  mark(name: string): void;
}

function defaultSink(): PerformanceMarkSink {
  return {
    mark(name) {
      globalThis.performance?.mark(name);
    },
  };
}

export interface WarmResumeMarkers {
  markResumeStarted(): void;
  markPublicCacheReady(): void;
  markUsableTrade(): void;
}

export function createWarmResumeMarkers(
  sink: PerformanceMarkSink = defaultSink(),
): WarmResumeMarkers {
  return {
    markResumeStarted: () => sink.mark(WARM_RESUME_MARKS.resumeStarted),
    markPublicCacheReady: () => sink.mark(WARM_RESUME_MARKS.publicCacheReady),
    markUsableTrade: () => sink.mark(WARM_RESUME_MARKS.usableTrade),
  };
}

export const warmResumeMarkers = createWarmResumeMarkers();

export interface WarmResumeSample {
  readonly durationMs: number;
}

export interface WarmResumeSummary {
  readonly runCount: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly targetMs: 1_000;
  readonly meetsTarget: boolean;
}

export function createWarmResumeSample(
  resumeStartedAtMs: number,
  usableTradeAtMs: number,
): WarmResumeSample {
  const durationMs = usableTradeAtMs - resumeStartedAtMs;
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new TypeError(
      "Warm-resume timestamps must produce a finite duration.",
    );
  }
  return { durationMs };
}

function percentile(sorted: readonly number[], ratio: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

export function summarizeWarmResumeSamples(
  samples: readonly WarmResumeSample[],
): WarmResumeSummary {
  if (samples.length < 10) {
    throw new TypeError("Warm-resume evidence requires at least 10 runs.");
  }
  const durations = samples
    .map(({ durationMs }) => durationMs)
    .sort((a, b) => a - b);
  const p95Ms = percentile(durations, 0.95);
  return {
    runCount: durations.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms,
    maxMs: durations.at(-1) ?? 0,
    targetMs: 1_000,
    meetsTarget: (durations.at(-1) ?? Number.POSITIVE_INFINITY) <= 1_000,
  };
}

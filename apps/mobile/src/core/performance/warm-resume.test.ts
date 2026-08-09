import { describe, expect, test } from "bun:test";

import {
  createWarmResumeSample,
  summarizeWarmResumeSamples,
} from "./warm-resume";

describe("warm resume measurement", () => {
  test("summarizes at least ten deterministic runs", () => {
    const samples = [400, 500, 600, 700, 800, 850, 900, 920, 950, 980].map(
      (duration) => createWarmResumeSample(100, 100 + duration),
    );

    expect(summarizeWarmResumeSamples(samples)).toEqual({
      runCount: 10,
      p50Ms: 800,
      p95Ms: 980,
      maxMs: 980,
      targetMs: 1_000,
      meetsTarget: true,
    });
  });

  test("rejects incomplete or invalid evidence", () => {
    expect(() => summarizeWarmResumeSamples([])).toThrow("at least 10 runs");
    expect(() => createWarmResumeSample(10, 9)).toThrow("finite duration");
  });
});

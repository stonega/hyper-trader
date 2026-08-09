import { describe, expect, test } from "bun:test";

import {
  createOnboardingRecord,
  decideLaunchDestination,
  parseStoredOnboardingRecord,
  reduceWelcomePhase,
  welcomePhaseTransitionDurationMs,
} from "./state";

describe("onboarding route and persistence state", () => {
  test("routes a first launch to Welcome and a completed launch to Trade", () => {
    expect(decideLaunchDestination(parseStoredOnboardingRecord(null))).toBe(
      "welcome",
    );
    expect(
      decideLaunchDestination(
        parseStoredOnboardingRecord(
          JSON.stringify(createOnboardingRecord("read_only")),
        ),
      ),
    ).toBe("trade");
  });

  test("persists only an untrusted setup intent for the setup choice", () => {
    expect(createOnboardingRecord("setup")).toEqual({
      version: 1,
      completed: true,
      choice: "setup",
      setupIntent: "requested",
    });
    expect(createOnboardingRecord("read_only").setupIntent).toBeNull();
  });

  test("fails explicitly for corrupt or unreadable durable state", () => {
    expect(
      decideLaunchDestination(parseStoredOnboardingRecord("bad json")),
    ).toBe("failure");
    expect(
      decideLaunchDestination({ status: "storage_error", message: "denied" }),
    ).toBe("failure");
  });

  test("does not advance before persistence succeeds", () => {
    expect(reduceWelcomePhase("ready", { type: "choose" })).toBe("persisting");
    expect(reduceWelcomePhase("persisting", { type: "failed" })).toBe("failed");
    expect(reduceWelcomePhase("failed", { type: "choose" })).toBe("persisting");
  });

  test("removes staged phase motion when reduced motion is enabled", () => {
    expect(welcomePhaseTransitionDurationMs(false)).toBeLessThanOrEqual(300);
    expect(welcomePhaseTransitionDurationMs(true)).toBe(0);
  });
});

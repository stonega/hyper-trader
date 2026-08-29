import { describe, expect, test } from "bun:test";

import {
  completeFirstUseOnboarding,
  FIRST_USE_ONBOARDING_KEY,
  type FirstUseOnboardingStorage,
  readFirstUseOnboardingStatus,
} from "./first-use";

class MemoryStorage implements FirstUseOnboardingStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

describe("first-use onboarding persistence", () => {
  test("keeps missing and unrecognized values pending", async () => {
    const storage = new MemoryStorage();

    expect(await readFirstUseOnboardingStatus(storage)).toBe("pending");

    storage.values.set(FIRST_USE_ONBOARDING_KEY, "unknown");
    expect(await readFirstUseOnboardingStatus(storage)).toBe("pending");
  });

  test("marks either onboarding choice complete for later launches", async () => {
    const storage = new MemoryStorage();

    await completeFirstUseOnboarding(storage);

    expect(storage.values.get(FIRST_USE_ONBOARDING_KEY)).toBe("complete");
    expect(await readFirstUseOnboardingStatus(storage)).toBe("complete");
  });
});

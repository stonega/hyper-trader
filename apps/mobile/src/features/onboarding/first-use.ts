export const FIRST_USE_ONBOARDING_KEY = "@hyper-trader/onboarding/v1";

const FIRST_USE_ONBOARDING_COMPLETE = "complete";

export interface FirstUseOnboardingStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type FirstUseOnboardingStatus = "pending" | "complete";

export async function readFirstUseOnboardingStatus(
  storage: FirstUseOnboardingStorage,
): Promise<FirstUseOnboardingStatus> {
  const value = await storage.getItem(FIRST_USE_ONBOARDING_KEY);
  return value === FIRST_USE_ONBOARDING_COMPLETE ? "complete" : "pending";
}

export async function completeFirstUseOnboarding(
  storage: FirstUseOnboardingStorage,
): Promise<void> {
  await storage.setItem(
    FIRST_USE_ONBOARDING_KEY,
    FIRST_USE_ONBOARDING_COMPLETE,
  );
}

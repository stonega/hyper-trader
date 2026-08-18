import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  createOnboardingRecord,
  ONBOARDING_STORAGE_KEY,
  type OnboardingLoadResult,
  parseStoredOnboardingRecord,
  type WelcomeChoice,
} from "./state";

export async function loadOnboardingState(): Promise<OnboardingLoadResult> {
  try {
    return parseStoredOnboardingRecord(
      await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY),
    );
  } catch (error) {
    return {
      status: "storage_error",
      message:
        error instanceof Error
          ? error.message
          : "The onboarding preference could not be read.",
    };
  }
}

export async function completeOnboarding(choice: WelcomeChoice): Promise<void> {
  await AsyncStorage.setItem(
    ONBOARDING_STORAGE_KEY,
    JSON.stringify(createOnboardingRecord(choice)),
  );
}

export const ONBOARDING_STORAGE_KEY = "@hyper-trader/onboarding:v1";

export type WelcomeChoice = "setup" | "read_only";

export interface OnboardingRecord {
  readonly version: 1;
  readonly completed: true;
  readonly choice: WelcomeChoice;
  readonly setupIntent: "requested" | null;
}

export type OnboardingLoadResult =
  | { readonly status: "absent" }
  | { readonly status: "completed"; readonly record: OnboardingRecord }
  | { readonly status: "corrupt" }
  | { readonly status: "storage_error"; readonly message: string };

export type LaunchDestination = "welcome" | "trade" | "failure";

export function createOnboardingRecord(
  choice: WelcomeChoice,
): OnboardingRecord {
  return {
    version: 1,
    completed: true,
    choice,
    setupIntent: choice === "setup" ? "requested" : null,
  };
}

function parseOnboardingRecord(value: unknown): OnboardingRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.completed !== true ||
    (record.choice !== "setup" && record.choice !== "read_only") ||
    (record.setupIntent !== null && record.setupIntent !== "requested") ||
    (record.choice === "setup" && record.setupIntent !== "requested") ||
    (record.choice === "read_only" && record.setupIntent !== null)
  ) {
    return null;
  }
  return record as unknown as OnboardingRecord;
}

export function parseStoredOnboardingRecord(
  serialized: string | null,
): OnboardingLoadResult {
  if (serialized === null) {
    return { status: "absent" };
  }
  try {
    const record = parseOnboardingRecord(JSON.parse(serialized));
    return record ? { status: "completed", record } : { status: "corrupt" };
  } catch {
    return { status: "corrupt" };
  }
}

export function decideLaunchDestination(
  result: OnboardingLoadResult,
): LaunchDestination {
  if (result.status === "completed") {
    return "trade";
  }
  if (result.status === "absent") {
    return "welcome";
  }
  return "failure";
}

export type WelcomePhase = "ready" | "persisting" | "failed";

export type WelcomeAction =
  | { readonly type: "choose" }
  | { readonly type: "failed" };

export function reduceWelcomePhase(
  phase: WelcomePhase,
  action: WelcomeAction,
): WelcomePhase {
  switch (action.type) {
    case "choose":
      return phase === "ready" || phase === "failed" ? "persisting" : phase;
    case "failed":
      return phase === "persisting" ? "failed" : phase;
  }
}

export function welcomePhaseTransitionDurationMs(
  reducedMotion: boolean,
): 0 | 160 {
  return reducedMotion ? 0 : 160;
}

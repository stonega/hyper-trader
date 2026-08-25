export type DeviceAuthenticationAssessment =
  | { readonly status: "available"; readonly level: "strong_biometric" }
  | {
      readonly status: "unavailable";
      readonly reason: "no_hardware" | "not_enrolled" | "not_strong";
    };

export class DeviceAuthenticationUnavailableError extends Error {
  readonly reason: Exclude<
    DeviceAuthenticationAssessment,
    { readonly status: "available" }
  >["reason"];

  constructor(reason: DeviceAuthenticationUnavailableError["reason"]) {
    super("Strong device authentication is unavailable.");
    this.name = "DeviceAuthenticationUnavailableError";
    this.reason = reason;
  }
}

export class DeviceAuthenticationFailedError extends Error {
  constructor() {
    super("Device authentication did not complete.");
    this.name = "DeviceAuthenticationFailedError";
  }
}

export interface DeviceAuthenticationPort {
  assess(): Promise<DeviceAuthenticationAssessment>;
  assertAvailable(): Promise<void>;
  authenticate(): Promise<void>;
}

export async function prepareProtectedCredentialCreation(
  authentication: DeviceAuthenticationPort,
  platform: "android" | "ios",
): Promise<void> {
  if (platform === "android") {
    // SecureStore authenticates the cipher used for a protected Android write.
    // Only preflight capability here so creation has one system prompt.
    await authentication.assertAvailable();
    return;
  }

  // Adding a new authenticated Keychain item does not prompt on iOS, so the
  // creation confirmation is owned by LocalAuthentication on this platform.
  await authentication.authenticate();
}

export function createDeviceAuthenticationPort(adapter: {
  hasHardware(): Promise<boolean>;
  isEnrolled(): Promise<boolean>;
  enrolledSecurityLevel(): Promise<number>;
  authenticate(): Promise<{ readonly success: boolean }>;
  readonly strongBiometricLevel: number;
}): DeviceAuthenticationPort {
  const assess = async (): Promise<DeviceAuthenticationAssessment> => {
    if (!(await adapter.hasHardware())) {
      return { status: "unavailable", reason: "no_hardware" };
    }
    if (!(await adapter.isEnrolled())) {
      return { status: "unavailable", reason: "not_enrolled" };
    }
    if (
      (await adapter.enrolledSecurityLevel()) < adapter.strongBiometricLevel
    ) {
      return { status: "unavailable", reason: "not_strong" };
    }
    return { status: "available", level: "strong_biometric" };
  };
  return {
    assess,
    async assertAvailable() {
      const result = await assess();
      if (result.status === "unavailable") {
        throw new DeviceAuthenticationUnavailableError(result.reason);
      }
    },
    async authenticate() {
      const result = await assess();
      if (result.status === "unavailable") {
        throw new DeviceAuthenticationUnavailableError(result.reason);
      }
      if (!(await adapter.authenticate()).success) {
        throw new DeviceAuthenticationFailedError();
      }
    },
  };
}

export async function createExpoDeviceAuthenticationPort(): Promise<DeviceAuthenticationPort> {
  const authentication = await import("expo-local-authentication");
  return createDeviceAuthenticationPort({
    hasHardware: authentication.hasHardwareAsync,
    isEnrolled: authentication.isEnrolledAsync,
    enrolledSecurityLevel: authentication.getEnrolledLevelAsync,
    authenticate: () =>
      authentication.authenticateAsync({
        promptMessage: "Protect your Hyper Trader API wallet",
        promptSubtitle: "Your key stays on this device",
        fallbackLabel: "Use device passcode",
        disableDeviceFallback: false,
        biometricsSecurityLevel: "strong",
      }),
    strongBiometricLevel: authentication.SecurityLevel.BIOMETRIC_STRONG,
  });
}

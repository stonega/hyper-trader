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

export interface DeviceAuthenticationPort {
  assess(): Promise<DeviceAuthenticationAssessment>;
  assertAvailable(): Promise<void>;
}

export function createDeviceAuthenticationPort(adapter: {
  hasHardware(): Promise<boolean>;
  isEnrolled(): Promise<boolean>;
  enrolledSecurityLevel(): Promise<number>;
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
  };
}

export async function createExpoDeviceAuthenticationPort(): Promise<DeviceAuthenticationPort> {
  const authentication = await import("expo-local-authentication");
  return createDeviceAuthenticationPort({
    hasHardware: authentication.hasHardwareAsync,
    isEnrolled: authentication.isEnrolledAsync,
    enrolledSecurityLevel: authentication.getEnrolledLevelAsync,
    strongBiometricLevel: authentication.SecurityLevel.BIOMETRIC_STRONG,
  });
}

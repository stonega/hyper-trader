import { describe, expect, test } from "bun:test";

import { createDeviceAuthenticationPort } from "./device-auth";

describe("device authentication capability", () => {
  test("requires enrolled strong biometrics", async () => {
    const available = createDeviceAuthenticationPort({
      hasHardware: async () => true,
      isEnrolled: async () => true,
      enrolledSecurityLevel: async () => 3,
      strongBiometricLevel: 3,
    });
    await expect(available.assertAvailable()).resolves.toBeUndefined();

    const weak = createDeviceAuthenticationPort({
      hasHardware: async () => true,
      isEnrolled: async () => true,
      enrolledSecurityLevel: async () => 2,
      strongBiometricLevel: 3,
    });
    await expect(weak.assertAvailable()).rejects.toMatchObject({
      reason: "not_strong",
    });
  });
});

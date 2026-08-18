import { describe, expect, test } from "bun:test";

import { createDeviceAuthenticationPort } from "./device-auth";

describe("device authentication capability", () => {
  test("requires enrolled strong biometrics", async () => {
    const available = createDeviceAuthenticationPort({
      hasHardware: async () => true,
      isEnrolled: async () => true,
      enrolledSecurityLevel: async () => 3,
      authenticate: async () => ({ success: true }),
      strongBiometricLevel: 3,
    });
    await expect(available.assertAvailable()).resolves.toBeUndefined();
    await expect(available.authenticate()).resolves.toBeUndefined();

    const weak = createDeviceAuthenticationPort({
      hasHardware: async () => true,
      isEnrolled: async () => true,
      enrolledSecurityLevel: async () => 2,
      authenticate: async () => ({ success: true }),
      strongBiometricLevel: 3,
    });
    await expect(weak.assertAvailable()).rejects.toMatchObject({
      reason: "not_strong",
    });
  });

  test("keeps a cancelled system prompt unavailable to setup", async () => {
    const cancelled = createDeviceAuthenticationPort({
      hasHardware: async () => true,
      isEnrolled: async () => true,
      enrolledSecurityLevel: async () => 3,
      authenticate: async () => ({ success: false }),
      strongBiometricLevel: 3,
    });

    await expect(cancelled.authenticate()).rejects.toThrow("did not complete");
  });
});

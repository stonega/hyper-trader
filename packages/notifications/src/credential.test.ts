import { describe, expect, test } from "bun:test";

import {
  hashInstallationCredential,
  verifyInstallationCredential,
} from "./credential";

describe("installation credentials", () => {
  test("stores only a digest and compares without prefix shortcuts", async () => {
    const credential = "11".repeat(32);
    const hash = await hashInstallationCredential(credential);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(credential);
    expect(await verifyInstallationCredential(credential, hash)).toBe(true);
    expect(
      await verifyInstallationCredential(`${credential.slice(0, -1)}2`, hash),
    ).toBe(false);
    expect(await verifyInstallationCredential("bad", hash)).toBe(false);
  });
});

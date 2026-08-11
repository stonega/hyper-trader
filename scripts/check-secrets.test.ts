import { describe, expect, test } from "bun:test";

import { findSecretSignals, isForbiddenSecretPath } from "./check-secrets";

describe("secret boundary scan", () => {
  test("flags credential files while permitting documented templates", () => {
    expect(isForbiddenSecretPath("apps/mobile/.env")).toBe(true);
    expect(isForbiddenSecretPath("release/key.pem")).toBe(true);
    expect(isForbiddenSecretPath("apps/mobile/.env.example")).toBe(false);
  });

  test("reports only rule names for likely live secret material", () => {
    expect(findSecretSignals(`PRIVATE_KEY="0x${"ab12".repeat(16)}"`)).toEqual([
      "assigned-private-key",
    ]);
    expect(
      findSecretSignals(
        'const token = "ExponentPushToken[fixture-documentation]";',
      ),
    ).toEqual([]);
    expect(findSecretSignals(`-----BEGIN ${"PRIVATE"} KEY-----`)).toEqual([
      "private-key-block",
    ]);
  });

  test("flags prefixed private-key assignment identifiers", () => {
    const likelyPrivateKey = "ab12".repeat(16);

    for (const identifier of [
      "AGENT_PRIVATE_KEY",
      "HYPERLIQUID_PRIVATE_KEY",
      "agent_private_key",
      "agentPrivateKey",
      "HYPERLIQUID_API_WALLET_KEY",
    ]) {
      expect(findSecretSignals(`${identifier}="${likelyPrivateKey}"`)).toEqual([
        "assigned-private-key",
      ]);
    }
  });

  test("permits non-secret 64-hex fixtures", () => {
    const publicTestVector = "ab12".repeat(16);
    const placeholderPrivateKey = "11".repeat(32);

    expect(findSecretSignals(`expectedDigest="${publicTestVector}"`)).toEqual(
      [],
    );
    expect(findSecretSignals(`fixtureHash="${publicTestVector}"`)).toEqual([]);
    expect(
      findSecretSignals(`AGENT_PRIVATE_KEY="${placeholderPrivateKey}"`),
    ).toEqual([]);
  });
});

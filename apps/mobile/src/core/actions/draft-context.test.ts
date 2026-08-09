import { describe, expect, test } from "bun:test";

import {
  bindDraftContext,
  type DraftContextInput,
  type DraftInvalidationReason,
  validateDraftContext,
} from "./draft-context";

const base = {
  context: {
    network: "testnet" as const,
    masterAccount: "0xaaa",
    targetAccount: "0xbbb",
  },
  marketCanonicalId: "perp:0:0",
  metadataFingerprint: "meta-v1",
};

describe("draft context binding", () => {
  test("keeps a draft only for the exact account, network, market, and metadata", () => {
    const binding = bindDraftContext(base);
    expect(validateDraftContext(binding, base)).toEqual({ valid: true });
  });

  const invalidContexts: readonly [
    DraftContextInput,
    DraftInvalidationReason,
  ][] = [
    [
      { ...base, context: { ...base.context, targetAccount: "0xccc" } },
      "account_changed",
    ],
    [
      { ...base, context: { ...base.context, network: "mainnet" as const } },
      "network_changed",
    ],
    [{ ...base, marketCanonicalId: "spot:1" }, "market_changed"],
    [{ ...base, metadataFingerprint: "meta-v2" }, "market_metadata_changed"],
  ];

  test.each(invalidContexts)(
    "returns a user-visible invalidation reason",
    (next, reason) => {
      const result = validateDraftContext(bindDraftContext(base), next);
      expect(result).toMatchObject({ valid: false, reason });
      if (!result.valid) {
        expect(result.message.length).toBeGreaterThan(12);
      }
    },
  );
});

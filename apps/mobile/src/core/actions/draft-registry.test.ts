import { describe, expect, test } from "bun:test";

import { bindDraftContext } from "./draft-context";
import { createDraftInvalidationRegistry } from "./draft-registry";

describe("draft invalidation registry", () => {
  test("invalidates once with the context-specific user-visible reason", () => {
    const reasons: string[] = [];
    const registry = createDraftInvalidationRegistry();
    registry.register(
      bindDraftContext({
        context: {
          network: "testnet",
          masterAccount: "0xaaa",
          targetAccount: "0xaaa",
        },
        marketCanonicalId: "perp:0:0",
        metadataFingerprint: "meta-v1",
      }),
      ({ reason }) => reasons.push(reason),
    );

    registry.invalidateForContext({
      network: "mainnet",
      masterAccount: "0xaaa",
      targetAccount: "0xaaa",
    });
    registry.invalidateForContext({
      network: "testnet",
      masterAccount: "0xbbb",
      targetAccount: "0xbbb",
    });

    expect(reasons).toEqual(["network_changed"]);
  });
});

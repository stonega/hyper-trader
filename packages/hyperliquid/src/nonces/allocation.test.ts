import { describe, expect, test } from "bun:test";

import { allocateNonce } from "./allocation";
import {
  agentAddressFingerprint,
  createRetiredSignerTombstone,
} from "./tombstone";

const clock = {
  wallTimeMs: 1_725_000_000_000,
  monotonicTimeMs: 50_000,
  serverTimeMs: 1_725_000_000_100,
  serverSampledAtMonotonicMs: 49_000,
  lastObservedWallMs: 1_725_000_000_000,
};

describe("nonce allocation", () => {
  test("uses max(validated wall time, last nonce + 1) with a fixed expiry", () => {
    expect(allocateNonce({ ...clock, lastIssuedNonce: null })).toEqual({
      nonce: 1_725_000_000_000,
      expiresAfterMs: 1_725_000_015_000,
      observedWallMs: 1_725_000_000_000,
    });
    expect(
      allocateNonce({
        ...clock,
        lastIssuedNonce: 1_725_000_000_004,
      }).nonce,
    ).toBe(1_725_000_000_005);
  });

  test("blocks rollback, stale server time, excessive skew, and a nonce beyond expiry", () => {
    expect(() =>
      allocateNonce({
        ...clock,
        lastObservedWallMs: clock.wallTimeMs + 1_001,
        lastIssuedNonce: null,
      }),
    ).toThrow("moved backwards");
    expect(() =>
      allocateNonce({
        ...clock,
        serverSampledAtMonotonicMs: 19_999,
        lastIssuedNonce: null,
      }),
    ).toThrow("missing or stale");
    expect(() =>
      allocateNonce({
        ...clock,
        serverTimeMs: clock.wallTimeMs + 5_001,
        lastIssuedNonce: null,
      }),
    ).toThrow("more than 5 seconds");
    expect(() =>
      allocateNonce({
        ...clock,
        lastIssuedNonce: clock.wallTimeMs + 15_000,
      }),
    ).toThrow("too far ahead");
  });
});

describe("retired signer tombstones", () => {
  test("binds a non-reversible agent fingerprint into an ordered hash chain", () => {
    const fingerprint = agentAddressFingerprint(
      "0x3333333333333333333333333333333333333333",
    );
    const tombstone = createRetiredSignerTombstone({
      installationEpoch: "installation-epoch-0001",
      sequence: 1,
      priorChainRoot: `0x${"0".repeat(64)}`,
      network: "testnet",
      agentAddressFingerprint: fingerprint,
      lastIssuedNonce: 1_725_000_000_000,
      generation: 1,
      retiredAt: 1_725_100_000_000,
      reason: "rotated",
    });
    expect(tombstone.chainRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(JSON.stringify(tombstone)).not.toContain(
      "0x3333333333333333333333333333333333333333",
    );
  });
});

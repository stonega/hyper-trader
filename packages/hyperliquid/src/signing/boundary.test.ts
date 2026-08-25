import { describe, expect, test } from "bun:test";

import {
  ACTION_CAPABILITIES,
  actionCapabilitiesForReleaseStage,
  assertExchangeTransportCapability,
  assertKnownActionNetwork,
  assertSignerAccessCapability,
  assertTradingActionCapability,
  hasTradingActionCapability,
  MAINNET_TRADING_RELEASE_STAGE,
  signNetworkTypedData,
} from "./boundary";
import type {
  Eip712Payload,
  InjectedTypedDataSigner,
  SignerBinding,
} from "./types";

const address = {
  master: "0x1111111111111111111111111111111111111111",
  target: "0x2222222222222222222222222222222222222222",
  agent: "0x3333333333333333333333333333333333333333",
};

const binding: SignerBinding = {
  network: "testnet",
  masterAccount: address.master,
  targetAccount: address.target,
  agentAddress: address.agent,
  generation: 1,
};

const typedData: Eip712Payload = {
  domain: {
    name: "Exchange",
    version: "1",
    chainId: 1337,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  },
  types: { Agent: [{ name: "source", type: "string" }] },
  primaryType: "Agent",
  message: { source: "b" },
};

function signer(
  signerBinding: SignerBinding,
  calls: { value: number },
): InjectedTypedDataSigner {
  return {
    binding: signerBinding,
    async signTypedData() {
      calls.value += 1;
      return {
        r: `0x${"1".repeat(64)}`,
        s: `0x${"2".repeat(64)}`,
        v: 27,
      };
    },
  };
}

describe("injected signer boundary", () => {
  test("exposes an immutable compile-owned action capability matrix", () => {
    const preactivation = actionCapabilitiesForReleaseStage("preactivation");
    const candidate = actionCapabilitiesForReleaseStage("candidate");
    expect(preactivation).toEqual({
      mainnet: { signerAccess: false, exchangeTransport: false },
      testnet: { signerAccess: true, exchangeTransport: true },
    });
    expect(candidate).toEqual({
      mainnet: { signerAccess: true, exchangeTransport: true },
      testnet: { signerAccess: true, exchangeTransport: true },
    });
    expect(ACTION_CAPABILITIES).toEqual(
      actionCapabilitiesForReleaseStage(MAINNET_TRADING_RELEASE_STAGE),
    );
    expect(Object.isFrozen(ACTION_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(ACTION_CAPABILITIES.mainnet)).toBe(true);
    expect(Object.isFrozen(ACTION_CAPABILITIES.testnet)).toBe(true);
    expect(Object.isFrozen(preactivation)).toBe(true);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(hasTradingActionCapability("testnet")).toBe(true);
    expect(hasTradingActionCapability("mainnet")).toBe(
      MAINNET_TRADING_RELEASE_STAGE === "candidate",
    );
    expect(() => assertKnownActionNetwork("testnet")).not.toThrow();
    expect(() => assertKnownActionNetwork("mainnet")).not.toThrow();
    expect(() => assertKnownActionNetwork("unexpected-network")).toThrow(
      "unknown network",
    );
    expect(() => assertTradingActionCapability("unexpected-network")).toThrow(
      "unknown network",
    );
    if (MAINNET_TRADING_RELEASE_STAGE === "preactivation") {
      expect(() => assertSignerAccessCapability("mainnet")).toThrow(
        "mainnet signer access is disabled",
      );
      expect(() => assertExchangeTransportCapability("mainnet")).toThrow(
        "mainnet exchange transport is disabled",
      );
    } else {
      expect(() => assertSignerAccessCapability("mainnet")).not.toThrow();
      expect(() => assertExchangeTransportCapability("mainnet")).not.toThrow();
    }
  });

  test("returns only signature components for an exact testnet binding", async () => {
    const calls = { value: 0 };
    await expect(
      signNetworkTypedData({
        expectedBinding: binding,
        payload: { network: "testnet", typedData },
        signer: signer(binding, calls),
      }),
    ).resolves.toEqual({
      r: `0x${"1".repeat(64)}`,
      s: `0x${"2".repeat(64)}`,
      v: 27,
    });
    expect(calls.value).toBe(1);
  });

  test("applies the release stage and rejects cross-target use before invoking the signer", async () => {
    const mainnetBinding = { ...binding, network: "mainnet" as const };
    const mainnetCalls = { value: 0 };
    const mainnetResult = signNetworkTypedData({
      expectedBinding: mainnetBinding,
      payload: { network: "mainnet", typedData },
      signer: signer(mainnetBinding, mainnetCalls),
    });
    if (MAINNET_TRADING_RELEASE_STAGE === "preactivation") {
      await expect(mainnetResult).rejects.toThrow(
        "mainnet signer access is disabled",
      );
      expect(mainnetCalls.value).toBe(0);
    } else {
      await expect(mainnetResult).resolves.toEqual({
        r: `0x${"1".repeat(64)}`,
        s: `0x${"2".repeat(64)}`,
        v: 27,
      });
      expect(mainnetCalls.value).toBe(1);
    }

    for (const attempt of [
      {
        expectedBinding: binding,
        payload: { network: "testnet" as const, typedData },
        signerBinding: {
          ...binding,
          targetAccount: "0x4444444444444444444444444444444444444444",
        },
      },
      {
        expectedBinding: binding,
        payload: { network: "testnet" as const, typedData },
        signerBinding: { ...binding, generation: 2 },
      },
    ]) {
      const calls = { value: 0 };
      await expect(
        signNetworkTypedData({
          expectedBinding: attempt.expectedBinding,
          payload: attempt.payload,
          signer: signer(attempt.signerBinding, calls),
        }),
      ).rejects.toThrow();
      expect(calls.value).toBe(0);
    }
  });

  test("rejects a cross-network payload before invoking the signer", async () => {
    const calls = { value: 0 };
    await expect(
      signNetworkTypedData({
        expectedBinding: binding,
        payload: { network: "mainnet", typedData },
        signer: signer(binding, calls),
      }),
    ).rejects.toThrow();
    expect(calls.value).toBe(0);
  });
});

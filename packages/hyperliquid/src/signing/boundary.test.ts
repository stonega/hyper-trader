import { describe, expect, test } from "bun:test";

import { signTestnetTypedData } from "./boundary";
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
  test("returns only signature components for an exact testnet binding", async () => {
    const calls = { value: 0 };
    await expect(
      signTestnetTypedData({
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

  test("denies mainnet and cross-target use before invoking the signer", async () => {
    for (const attempt of [
      {
        expectedBinding: { ...binding, network: "mainnet" as const },
        payload: { network: "mainnet" as const, typedData },
        signerBinding: binding,
      },
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
        signTestnetTypedData({
          expectedBinding: attempt.expectedBinding,
          payload: attempt.payload,
          signer: signer(attempt.signerBinding, calls),
        }),
      ).rejects.toThrow();
      expect(calls.value).toBe(0);
    }
  });
});

import { describe, expect, test } from "bun:test";
import {
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildApproveAgentTypedData,
  buildL1TypedData,
} from "../signing/typed-data";
import {
  buildBulkCancelAction,
  buildCancelAction,
  buildLimitOrderAction,
  buildMarketOrderAction,
  buildReduceOnlyCloseAction,
  buildUpdateLeverageAction,
} from "./builders";
import { encodeL1Action } from "./codec";
import type { ExchangeAction } from "./types";

const fixture = await Bun.file(
  new URL("../fixtures/signing/official-sdk-0.24.0.json", import.meta.url),
).json();

const cloid = "0x00000000000000000000000000000001" as const;

function buildVectors(): Readonly<Record<string, ExchangeAction>> {
  return {
    marketOrder: buildMarketOrderAction({
      assetId: 1,
      side: "buy",
      size: "100",
      aggressiveLimitPrice: "100",
      cloid,
    }),
    limitOrder: buildLimitOrderAction({
      assetId: 1,
      side: "sell",
      size: "0.5",
      limitPrice: "101.25",
      timeInForce: "Gtc",
      reduceOnly: false,
      cloid,
    }),
    cancelByOid: buildCancelAction({
      assetId: 1,
      target: { kind: "oid", oid: 42 },
    }),
    cancelByCloid: buildCancelAction({
      assetId: 1,
      target: { kind: "cloid", cloid },
    }),
    bulkCancelByOid: buildBulkCancelAction({
      cancels: [
        { assetId: 1, target: { kind: "oid", oid: 42 } },
        { assetId: 10_001, target: { kind: "oid", oid: 43 } },
      ],
    }),
    bulkCancelByCloid: buildBulkCancelAction({
      cancels: [
        { assetId: 1, target: { kind: "cloid", cloid } },
        {
          assetId: 10_001,
          target: {
            kind: "cloid",
            cloid: "0x00000000000000000000000000000002",
          },
        },
      ],
    }),
    updateLeverage: buildUpdateLeverageAction({
      assetId: 1,
      marginMode: "isolated",
      leverage: 5,
    }),
    reduceOnlyClose: buildReduceOnlyCloseAction({
      assetId: 1,
      side: "sell",
      size: "2",
      aggressiveLimitPrice: "99",
      cloid,
    }),
  };
}

describe("Hyperliquid L1 action codec", () => {
  test("matches every redacted official Python SDK 0.24.0 action vector", () => {
    expect(fixture.provenance.sdkCommit).toBe(
      "2fdb18f9517675ea03695a0962bd19eece9c83f0",
    );
    for (const [name, action] of Object.entries(buildVectors())) {
      const expected = fixture.vectors[name];
      const encoded = encodeL1Action({
        action,
        nonce: expected.nonce,
        vaultAddress: expected.vaultAddress,
        expiresAfter: expected.expiresAfter,
      });
      expect(encoded.actionBytes).toHaveLength(expected.actionBytesLength);
      expect(keccak256(encoded.actionBytes)).toBe(
        expected.actionBytesKeccak256,
      );
      expect(encoded.actionHash).toBe(expected.actionHash);
      for (const network of ["testnet", "mainnet"] as const) {
        const signing = buildL1TypedData(network, encoded);
        const expectedNetwork = expected.networks[network];
        expect(signing.typedData.message.source).toBe(expectedNetwork.source);
        expect(hashTypedData(signing.typedData as never)).toBe(
          expectedNetwork.typedDataHash,
        );
      }
    }
  });

  test("matches signature digests and recovered addresses without persisting raw signatures", async () => {
    const privateKey = keccak256(stringToHex(fixture.provenance.signerLabel));
    const account = privateKeyToAccount(privateKey);
    expect(account.address).toBe(fixture.provenance.signerAddress);

    const action = buildVectors().marketOrder;
    const expected = fixture.vectors.marketOrder;
    const encoded = encodeL1Action({
      action,
      nonce: expected.nonce,
      expiresAfter: expected.expiresAfter,
    });
    for (const network of ["testnet", "mainnet"] as const) {
      const { typedData } = buildL1TypedData(network, encoded);
      const signature = await account.signTypedData(typedData as never);
      expect(keccak256(signature)).toBe(
        expected.networks[network].signatureKeccak256,
      );
      await expect(
        recoverTypedDataAddress({ ...(typedData as never), signature }),
      ).resolves.toBe(expected.networks[network].recoveredAddress);
    }
  });

  test("rejects noncanonical decimals, malformed cloids, mixed cancel targets, and unsafe expiry", () => {
    expect(() =>
      buildMarketOrderAction({
        assetId: 1,
        side: "buy",
        size: "1.0",
        aggressiveLimitPrice: "100",
        cloid,
      }),
    ).toThrow("canonical decimal");
    expect(() =>
      buildMarketOrderAction({
        assetId: 1,
        side: "buy",
        size: "1",
        aggressiveLimitPrice: "100",
        cloid: "0x1",
      }),
    ).toThrow("128-bit");
    expect(() =>
      buildBulkCancelAction({
        cancels: [
          { assetId: 1, target: { kind: "oid", oid: 1 } },
          { assetId: 1, target: { kind: "cloid", cloid } },
        ],
      }),
    ).toThrow("cannot mix");
    expect(() =>
      encodeL1Action({
        action: buildVectors().marketOrder,
        nonce: 100,
        expiresAfter: 15_101,
      }),
    ).toThrow("within 15000 ms");
    expect(() =>
      buildMarketOrderAction({
        assetId: 1,
        side: "hold" as never,
        size: "1",
        aggressiveLimitPrice: "100",
        cloid,
      }),
    ).toThrow("buy or sell");
    expect(() =>
      buildLimitOrderAction({
        assetId: 1,
        side: "buy",
        size: "1",
        limitPrice: "100",
        timeInForce: "Forever" as never,
        reduceOnly: "false" as never,
        cloid,
      }),
    ).toThrow();
    expect(() =>
      buildLimitOrderAction({
        assetId: 1,
        side: "buy",
        size: "1",
        limitPrice: "100",
        timeInForce: "Gtc",
        reduceOnly: "false" as never,
        cloid,
      }),
    ).toThrow("boolean");
    expect(() =>
      buildUpdateLeverageAction({
        assetId: 1,
        marginMode: "portfolio" as never,
        leverage: 5,
      }),
    ).toThrow("cross or isolated");
    expect(() =>
      encodeL1Action({
        action: { type: "withdraw" } as never,
        nonce: 100,
      }),
    ).toThrow("unsupported exchange action discriminator");
    expect(() =>
      buildMarketOrderAction({
        type: "limit_order" as never,
        assetId: 1,
        side: "buy",
        size: "1",
        aggressiveLimitPrice: "100",
        cloid,
      }),
    ).toThrow("expected market_order");
  });
});

describe("approveAgent typed data", () => {
  test("matches testnet and mainnet EIP-712 vectors with a separately sourced expiry suffix", async () => {
    const privateKey = keccak256(stringToHex(fixture.provenance.signerLabel));
    const account = privateKeyToAccount(privateKey);
    for (const network of ["testnet", "mainnet"] as const) {
      const expected = fixture.approveAgent[network];
      const payload = buildApproveAgentTypedData({
        network,
        agentAddress: expected.agentAddress,
        agentBaseName: "ht-0123456789abc",
        validUntil: 1_727_592_000_000,
        nonce: expected.nonce,
      });
      expect(payload.action.agentName).toBe(expected.agentName);
      expect(payload.action.signatureChainId).toBe(expected.signatureChainId);
      expect(payload.action.hyperliquidChain).toBe(expected.hyperliquidChain);
      expect(hashTypedData(payload.typedData as never)).toBe(
        expected.typedDataHash,
      );
      const signature = await account.signTypedData(payload.typedData as never);
      expect(keccak256(signature)).toBe(expected.signatureKeccak256);
      await expect(
        recoverTypedDataAddress({
          ...(payload.typedData as never),
          signature,
        }),
      ).resolves.toBe(expected.recoveredAddress);
    }
  });

  test("requires approval expiry after nonce and within the protocol maximum", () => {
    const base = {
      network: "testnet" as const,
      agentAddress: fixture.approveAgent.testnet.agentAddress,
      agentBaseName: "ht-0123456789abc",
      nonce: 1_725_000_000_000,
    };
    expect(() =>
      buildApproveAgentTypedData({ ...base, validUntil: base.nonce }),
    ).toThrow("after nonce");
    expect(() =>
      buildApproveAgentTypedData({
        ...base,
        validUntil: base.nonce + 180 * 24 * 60 * 60 * 1_000 + 1,
      }),
    ).toThrow("within 180 days");
  });
});

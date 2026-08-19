import { describe, expect, test } from "bun:test";

import { custodyBindingId } from "../../platform/security/credential-vault";
import type { SavedAccount } from "./account-scope";
import { restoredTradingContextForSavedAccount } from "./active-account-context";
import type { ActiveSetupBindingRecord } from "./setup-repository";

const NOW = 1_725_000_000_000;
const MASTER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";
const binding = {
  network: "testnet" as const,
  masterAccount: MASTER,
  targetAccount: MASTER,
  agentAddress: AGENT,
  generation: 1,
};
const account: SavedAccount = {
  id: "testnet-account",
  label: "Testnet account",
  network: "testnet",
  masterAccount: MASTER,
  target: { kind: "master", address: MASTER },
  authorization: {
    agentAddress: AGENT,
    generation: 1,
    registrationName: "Hyper Trader",
    registrationState: "active",
    requestedExpiryMs: NOW + 2_592_000_000,
    effectiveExpiryMs: NOW + 2_500_000_000,
    lastVerifiedAtMs: NOW - 1_000,
    credentialState: "protected",
  },
  reconciliation: { pendingCount: 0, allDurable: true },
};
const activeBinding: ActiveSetupBindingRecord = {
  binding,
  registrationName: "Hyper Trader",
  requestedExpiry: NOW + 2_592_000_000,
  effectiveExpiry: NOW + 2_500_000_000,
  activatedAt: NOW - 1_000,
};
const manifest = {
  version: 1 as const,
  installationEpoch: "install_123456789",
  records: [
    {
      bindingId: custodyBindingId(binding),
      network: "testnet" as const,
      agentAddress: AGENT,
      generation: 1,
      recordVersion: 1 as const,
    },
  ],
};

describe("active account context restoration", () => {
  test("restores signer identity only when activation and custody agree", () => {
    expect(
      restoredTradingContextForSavedAccount({
        account,
        activeBinding,
        manifest,
        nowMs: NOW,
      }),
    ).toEqual({
      network: "testnet",
      masterAccount: MASTER,
      targetAccount: MASTER,
      signer: { agentAddress: AGENT, generation: 1 },
    });
  });

  test("keeps an account read-only when either independent proof is absent", () => {
    const expected = {
      network: "testnet" as const,
      masterAccount: MASTER,
      targetAccount: MASTER,
      signer: null,
    };
    expect(
      restoredTradingContextForSavedAccount({
        account,
        activeBinding: null,
        manifest,
        nowMs: NOW,
      }),
    ).toEqual(expected);
    expect(
      restoredTradingContextForSavedAccount({
        account,
        activeBinding,
        manifest: null,
        nowMs: NOW,
      }),
    ).toEqual(expected);
  });

  test("does not restore expired or mismatched authorization metadata", () => {
    const expired = {
      ...account,
      authorization: {
        ...account.authorization,
        effectiveExpiryMs: NOW,
      },
    };
    expect(
      restoredTradingContextForSavedAccount({
        account: expired,
        activeBinding,
        manifest,
        nowMs: NOW,
      }).signer,
    ).toBeNull();
    expect(
      restoredTradingContextForSavedAccount({
        account,
        activeBinding: {
          ...activeBinding,
          effectiveExpiry: activeBinding.effectiveExpiry + 1,
        },
        manifest,
        nowMs: NOW,
      }).signer,
    ).toBeNull();
  });
});

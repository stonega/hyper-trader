import { describe, expect, test } from "bun:test";

import {
  contextIdentityKey,
  createContextSupervisor,
  signerScopeKey,
  type TradingContextIdentity,
} from "./supervisor";

const accountA: TradingContextIdentity = {
  network: "testnet",
  masterAccount: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  targetAccount: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  signer: {
    agentAddress: "0x1111111111111111111111111111111111111111",
    generation: 1,
  },
};

const accountB: TradingContextIdentity = {
  network: "testnet",
  masterAccount: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  targetAccount: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  signer: {
    agentAddress: "0x2222222222222222222222222222222222222222",
    generation: 2,
  },
};

describe("context supervisor", () => {
  test("advances the epoch before canceling and committing a switch", async () => {
    const events: string[] = [];
    const supervisor = createContextSupervisor({
      initial: accountA,
      cancelPrivateQueries: async (_context, epoch) => {
        events.push(`cancel:${epoch}`);
      },
      lockSignerSession: (_reason, epoch) => events.push(`lock:${epoch}`),
      invalidateDrafts: (_context, epoch) => events.push(`draft:${epoch}`),
      removeIncompatiblePrivateQueries: (_context, epoch) =>
        events.push(`remove:${epoch}`),
      onCommit: (_context, epoch) => events.push(`commit:${epoch}`),
    });

    const captured = supervisor.capture();
    const result = await supervisor.switchContext(accountB);

    expect(result.epoch).toBe(captured.epoch + 1);
    expect(events).toEqual([
      "cancel:1",
      "lock:1",
      "draft:1",
      "remove:1",
      "commit:1",
    ]);
    expect(supervisor.canCommit(captured)).toBe(false);
    expect(supervisor.capture().identityKey).toBe(contextIdentityKey(accountB));
  });

  test("does not put signer identity in the account/public context key", () => {
    const supervisor = createContextSupervisor({ initial: accountA });
    const first = supervisor.capture();
    const signerChanged = {
      ...accountA,
      signer: {
        agentAddress: accountA.signer?.agentAddress ?? "",
        generation: 99,
      },
    };

    expect(contextIdentityKey(signerChanged)).toBe(first.identityKey);
    expect(signerScopeKey(signerChanged)).not.toBe(first.signerScopeKey);
  });

  test("serializes concurrent switches so an earlier switch cannot commit late", async () => {
    let releaseFirst: () => void = () => undefined;
    const firstCanceled = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const commits: string[] = [];
    const supervisor = createContextSupervisor({
      initial: accountA,
      cancelPrivateQueries: async (next) => {
        if (next.targetAccount === accountB.targetAccount?.toLowerCase()) {
          await firstCanceled;
        }
      },
      onCommit: (next) => commits.push(next.targetAccount ?? "read-only"),
    });
    const accountC = {
      ...accountB,
      targetAccount: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    };

    const first = supervisor.switchContext(accountB);
    const second = supervisor.switchContext(accountC);
    await second;
    releaseFirst();
    await first;

    expect(commits).toEqual([accountC.targetAccount.toLowerCase()]);
    expect(supervisor.capture().identityKey).toBe(contextIdentityKey(accountC));
  });

  test("fails closed when cancellation fails", async () => {
    const events: string[] = [];
    const supervisor = createContextSupervisor({
      initial: accountA,
      cancelPrivateQueries: async () => {
        throw new Error("cancel failed");
      },
      lockSignerSession: () => events.push("lock"),
      onCommit: () => events.push("commit"),
    });
    const initialCapture = supervisor.capture();

    expect(supervisor.switchContext(accountB)).rejects.toThrow("cancel failed");
    expect(supervisor.capture().identityKey).toBe(initialCapture.identityKey);
    expect(events).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";

import type {
  Eip712Payload,
  Eip712Signature,
  SignerBinding,
} from "@hyper-trader/hyperliquid";

import {
  createSignerSessionManager,
  type ProtectedAgentSecret,
  type SessionTimer,
  SIGNER_SESSION_DURATION_MS,
  shouldLockSignerSessionForLifecycle,
} from "./manager";

const BINDING: SignerBinding = {
  network: "testnet",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  agentAddress: "0x3333333333333333333333333333333333333333",
  generation: 1,
};
const PAYLOAD: Eip712Payload = {
  domain: {
    name: "Exchange",
    version: "1",
    chainId: 1_337,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  },
  types: { Agent: [{ name: "source", type: "string" }] },
  primaryType: "Agent",
  message: { source: "b" },
};
const SIGNATURE: Eip712Signature = {
  r: `0x${"1".repeat(64)}`,
  s: `0x${"2".repeat(64)}`,
  v: 27,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createTimer() {
  let now = 10_000;
  let callback: (() => void) | null = null;
  const timer: SessionTimer = {
    now: () => now,
    schedule(_duration, handler) {
      callback = handler;
      return 1;
    },
    cancel() {
      callback = null;
    },
  };
  return {
    timer,
    advance(duration: number) {
      now += duration;
    },
    fire() {
      callback?.();
    },
  };
}

function secret(binding = BINDING): ProtectedAgentSecret & {
  readonly disposed: () => boolean;
} {
  let disposed = false;
  return {
    binding,
    bytes: new Uint8Array(32).fill(7),
    dispose() {
      disposed = true;
      this.bytes.fill(0);
    },
    disposed: () => disposed,
  };
}

describe("signer session manager", () => {
  test("permits only the expected native authentication overlay while unlocking", () => {
    const unlocking = {
      status: "unlocking" as const,
      epoch: 1,
      binding: BINDING,
      capturedContextEpoch: 4,
    };
    expect(shouldLockSignerSessionForLifecycle(unlocking, "app_inactive")).toBe(
      false,
    );
    expect(shouldLockSignerSessionForLifecycle(unlocking, "android_blur")).toBe(
      false,
    );
    expect(
      shouldLockSignerSessionForLifecycle(unlocking, "app_background"),
    ).toBe(true);
    expect(
      shouldLockSignerSessionForLifecycle(
        {
          status: "unlocked",
          epoch: 1,
          binding: BINDING,
          capturedContextEpoch: 4,
          unlockedAt: 10_000,
          expiresAt: 20_000,
        },
        "app_inactive",
      ),
    ).toBe(true);
  });

  test("denies mainnet before authentication or credential access", async () => {
    let authReads = 0;
    let vaultReads = 0;
    const timer = createTimer();
    const manager = createSignerSessionManager({
      timer: timer.timer,
      deviceAuth: {
        assertAvailable: async () => {
          authReads += 1;
        },
      },
      vault: {
        read: async () => {
          vaultReads += 1;
          return secret();
        },
      },
      signerFactory: async () => {
        throw new Error("unreachable");
      },
      isActiveAndFocused: () => true,
    });
    await expect(
      manager.unlock({
        binding: { ...BINDING, network: "mainnet" },
        capturedContextEpoch: 1,
        isContextCurrent: () => true,
      }),
    ).rejects.toThrow("mainnet signing is disabled");
    expect(authReads).toBe(0);
    expect(vaultReads).toBe(0);
  });

  test("single-flights unlock and discards a late secret after lock", async () => {
    const read = deferred<ProtectedAgentSecret>();
    const material = secret();
    const timer = createTimer();
    let vaultReads = 0;
    const manager = createSignerSessionManager({
      timer: timer.timer,
      deviceAuth: { assertAvailable: async () => undefined },
      vault: {
        read: () => {
          vaultReads += 1;
          return read.promise;
        },
      },
      signerFactory: async () => ({
        binding: BINDING,
        signTypedData: async () => SIGNATURE,
        destroy: () => undefined,
      }),
      isActiveAndFocused: () => true,
    });
    const input = {
      binding: BINDING,
      capturedContextEpoch: 4,
      isContextCurrent: () => true,
    };
    const first = manager.unlock(input);
    const second = manager.unlock(input);
    expect(first).toBe(second);
    await Promise.resolve();
    await Promise.resolve();
    expect(vaultReads).toBe(1);

    manager.lock("app_background");
    read.resolve(material);
    await expect(first).rejects.toMatchObject({ code: "session_invalidated" });
    expect(material.disposed()).toBe(true);
    expect(manager.read().status).toBe("locked");
  });

  test("discards a protected key if the authentication sheet resolves before focus returns", async () => {
    const read = deferred<ProtectedAgentSecret>();
    const material = secret();
    const timer = createTimer();
    let active = true;
    const manager = createSignerSessionManager({
      timer: timer.timer,
      deviceAuth: { assertAvailable: async () => undefined },
      vault: { read: () => read.promise },
      signerFactory: async () => ({
        binding: BINDING,
        signTypedData: async () => SIGNATURE,
        destroy: () => undefined,
      }),
      isActiveAndFocused: () => active,
    });
    const unlock = manager.unlock({
      binding: BINDING,
      capturedContextEpoch: 4,
      isContextCurrent: () => true,
    });
    await Promise.resolve();
    await Promise.resolve();
    active = false;
    read.resolve(material);

    await expect(unlock).rejects.toMatchObject({ code: "app_not_active" });
    expect(material.disposed()).toBe(true);
    expect(manager.read()).toMatchObject({
      status: "locked",
      reason: "app_inactive",
    });
  });

  test("waits for the bounded active return after protected authentication", async () => {
    const read = deferred<ProtectedAgentSecret>();
    const activeReturn = deferred<boolean>();
    const material = secret();
    const timer = createTimer();
    let active = true;
    let signerCreations = 0;
    const manager = createSignerSessionManager({
      timer: timer.timer,
      deviceAuth: { assertAvailable: async () => undefined },
      vault: { read: () => read.promise },
      signerFactory: async () => {
        signerCreations += 1;
        return {
          binding: BINDING,
          signTypedData: async () => SIGNATURE,
          destroy: () => undefined,
        };
      },
      isActiveAndFocused: () => active,
      waitUntilActiveAndFocused: () => activeReturn.promise,
    });
    const unlock = manager.unlock({
      binding: BINDING,
      capturedContextEpoch: 4,
      isContextCurrent: () => true,
    });
    await Promise.resolve();
    await Promise.resolve();
    active = false;
    read.resolve(material);
    await Promise.resolve();
    await Promise.resolve();
    expect(signerCreations).toBe(0);

    active = true;
    activeReturn.resolve(true);

    await expect(unlock).resolves.toMatchObject({ status: "unlocked" });
    expect(signerCreations).toBe(1);
    expect(material.disposed()).toBe(true);
  });

  test("publishes only for the exact current binding and context epoch", async () => {
    const timer = createTimer();
    const wrongTarget = { ...BINDING, targetAccount: BINDING.masterAccount };
    const material = secret(wrongTarget);
    const manager = createSignerSessionManager({
      timer: timer.timer,
      deviceAuth: { assertAvailable: async () => undefined },
      vault: { read: async () => material },
      signerFactory: async () => {
        throw new Error("must reject before signer construction");
      },
      isActiveAndFocused: () => true,
    });
    await expect(
      manager.unlock({
        binding: BINDING,
        capturedContextEpoch: 2,
        isContextCurrent: () => true,
      }),
    ).rejects.toThrow("exact action target");
    expect(material.disposed()).toBe(true);
  });

  test("classifies a missing or invalidated protected key as a credential stop", async () => {
    const timer = createTimer();
    const invalidated = Object.assign(new Error("native key invalidated"), {
      code: "missing_or_invalidated",
    });
    const manager = createSignerSessionManager({
      timer: timer.timer,
      deviceAuth: { assertAvailable: async () => undefined },
      vault: { read: async () => Promise.reject(invalidated) },
      signerFactory: async () => {
        throw new Error("unreachable");
      },
      isActiveAndFocused: () => true,
    });
    await expect(
      manager.unlock({
        binding: BINDING,
        capturedContextEpoch: 3,
        isContextCurrent: () => true,
      }),
    ).rejects.toBe(invalidated);
    expect(manager.read()).toMatchObject({
      status: "locked",
      reason: "credential_invalidated",
    });
  });

  test("uses a five-minute non-sliding timeout and locks every sign boundary", async () => {
    const timer = createTimer();
    let destroyCalls = 0;
    const manager = createSignerSessionManager({
      timer: timer.timer,
      deviceAuth: { assertAvailable: async () => undefined },
      vault: { read: async () => secret() },
      signerFactory: async () => ({
        binding: BINDING,
        signTypedData: async () => SIGNATURE,
        destroy: () => {
          destroyCalls += 1;
        },
      }),
      isActiveAndFocused: () => true,
    });
    await manager.unlock({
      binding: BINDING,
      capturedContextEpoch: 8,
      isContextCurrent: () => true,
    });
    const initial = manager.read();
    expect(initial.status).toBe("unlocked");
    if (initial.status !== "unlocked") throw new Error("expected session");
    expect(initial.expiresAt - initial.unlockedAt).toBe(
      SIGNER_SESSION_DURATION_MS,
    );

    timer.advance(4 * 60 * 1_000);
    await manager.signTypedData({
      expectedBinding: BINDING,
      payload: PAYLOAD,
      capturedContextEpoch: 8,
      isContextCurrent: () => true,
    });
    const afterSign = manager.read();
    expect(afterSign.status).toBe("unlocked");
    if (afterSign.status !== "unlocked") throw new Error("expected session");
    expect(afterSign.expiresAt).toBe(initial.expiresAt);

    timer.advance(60_000);
    timer.fire();
    expect(manager.read()).toMatchObject({
      status: "locked",
      reason: "timeout",
    });
    expect(destroyCalls).toBe(1);
    await expect(
      manager.signTypedData({
        expectedBinding: BINDING,
        payload: PAYLOAD,
        capturedContextEpoch: 8,
        isContextCurrent: () => true,
      }),
    ).rejects.toThrow("locked");
  });
});

import { describe, expect, test } from "bun:test";

import { createSignerActivityGate } from "./activity-gate";

function timer() {
  let callback: (() => void) | null = null;
  let cancelled = false;
  return {
    port: {
      schedule(_durationMs: number, next: () => void) {
        callback = next;
        return 1;
      },
      cancel() {
        cancelled = true;
        callback = null;
      },
    },
    fire() {
      callback?.();
    },
    wasCancelled: () => cancelled,
  };
}

describe("signer activity gate", () => {
  test("settles a transient authentication-sheet focus loss on active return", async () => {
    const clock = timer();
    const gate = createSignerActivityGate({
      initiallyActiveAndFocused: false,
      timer: clock.port,
      settleWindowMs: 100,
    });
    const pending = gate.waitUntilActiveAndFocused();

    gate.setActiveAndFocused(true);

    await expect(pending).resolves.toBe(true);
    expect(gate.isActiveAndFocused()).toBe(true);
    expect(clock.wasCancelled()).toBe(true);
  });

  test("fails waiting immediately on background interruption", async () => {
    const clock = timer();
    const gate = createSignerActivityGate({
      initiallyActiveAndFocused: false,
      timer: clock.port,
      settleWindowMs: 100,
    });
    const pending = gate.waitUntilActiveAndFocused();

    gate.interrupt();

    await expect(pending).resolves.toBe(false);
    expect(gate.isActiveAndFocused()).toBe(false);
  });

  test("recovers when native activity listeners are rebound", async () => {
    const gate = createSignerActivityGate({
      initiallyActiveAndFocused: true,
    });

    gate.interrupt();
    expect(gate.isActiveAndFocused()).toBe(false);

    gate.setActiveAndFocused(true);
    await expect(gate.waitUntilActiveAndFocused()).resolves.toBe(true);
    expect(gate.isActiveAndFocused()).toBe(true);
  });

  test("fails closed when focus does not return within the bounded window", async () => {
    const clock = timer();
    const gate = createSignerActivityGate({
      initiallyActiveAndFocused: false,
      timer: clock.port,
      settleWindowMs: 100,
    });
    const pending = gate.waitUntilActiveAndFocused();

    clock.fire();

    await expect(pending).resolves.toBe(false);
  });
});

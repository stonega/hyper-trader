import { describe, expect, test } from "bun:test";

import { createCoalescedTask } from "./coalesced-task";

describe("coalesced task", () => {
  test("collapses a burst into one task without extending its window", () => {
    const callbacks: (() => void)[] = [];
    const delays: number[] = [];
    let calls = 0;
    const task = createCoalescedTask(
      () => {
        calls += 1;
      },
      250,
      {
        set(callback, delayMs) {
          callbacks.push(callback);
          delays.push(delayMs);
          return callback;
        },
        clear() {},
      },
    );

    task.schedule();
    task.schedule();
    task.schedule();

    expect(callbacks).toHaveLength(1);
    expect(delays).toEqual([250]);
    callbacks[0]?.();
    expect(calls).toBe(1);

    task.schedule();
    expect(callbacks).toHaveLength(2);
  });

  test("cancels pending work", () => {
    const callbacks: (() => void)[] = [];
    const cleared: unknown[] = [];
    let calls = 0;
    const task = createCoalescedTask(
      () => {
        calls += 1;
      },
      100,
      {
        set(callback) {
          callbacks.push(callback);
          return callback;
        },
        clear(handle) {
          cleared.push(handle);
        },
      },
    );

    task.schedule();
    task.cancel();

    expect(cleared).toEqual([callbacks[0]]);
    expect(calls).toBe(0);
  });

  test("rejects invalid delays", () => {
    expect(() => createCoalescedTask(() => undefined, -1)).toThrow(
      "non-negative",
    );
  });
});

import { describe, expect, test } from "bun:test";

import { runManualRefresh } from "./manual-refresh";

describe("manual market refresh", () => {
  test("shows the indicator only for one manual refresh", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const gate = { current: false };
    const changes: boolean[] = [];
    let calls = 0;
    const refresh = async () => {
      calls += 1;
      await pending;
    };

    const first = runManualRefresh(gate, refresh, (value) => {
      changes.push(value);
    });
    await runManualRefresh(gate, refresh, (value) => {
      changes.push(value);
    });

    expect(calls).toBe(1);
    expect(changes).toEqual([true]);
    finish();
    await first;
    expect(changes).toEqual([true, false]);
  });

  test("clears the indicator when refresh fails", async () => {
    const gate = { current: false };
    const changes: boolean[] = [];

    await expect(
      runManualRefresh(
        gate,
        async () => {
          throw new Error("refresh failed");
        },
        (value) => {
          changes.push(value);
        },
      ),
    ).rejects.toThrow("refresh failed");

    expect(gate.current).toBe(false);
    expect(changes).toEqual([true, false]);
  });
});

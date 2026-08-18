import { describe, expect, test } from "bun:test";

const entrypoint = new URL("./testnet-order-workflow.ts", import.meta.url)
  .pathname;

describe("guarded testnet order workflow example", () => {
  test("runs only in explicit offline mode and emits a redacted summary", async () => {
    const child = Bun.spawn([process.execPath, entrypoint], {
      env: {
        ...process.env,
        HYPER_TRADER_TESTNET_ORDER_WORKFLOW: "offline-fixture",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(child.stdout).text();
    expect(await new Response(child.stderr).text()).toBe("");
    expect(await child.exited).toBe(0);
    expect(JSON.parse(output)).toEqual({
      network: "testnet",
      mode: "offline-fixture",
      actionType: "limit_order",
      validation: "passed",
      transport: "not_called",
    });
    expect(output).not.toMatch(
      /0x|account|cloid|private|secret|signature|payload|actionBytes|exchangeBody/i,
    );
  });

  test("fails closed when the opt-in switch is absent or requests live mode", async () => {
    for (const requestedMode of [undefined, "live"] as const) {
      const env = { ...process.env };
      delete env.HYPER_TRADER_TESTNET_ORDER_WORKFLOW;
      if (requestedMode !== undefined) {
        env.HYPER_TRADER_TESTNET_ORDER_WORKFLOW = requestedMode;
      }
      const child = Bun.spawn([process.execPath, entrypoint], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      await new Response(child.stdout).text();
      await new Response(child.stderr).text();
      expect(await child.exited).not.toBe(0);
    }
  });
});

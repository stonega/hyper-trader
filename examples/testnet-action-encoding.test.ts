import { describe, expect, test } from "bun:test";

const entrypoint = new URL("./testnet-action-encoding.ts", import.meta.url)
  .pathname;

describe("testnet action encoding example", () => {
  test("bundles, runs offline, and emits only the approved redacted summary", async () => {
    const build = await Bun.build({
      entrypoints: [entrypoint],
      packages: "external",
      target: "bun",
      write: false,
    });
    expect(build.success).toBe(true);

    const child = Bun.spawn([process.execPath, entrypoint], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(child.stdout).text();
    expect(await new Response(child.stderr).text()).toBe("");
    expect(await child.exited).toBe(0);
    const summary = JSON.parse(output) as Record<string, unknown>;
    expect(Object.keys(summary).sort()).toEqual([
      "actionHash",
      "actionType",
      "expiresAfter",
      "network",
      "nonce",
      "source",
    ]);
    expect(summary.network).toBe("testnet");
    expect(summary.source).toBe("b");
    expect(summary.actionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(output).not.toMatch(
      /private|signature|typedData|actionBytes|exchangeBody|0x[0-9a-f]{128,}/i,
    );
  });
});

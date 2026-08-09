import { describe, expect, test } from "bun:test";
import { dirname, relative, resolve } from "node:path";

import * as publicApi from "./public";

describe("public-only export boundary", () => {
  test("contains public transports and market reads without account or action APIs", async () => {
    expect(publicApi.createPublicHyperliquidClient).toBeFunction();
    expect(publicApi.openPublicWebSocketSession).toBeFunction();
    expect("createAccountDataClient" in publicApi).toBe(false);
    expect("createHyperliquidClient" in publicApi).toBe(false);
    expect("submitExchangeAction" in publicApi).toBe(false);
    expect("buildMarketOrderAction" in publicApi).toBe(false);
    expect("signTestnetTypedData" in publicApi).toBe(false);

    const source = await Bun.file(
      new URL("./public.ts", import.meta.url),
    ).text();
    expect(source).not.toContain("./accounts");
    expect(source).not.toContain("signer");
    expect(source).not.toContain("./actions");
    expect(source).not.toContain("./signing");
    expect(source).not.toContain("/exchange");
  });

  test("cannot transitively reach authenticated action or signing modules", async () => {
    const sourceRoot = new URL(".", import.meta.url).pathname;
    const entrypoint = new URL("./public.ts", import.meta.url).pathname;
    const visited = new Set<string>();
    const pending = [entrypoint];
    const imports = /(?:from\s*|import\s*)["'](\.[^"']+)["']/g;

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || visited.has(current)) {
        continue;
      }
      visited.add(current);
      const source = await Bun.file(current).text();
      for (const match of source.matchAll(imports)) {
        const specifier = match[1];
        if (specifier === undefined) {
          continue;
        }
        const unresolved = resolve(dirname(current), specifier);
        const candidates = [
          unresolved,
          `${unresolved}.ts`,
          resolve(unresolved, "index.ts"),
        ];
        const dependency = (
          await Promise.all(
            candidates.map(async (candidate) => ({
              candidate,
              exists: await Bun.file(candidate).exists(),
            })),
          )
        ).find(({ exists }) => exists)?.candidate;
        if (dependency !== undefined) {
          pending.push(dependency);
        }
      }
    }

    const reached = [...visited].map((path) => relative(sourceRoot, path));
    expect(
      reached.filter((path) =>
        /^(?:actions|signing|nonces|reconciliation)\//.test(path),
      ),
    ).toEqual([]);
  });
});

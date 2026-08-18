import { describe, expect, test } from "bun:test";
import { dirname, relative, resolve } from "node:path";

import * as mobileApi from "./mobile";

describe("notification mobile export boundary", () => {
  test("exports transport-neutral request and response contracts", () => {
    expect(mobileApi.parseCreateRuleRequest).toBeFunction();
    expect(mobileApi.parseMobileAlertResponse).toBeFunction();
    expect(mobileApi.parseMobileInstallationSnapshotResponse).toBeFunction();
    expect("hashInstallationCredential" in mobileApi).toBe(false);
    expect("encryptPushToken" in mobileApi).toBe(false);
  });

  test("cannot transitively reach server credentials, crypto, database, or application code", async () => {
    const sourceRoot = new URL(".", import.meta.url).pathname;
    const entrypoint = new URL("./mobile.ts", import.meta.url).pathname;
    const visited = new Set<string>();
    const pending = [entrypoint];
    const imports = /(?:from\s*|import\s*)["']([^"']+)["']/g;
    const forbiddenImports: string[] = [];

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      const source = await Bun.file(current).text();
      for (const match of source.matchAll(imports)) {
        const specifier = match[1];
        if (!specifier) continue;
        if (
          specifier === "node:crypto" ||
          specifier.includes("apps/notifications") ||
          specifier.includes("notification-store") ||
          specifier.includes("application")
        ) {
          forbiddenImports.push(specifier);
        }
        if (!specifier.startsWith(".")) continue;
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
        if (dependency) pending.push(dependency);
      }
    }

    expect(forbiddenImports).toEqual([]);
    expect(
      [...visited].map((path) => relative(sourceRoot, path)).sort(),
    ).toEqual(["contracts.ts", "mobile-contracts.ts", "mobile.ts"]);
  });
});

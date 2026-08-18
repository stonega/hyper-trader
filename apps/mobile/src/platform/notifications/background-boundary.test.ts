import { describe, expect, test } from "bun:test";
import { dirname, relative, resolve } from "node:path";

describe("background notification boundary", () => {
  test("cannot reach signing, custody, private refresh, or exchange submission", async () => {
    const sourceRoot = new URL("../../", import.meta.url).pathname;
    const entrypoint = new URL("./background-task.ts", import.meta.url)
      .pathname;
    const visited = new Set<string>();
    const pending = [entrypoint];
    const imports = /(?:from\s*|import\s*)["']([^"']+)["']/g;

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      const source = await Bun.file(current).text();
      for (const match of source.matchAll(imports)) {
        const specifier = match[1];
        if (!specifier?.startsWith(".")) continue;
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

    expect(
      [...visited].map((path) => relative(sourceRoot, path)).sort(),
    ).toEqual([
      "features/notifications/intent.ts",
      "features/notifications/pending-intent.ts",
      "platform/notifications/background-payload.ts",
      "platform/notifications/background-task.ts",
      "platform/notifications/pending-intent-runtime.ts",
    ]);
    const joined = [...visited].join("\n");
    expect(joined).not.toMatch(
      /actions|credential-vault|exchange|service-client|session|sign|wallet/i,
    );
  });
});

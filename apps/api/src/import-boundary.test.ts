import { describe, expect, test } from "bun:test";

const ROOT = new URL("../../../", import.meta.url).pathname;

describe("notification trust boundary", () => {
  test("imports Hyperliquid only through the public entry point", async () => {
    const imports: string[] = [];
    for await (const relative of notificationFiles("**/*.ts")) {
      const source = await Bun.file(`${ROOT}/${relative}`).text();
      imports.push(
        ...Array.from(
          source.matchAll(/from\s+["'](@hyper-trader\/hyperliquid[^"']*)["']/g),
          (match) => match[1] ?? "",
        ),
      );
    }
    expect(new Set(imports)).toEqual(
      new Set(imports.length === 0 ? [] : ["@hyper-trader/hyperliquid/public"]),
    );
  });

  test("contains no literal private keys or persisted proof signatures", async () => {
    const violations: string[] = [];
    for await (const relative of notificationFiles("**/*")) {
      if (!/\.(?:ts|json|sql)$/.test(relative)) continue;
      const source = await Bun.file(`${ROOT}/${relative}`).text();
      if (/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(source)) {
        violations.push(`${relative}: 256-bit hex literal`);
      }
      if (/0x[0-9a-fA-F]{130}(?![0-9a-fA-F])/.test(source)) {
        violations.push(`${relative}: complete proof signature literal`);
      }
      if (
        /(?:mnemonic|seedPhrase|seed_phrase)\s*[:=]\s*["'`](?:[a-z]+\s+){11,23}[a-z]+["'`]/i.test(
          source,
        )
      ) {
        violations.push(`${relative}: possible seed phrase literal`);
      }
      if (
        /\b(signature|message|proof_bytes|raw_challenge)\s+(?:bytea|text)\b/i.test(
          source,
        )
      ) {
        violations.push(`${relative}: persisted proof material column`);
      }
    }
    expect(violations).toEqual([]);
  });
});

async function* notificationFiles(pattern: string): AsyncGenerator<string> {
  for await (const relative of new Bun.Glob(pattern).scan({ cwd: ROOT })) {
    if (
      relative.startsWith("apps/api/") ||
      relative.startsWith("packages/notifications/") ||
      relative === "docs/implementation/notification-service.md" ||
      relative === "examples/notification-proof-digests.ts"
    ) {
      yield relative;
    }
  }
}

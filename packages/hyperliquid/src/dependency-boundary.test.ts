import { describe, expect, test } from "bun:test";

describe("shared package dependency boundary", () => {
  test("production modules never import native custody or persistence APIs", async () => {
    const root = new URL(".", import.meta.url).pathname;
    const files: string[] = [];
    for await (const path of new Bun.Glob("**/*.ts").scan({
      cwd: root,
      onlyFiles: true,
    })) {
      if (!path.endsWith(".test.ts") && !path.endsWith(".fixture.ts")) {
        files.push(path);
      }
    }
    for (const path of files) {
      const source = await Bun.file(`${root}/${path}`).text();
      expect(source).not.toMatch(
        /["'](?:expo(?:-[^"']+)?|@react-native\/[^"']+|react-native(?:\/[^"']+)?|bun:sqlite|node:sqlite)["']/,
      );
    }
    const manifest = (await Bun.file(`${root}/../package.json`).json()) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };
    const dependencyNames = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    expect(
      dependencyNames.filter((name) =>
        /^(?:expo(?:-|$)|@react-native\/|react-native(?:-|$))|sqlite/i.test(
          name,
        ),
      ),
    ).toEqual([]);
  });
});

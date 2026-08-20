import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("production release contract", () => {
  test("keeps OTA disabled and exposes separate deterministic and device mobile gates", async () => {
    const rootPackage = await readJson(join(repositoryRoot, "package.json"));
    const appConfig = await readJson(
      join(repositoryRoot, "apps/mobile/app.json"),
    );
    const scripts = rootPackage.scripts as Record<string, string>;
    const expo = appConfig.expo as {
      readonly platforms?: readonly string[];
      readonly updates?: { readonly enabled?: boolean };
      readonly plugins?: readonly unknown[];
    };
    const routerPlugin = expo.plugins?.find(
      (
        plugin,
      ): plugin is readonly [string, { readonly asyncRoutes?: unknown }] =>
        Array.isArray(plugin) && plugin[0] === "expo-router",
    );

    expect(expo.platforms).toEqual(["ios", "android"]);
    expect(expo.updates).toEqual({ enabled: false });
    expect(routerPlugin?.[1].asyncRoutes).toBe(false);
    expect(scripts["test:mobile"]).toBeTruthy();
    expect(scripts["test:e2e:mobile"]).toBeTruthy();
    expect(scripts["test:e2e:mobile:device"]).toBeTruthy();
    expect(scripts["check:secrets"]).toBeTruthy();
    expect(scripts["test:e2e:mobile"]).not.toBe(
      scripts["test:e2e:mobile:device"],
    );
  });

  test("declares every controlled Maestro fixture journey", async () => {
    const journeyDirectory = join(repositoryRoot, "apps/mobile/e2e/flows");
    const journeys = (await readdir(journeyDirectory))
      .filter((path) => path.endsWith(".yaml"))
      .sort();

    expect(journeys).toEqual([
      "account-switch.yaml",
      "market-search.yaml",
      "notification-context-entry.yaml",
      "portfolio-close.yaml",
      "read-only-launch.yaml",
      "rotation.yaml",
      "setup-interruption.yaml",
      "testnet-order-review.yaml",
      "unknown-result-recovery.yaml",
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  abiForApkName,
  assetNameForTag,
  isPrereleaseTag,
  loadArtifacts,
  parseConfig,
  verifyExistingAsset,
} from "./publish-github-release.mjs";

const validEnvironment = {
  ANDROID_APP_VERSION: "1.2.3",
  ANDROID_APK_PATH: "/tmp/hyper-trader.apk",
  GITHUB_RELEASE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
  GITHUB_RELEASE_TAG: "v1.2.3",
  GITHUB_RELEASE_TOKEN: "secret-token",
  GITHUB_REPOSITORY: "stonega/hyper-trader",
};

describe("GitHub Release publishing", () => {
  test("derives stable APK names and prerelease state from the tag", () => {
    expect(assetNameForTag("v1.2.3", "arm64-v8a")).toBe(
      "hyper-trader-v1.2.3-android-arm64-v8a.apk",
    );
    expect(isPrereleaseTag("v1.2.3")).toBe(false);
    expect(isPrereleaseTag("v1.2.3-rc.1")).toBe(true);
  });

  test("recognizes every Gradle ABI split filename", () => {
    expect(abiForApkName("app-arm64-v8a-release.apk")).toBe("arm64-v8a");
    expect(abiForApkName("app-armeabi-v7a-release.apk")).toBe("armeabi-v7a");
    expect(abiForApkName("app-x86_64-release.apk")).toBe("x86_64");
    expect(abiForApkName("app-x86-release.apk")).toBe("x86");
    expect(() => abiForApkName("app-universal-release.apk")).toThrow(
      "Could not determine one Android ABI",
    );
  });

  test("loads exactly one non-empty APK for each configured ABI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hyper-trader-abi-apks-"));
    const nestedDirectory = join(directory, "nested");

    try {
      await mkdir(nestedDirectory);
      for (const abi of ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"]) {
        await writeFile(
          join(nestedDirectory, `app-${abi}-release.apk`),
          `apk-${abi}`,
        );
      }

      const artifacts = await loadArtifacts(directory, "v1.2.3");
      expect(artifacts.map(({ abi }) => abi).sort()).toEqual([
        "arm64-v8a",
        "armeabi-v7a",
        "x86",
        "x86_64",
      ]);
      expect(artifacts.every(({ sha256 }) => sha256.length === 64)).toBe(true);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("discovers sibling ABI APKs from an EAS downloaded APK path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hyper-trader-eas-apks-"));

    try {
      for (const abi of ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"]) {
        await writeFile(
          join(directory, `app-${abi}-release.apk`),
          `apk-${abi}`,
        );
      }

      const artifacts = await loadArtifacts(
        join(directory, "app-arm64-v8a-release.apk"),
        "v1.2.3",
      );
      expect(artifacts.map(({ abi }) => abi).sort()).toEqual([
        "arm64-v8a",
        "armeabi-v7a",
        "x86",
        "x86_64",
      ]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("accepts stable and prerelease semantic version tags", () => {
    expect(parseConfig(validEnvironment).tag).toBe("v1.2.3");
    expect(
      parseConfig({
        ...validEnvironment,
        ANDROID_APP_VERSION: "2.0.0",
        GITHUB_RELEASE_TAG: "v2.0.0-beta.4",
      }).tag,
    ).toBe("v2.0.0-beta.4");
  });

  test("rejects invalid tags and abbreviated commit hashes", () => {
    expect(() =>
      parseConfig({ ...validEnvironment, GITHUB_RELEASE_TAG: "latest" }),
    ).toThrow("semantic version tag");
    expect(() =>
      parseConfig({ ...validEnvironment, GITHUB_RELEASE_COMMIT: "0123456" }),
    ).toThrow("full Git commit SHA");
  });

  test("rejects a release tag that does not match the built app version", () => {
    expect(() =>
      parseConfig({
        ...validEnvironment,
        GITHUB_RELEASE_TAG: "v1.2.4",
      }),
    ).toThrow("does not match Android app version 1.2.3");
  });

  test("treats a matching existing asset as an idempotent retry", () => {
    expect(
      verifyExistingAsset(
        { digest: "sha256:abc123", name: "app.apk", size: 42 },
        { name: "app.apk", sha256: "abc123", size: 42 },
      ),
    ).toBe(true);
  });

  test("refuses to overwrite an existing asset with different bytes", () => {
    expect(() =>
      verifyExistingAsset(
        { digest: "sha256:different", name: "app.apk", size: 42 },
        { name: "app.apk", sha256: "abc123", size: 42 },
      ),
    ).toThrow("refusing to overwrite");
  });
});

import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  addAndroidAbiSplits,
} = require("../apps/mobile/plugins/with-android-abi-splits.cjs");

const generatedBuildGradle = `apply plugin: "com.android.application"

android {
    namespace "com.example.app"
}
`;

describe("Android ABI split config plugin", () => {
  test("adds four standalone ABI outputs and disables the universal APK", () => {
    const updated = addAndroidAbiSplits(generatedBuildGradle);

    expect(updated).toContain("universalApk false");
    expect(updated).toContain(
      'include "armeabi-v7a", "arm64-v8a", "x86", "x86_64"',
    );
  });

  test("is idempotent across repeated Expo prebuild runs", () => {
    const once = addAndroidAbiSplits(generatedBuildGradle);
    expect(addAndroidAbiSplits(once)).toBe(once);
  });

  test("fails if the generated Gradle structure is ambiguous", () => {
    expect(() => addAndroidAbiSplits("plugins {}\n")).toThrow(
      "Expected one Android Gradle block",
    );
  });
});

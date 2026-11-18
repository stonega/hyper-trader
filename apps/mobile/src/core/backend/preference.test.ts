import { describe, expect, test } from "bun:test";
import { normalizeBackendOrigin, parseBackendPreference } from "./preference";

describe("backend URL preference", () => {
  test("normalizes a complete HTTPS origin and an optional trailing slash", () => {
    expect(normalizeBackendOrigin("  HTTPS://API.Example.com:443/  ")).toBe(
      "https://api.example.com",
    );
    expect(normalizeBackendOrigin("https://13.140.242.169")).toBe(
      "https://13.140.242.169",
    );
    expect(normalizeBackendOrigin("https://[::1]:8788/")).toBe(
      "https://[::1]:8788",
    );
  });

  test("rejects insecure, relative, ambiguous, credentialed, or non-origin URLs", () => {
    for (const value of [
      "",
      "api.example.com",
      "http://api.example.com",
      "//api.example.com",
      "https:api.example.com",
      "https:///api.example.com",
      "https:////api.example.com",
      "https://user:password@api.example.com",
      "https://@api.example.com",
      "https://api.example.com/health",
      "https://api.example.com/a/..",
      "https://api.example.com/%2e",
      "https://api.example.com//",
      "https://api.example.com?",
      "https://api.example.com#",
      "https://api.example.com?token=secret",
      "https://api.example.com/#section",
      "https://api.\nexample.com",
      "https://api.\u0000example.com",
      "https://api.\u007fexample.com",
      "https://api.example.com\\evil",
      `https://${"a".repeat(2048)}.com`,
    ])
      expect(() => normalizeBackendOrigin(value)).toThrow();
  });

  test("restores only a versioned valid preference", () => {
    expect(
      parseBackendPreference(
        JSON.stringify({ version: 1, origin: "https://api.example.com/" }),
      ),
    ).toBe("https://api.example.com");
    for (const value of [
      null,
      "{broken",
      "null",
      "[]",
      "123",
      JSON.stringify({ version: 2, origin: "https://api.example.com" }),
      JSON.stringify({ version: 1, origin: "http://api.example.com" }),
      JSON.stringify({
        version: 1,
        origin: "https://api.example.com",
        token: "unexpected",
      }),
    ]) {
      expect(parseBackendPreference(value)).toBeNull();
    }
  });
});

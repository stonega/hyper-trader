import { describe, expect, test } from "bun:test";

import { appTextClassName } from "./app-text-class-name";

describe("app text typography", () => {
  test("uses the regular app font when no weight is specified", () => {
    expect(appTextClassName("text-base text-foreground")).toBe(
      "font-normal text-base text-foreground",
    );
  });

  test("preserves explicit font variants", () => {
    expect(appTextClassName("text-xl font-semibold text-foreground")).toBe(
      "text-xl font-semibold text-foreground",
    );
  });
});

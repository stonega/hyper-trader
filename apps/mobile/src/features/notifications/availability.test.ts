import { describe, expect, test } from "bun:test";

import { NOTIFICATION_SETTINGS_AVAILABLE } from "./availability";

describe("notification feature availability", () => {
  test("keeps notification settings hidden until service delivery is released", () => {
    expect(NOTIFICATION_SETTINGS_AVAILABLE).toBe(false);
  });
});

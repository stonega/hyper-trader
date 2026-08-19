import { describe, expect, test } from "bun:test";

import { accountSwitcherDialogLayout } from "./global-account-switcher-layout";

describe("account switcher dialog layout", () => {
  test("uses the safe-area edges and leaves the remaining height to content", () => {
    expect(
      accountSwitcherDialogLayout({
        height: 844,
        insetBottom: 34,
        insetLeft: 0,
        insetRight: 0,
        insetTop: 59,
      }),
    ).toEqual({
      maxHeight: 751,
      paddingBottom: 34,
      paddingLeft: 20,
      paddingRight: 20,
      paddingTop: 59,
    });
  });

  test("keeps a minimum edge gutter when no device inset is present", () => {
    expect(
      accountSwitcherDialogLayout({
        height: 640,
        insetBottom: 0,
        insetLeft: 0,
        insetRight: 0,
        insetTop: 0,
      }),
    ).toEqual({
      maxHeight: 600,
      paddingBottom: 20,
      paddingLeft: 20,
      paddingRight: 20,
      paddingTop: 20,
    });
  });

  test("never produces a negative or non-finite content height", () => {
    expect(
      accountSwitcherDialogLayout({
        height: Number.NaN,
        insetBottom: Number.POSITIVE_INFINITY,
        insetLeft: -1,
        insetRight: Number.NaN,
        insetTop: 30,
      }),
    ).toEqual({
      maxHeight: 0,
      paddingBottom: 20,
      paddingLeft: 20,
      paddingRight: 20,
      paddingTop: 30,
    });
  });
});

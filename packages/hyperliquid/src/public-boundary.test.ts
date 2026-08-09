import { describe, expect, test } from "bun:test";

import * as publicApi from "./public";

describe("public-only export boundary", () => {
  test("contains public transports and market reads without account or action APIs", async () => {
    expect(publicApi.createPublicHyperliquidClient).toBeFunction();
    expect(publicApi.openPublicWebSocketSession).toBeFunction();
    expect("createAccountDataClient" in publicApi).toBe(false);
    expect("createHyperliquidClient" in publicApi).toBe(false);
    expect("submitExchangeAction" in publicApi).toBe(false);

    const source = await Bun.file(
      new URL("./public.ts", import.meta.url),
    ).text();
    expect(source).not.toContain("./accounts");
    expect(source).not.toContain("signer");
    expect(source).not.toContain("/exchange");
  });
});

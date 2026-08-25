import { describe, expect, test } from "bun:test";

import {
  HIP3_DUPLICATE,
  MARKET_FIXTURE,
  NATIVE_DUPLICATE,
  SPOT_DUPLICATE,
} from "../markets/fixture";
import {
  portfolioAmountTone,
  portfolioMarketLabel,
  portfolioSideColor,
  portfolioSideLabel,
} from "./portfolio-row-presentation";

describe("portfolio row presentation", () => {
  test("uses readable pair labels for perpetual and spot records", () => {
    expect(
      portfolioMarketLabel(
        NATIVE_DUPLICATE.coin,
        MARKET_FIXTURE,
        NATIVE_DUPLICATE,
      ),
    ).toBe("DUP-USDC");
    expect(
      portfolioMarketLabel(HIP3_DUPLICATE.coin, MARKET_FIXTURE, HIP3_DUPLICATE),
    ).toBe("DUP-USDC");
    expect(portfolioMarketLabel(SPOT_DUPLICATE.coin, MARKET_FIXTURE)).toBe(
      "DUP/USDC",
    );
    expect(portfolioMarketLabel("BTC", [])).toBe("BTC-USDC");
  });

  test("expands exchange side codes into trading language", () => {
    expect(portfolioSideLabel("B")).toBe("Buy");
    expect(portfolioSideColor("B")).toBe("success");
    expect(portfolioSideLabel("A")).toBe("Sell");
    expect(portfolioSideColor("A")).toBe("danger");
    expect(portfolioSideLabel("sell")).toBe("Sell");
  });

  test("maps signed amounts to buy and sell colors", () => {
    expect(portfolioAmountTone("2.5")).toBe("success");
    expect(portfolioAmountTone("-2.5")).toBe("danger");
    expect(portfolioAmountTone("0.000")).toBe("default");
    expect(portfolioAmountTone("-0.000")).toBe("default");
  });
});

import { describe, expect, test } from "bun:test";

import { PORTFOLIO_FIXTURE } from "./portfolio.fixture";
import {
  portfolioEditorOwnerScopeKey,
  portfolioEditorPositionExists,
} from "./portfolio-editor-state";
import { normalizePortfolioSnapshot } from "./portfolio-model";
import type { PortfolioEditor } from "./portfolio-rows";

const portfolio = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE);
const editor: PortfolioEditor = {
  kind: "limit_close",
  positionId: portfolio.positions[0]?.id ?? "missing-position",
  limitPrice: "10.25",
  size: "1.25",
};

describe("Portfolio Limit close editor retention", () => {
  test("keeps the owner scope stable across account and market data updates", () => {
    const input = {
      network: "testnet" as const,
      masterAccount: PORTFOLIO_FIXTURE.owner.masterAccount,
      target: PORTFOLIO_FIXTURE.owner.target,
    };

    expect(portfolioEditorOwnerScopeKey(input)).toBe(
      portfolioEditorOwnerScopeKey({ ...input }),
    );
  });

  test("changes the owner scope when the selected account changes", () => {
    const current = portfolioEditorOwnerScopeKey({
      network: "testnet",
      masterAccount: PORTFOLIO_FIXTURE.owner.masterAccount,
      target: PORTFOLIO_FIXTURE.owner.target,
    });
    const next = portfolioEditorOwnerScopeKey({
      network: "testnet",
      masterAccount: "0x0000000000000000000000000000000000000002",
      target: {
        kind: "master",
        address: "0x0000000000000000000000000000000000000002",
      },
    });

    expect(next).not.toBe(current);
  });

  test("retains a draft while its position remains and drops it after removal", () => {
    const updatedPortfolio = {
      ...portfolio,
      observedAtMs: portfolio.observedAtMs + 1_000,
      version: portfolio.version + 1,
      positions: portfolio.positions.map((position) =>
        position.id === editor.positionId
          ? { ...position, absoluteSize: "2" as const }
          : position,
      ),
    };

    expect(portfolioEditorPositionExists(editor, updatedPortfolio)).toBe(true);
    expect(
      portfolioEditorPositionExists(editor, {
        positions: updatedPortfolio.positions.filter(
          (position) => position.id !== editor.positionId,
        ),
      }),
    ).toBe(false);
    expect(portfolioEditorPositionExists(editor, null)).toBe(true);
  });
});

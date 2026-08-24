import type {
  AccountTarget,
  HyperliquidNetwork,
} from "@hyper-trader/hyperliquid";

import type { NormalizedPortfolio } from "./portfolio-model";
import type { PortfolioEditor } from "./portfolio-rows";

export function portfolioEditorOwnerScopeKey(input: {
  readonly network: HyperliquidNetwork;
  readonly masterAccount: string | null;
  readonly target: AccountTarget | null;
}): string {
  const target = input.target;
  const targetScope =
    target === null
      ? null
      : target.kind === "subaccount"
        ? [target.kind, target.address, target.masterAddress]
        : target.kind === "vault"
          ? [target.kind, target.address, target.masterAddress ?? null]
          : [target.kind, target.address];
  return JSON.stringify([input.network, input.masterAccount, targetScope]);
}

export function portfolioEditorPositionExists(
  editor: PortfolioEditor | null,
  portfolio: Pick<NormalizedPortfolio, "positions"> | null,
): boolean {
  if (editor === null || portfolio === null) return true;
  return portfolio.positions.some(
    (position) => position.id === editor.positionId,
  );
}

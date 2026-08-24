import type { AccountTarget } from "@hyper-trader/hyperliquid";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { JSX } from "react";
import { useEffect, useMemo, useRef } from "react";

import { useTradingContext } from "../../core/context/provider";
import type { NormalizedTradingContext } from "../../core/context/supervisor";
import {
  createMarketCatalogQuerySource,
  marketCatalogQueryOptions,
} from "../markets/query";
import {
  createPortfolioQuerySource,
  portfolioAccountQueryOptions,
  portfolioHistoryQueryOptions,
  resolvePortfolioTarget,
} from "./portfolio-query";
import {
  portfolioStartupOwnerKey,
  runPortfolioStartupLoad,
} from "./portfolio-startup";

async function loadPortfolioAtStartup(input: {
  readonly queryClient: QueryClient;
  readonly context: NormalizedTradingContext;
  readonly target: AccountTarget;
  readonly isCurrent: () => boolean;
}): Promise<void> {
  const catalogSource = createMarketCatalogQuerySource(input.context.network);
  const portfolioSource = createPortfolioQuerySource(input.context.network);
  await runPortfolioStartupLoad(
    {
      catalog: () =>
        input.queryClient.fetchQuery(
          marketCatalogQueryOptions(input.context.network, catalogSource),
        ),
      account: (catalog) =>
        input.queryClient.fetchQuery(
          portfolioAccountQueryOptions({
            context: input.context,
            target: input.target,
            markets: catalog.markets,
            source: portfolioSource,
          }),
        ),
      history: (catalog) =>
        input.queryClient.fetchQuery(
          portfolioHistoryQueryOptions({
            context: input.context,
            target: input.target,
            markets: catalog.markets,
            source: portfolioSource,
          }),
        ),
    },
    input.isCurrent,
  );
}

export function PortfolioStartupLoader(): JSX.Element | null {
  const queryClient = useQueryClient();
  const { current } = useTradingContext();
  const attemptedOwners = useRef(new Set<string>());
  const startupContext = useMemo<NormalizedTradingContext>(
    () => ({
      network: current.network,
      masterAccount: current.masterAccount,
      targetAccount: current.targetAccount,
      signer: null,
    }),
    [current.masterAccount, current.network, current.targetAccount],
  );

  useEffect(() => {
    const target = resolvePortfolioTarget(startupContext).target;
    if (target === null) return;
    const ownerKey = portfolioStartupOwnerKey(startupContext, target);
    if (attemptedOwners.current.has(ownerKey)) return;
    attemptedOwners.current.add(ownerKey);

    let active = true;
    void loadPortfolioAtStartup({
      queryClient,
      context: startupContext,
      target,
      isCurrent: () => active,
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [queryClient, startupContext]);

  return null;
}

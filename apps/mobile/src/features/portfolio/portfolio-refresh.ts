export interface PortfolioManualRefreshInput {
  readonly hasExactTarget: boolean;
  readonly hasCatalog: boolean;
  readonly catalogFresh: boolean;
  readonly catalogFailed: boolean;
  readonly catalogRefreshing: boolean;
}

export interface PortfolioManualRefreshPlan {
  readonly account: boolean;
  readonly catalog: boolean;
}

export interface PortfolioRefreshRequests {
  account(): Promise<unknown>;
  catalog(): Promise<unknown>;
  history(): Promise<unknown>;
}

export function portfolioManualRefreshPlan(
  input: PortfolioManualRefreshInput,
): PortfolioManualRefreshPlan {
  return {
    account: input.hasExactTarget && input.hasCatalog,
    catalog:
      !input.catalogRefreshing &&
      (!input.hasCatalog || !input.catalogFresh || input.catalogFailed),
  };
}

export async function runPortfolioRefreshPlan(
  plan: PortfolioManualRefreshPlan,
  requests: PortfolioRefreshRequests,
): Promise<void> {
  const critical: Promise<unknown>[] = [];
  if (plan.account) critical.push(requests.account());
  if (plan.catalog) critical.push(requests.catalog());
  await Promise.all(critical);
  if (plan.account) {
    void requests.history().catch(() => undefined);
  }
}

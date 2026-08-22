export const PORTFOLIO_ROW_BATCH_SIZE = 24;

export function boundedPortfolioRowLimit(
  requested: number,
  total: number,
  batchSize = PORTFOLIO_ROW_BATCH_SIZE,
): number {
  if (
    !Number.isSafeInteger(requested) ||
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(batchSize) ||
    requested < 0 ||
    total < 0 ||
    batchSize <= 0
  ) {
    throw new Error(
      "Portfolio row-window values must be safe non-negative integers.",
    );
  }
  return Math.min(total, Math.max(batchSize, requested));
}

export function nextPortfolioRowLimit(
  current: number,
  total: number,
  batchSize = PORTFOLIO_ROW_BATCH_SIZE,
): number {
  return boundedPortfolioRowLimit(current + batchSize, total, batchSize);
}

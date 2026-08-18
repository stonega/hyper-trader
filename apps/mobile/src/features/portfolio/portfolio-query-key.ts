import type { AccountTarget } from "@hyper-trader/hyperliquid";

import type { NormalizedTradingContext } from "../../core/context/supervisor";
import { queryKeys } from "../../core/query/keys";
import { accountTargetIdentityKey } from "./portfolio-model";

export function portfolioQueryKey(
  context: NormalizedTradingContext,
  target: AccountTarget,
  catalogFingerprint: string,
) {
  return [
    ...queryKeys.private.accountSnapshot(context),
    "portfolio-screen",
    accountTargetIdentityKey(target),
    catalogFingerprint,
  ] as const;
}

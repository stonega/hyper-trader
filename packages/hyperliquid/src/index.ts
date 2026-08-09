import {
  type AccountDataClient,
  createAccountDataClient,
} from "./accounts/client";
import {
  createPublicHyperliquidClient,
  type PublicHyperliquidClient,
  type PublicHyperliquidClientOptions,
} from "./public";

export * from "./accounts";
export * from "./actions";
export * from "./nonces";
export * from "./public";
export * from "./reconciliation";
export * from "./signing";

export interface HyperliquidClient extends PublicHyperliquidClient {
  readonly accounts: AccountDataClient;
}

export interface HyperliquidClientOptions
  extends PublicHyperliquidClientOptions {}

export function createHyperliquidClient(
  options: HyperliquidClientOptions = {},
): HyperliquidClient {
  const publicClient = createPublicHyperliquidClient(options);
  return {
    ...publicClient,
    accounts: createAccountDataClient(options),
  };
}

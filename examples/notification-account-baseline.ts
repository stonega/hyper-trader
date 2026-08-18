import { createPublicHyperliquidClient } from "@hyper-trader/hyperliquid/public";

const user = process.env.HYPERLIQUID_PUBLIC_ACCOUNT;
if (!user || !/^0x[0-9a-f]{40}$/.test(user)) {
  throw new Error(
    "set HYPERLIQUID_PUBLIC_ACCOUNT to an exact lowercase public address",
  );
}

const client = createPublicHyperliquidClient({ network: "testnet" });
const fundingStartTime = Date.now() - 24 * 60 * 60 * 1_000;
const [global, defaultDex] = await Promise.all([
  client.getNotificationAccountGlobalSnapshot({ user, fundingStartTime }),
  client.getNotificationAccountDexSnapshot({ user, dex: "" }),
]);

console.log({
  user,
  openOrders: defaultDex.openOrders.length,
  positions: defaultDex.clearinghouse.positions.length,
  recentOrders: global.historicalOrders.length,
  recentFills: global.fills.length,
  recentFunding: global.funding.length,
});

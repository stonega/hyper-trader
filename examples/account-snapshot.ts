import {
  type AccountTarget,
  createAccountDataClient,
} from "@hyper-trader/hyperliquid";

const target: AccountTarget = {
  kind: "master",
  address: "0x0000000000000000000000000000000000000000",
};
const client = createAccountDataClient({ network: "testnet" });
const [perps, btc, spot] = await Promise.all([
  client.getClearinghouseState(target, ""),
  client.getActiveAssetData(target, "BTC"),
  client.getSpotClearinghouseState(target),
]);

console.log({
  target: target.address,
  accountValue: perps.data.marginSummary.accountValue,
  withdrawable: perps.data.withdrawable,
  btcAvailableToTrade: {
    long: btc.data.availableToTrade[0],
    short: btc.data.availableToTrade[1],
  },
  spotBalances: spot.data.balances,
});

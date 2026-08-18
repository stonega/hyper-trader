import {
  type AccountTarget,
  createAccountDataClient,
} from "@hyper-trader/hyperliquid";

const target: AccountTarget = {
  kind: "master",
  address: "0x0000000000000000000000000000000000000000",
};
const client = createAccountDataClient({ network: "testnet" });
const [perps, spot] = await Promise.all([
  client.getClearinghouseState(target, ""),
  client.getSpotClearinghouseState(target),
]);

console.log({
  target: target.address,
  accountValue: perps.data.marginSummary.accountValue,
  withdrawable: perps.data.withdrawable,
  spotBalances: spot.data.balances,
});

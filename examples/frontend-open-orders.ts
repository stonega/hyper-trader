import {
  type AccountTarget,
  createAccountDataClient,
} from "@hyper-trader/hyperliquid";

const target: AccountTarget = {
  kind: "master",
  address: "0x0000000000000000000000000000000000000000",
};
const client = createAccountDataClient({ network: "testnet" });
const orders = await client.getFrontendOpenOrders(target, "");

console.log(
  orders.data.map((order) => ({
    coin: order.coin,
    side: order.side,
    size: order.size,
    orderType: order.orderType,
    price: order.isTrigger ? order.triggerPrice : order.limitPrice,
    triggerCondition: order.isTrigger ? order.triggerCondition : null,
    positionTpsl: order.isPositionTpsl,
  })),
);

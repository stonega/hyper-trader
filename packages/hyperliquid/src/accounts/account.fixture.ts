export const MASTER_ADDRESS = "0x1111111111111111111111111111111111111111";
export const SUBACCOUNT_ADDRESS = "0x2222222222222222222222222222222222222222";
export const VAULT_ADDRESS = "0x3333333333333333333333333333333333333333";
export const AGENT_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export const EMPTY_CLEARINGHOUSE = {
  assetPositions: [],
  crossMaintenanceMarginUsed: "0.000000000000000001",
  crossMarginSummary: {
    accountValue: "123.4567890123456789",
    totalNtlPos: "0.0",
    totalRawUsd: "123.4567890123456789",
    totalMarginUsed: "0.0",
  },
  marginSummary: {
    accountValue: "123.4567890123456789",
    totalNtlPos: "0.0",
    totalRawUsd: "123.4567890123456789",
    totalMarginUsed: "0.0",
  },
  time: 1_720_000_000_000,
  withdrawable: "123.4567890123456789",
} as const;

export const ACCOUNT_RESPONSES = {
  clearinghouseState: EMPTY_CLEARINGHOUSE,
  activeAssetData: {
    user: SUBACCOUNT_ADDRESS,
    coin: "alpha:DUP",
    leverage: { type: "cross", value: 5 },
    maxTradeSzs: ["10.0000000000000001", "9.0000000000000001"],
    availableToTrade: ["50.0000000000000001", "45.0000000000000001"],
    markPx: "5.0000000000000001",
  },
  spotClearinghouseState: {
    balances: [
      {
        coin: "USDC",
        token: 0,
        hold: "0.000000000000000001",
        total: "123.4567890123456789",
        entryNtl: "100.0000000000000001",
        futureField: true,
      },
    ],
  },
  openOrders: [
    {
      coin: "alpha:DUP",
      limitPx: "1.0000000000000001",
      oid: 7,
      side: "B",
      sz: "2.0000000000000001",
      timestamp: 1_720_000_000_001,
    },
  ],
  historicalOrders: [
    {
      order: {
        coin: "alpha:DUP",
        limitPx: "1.1",
        oid: 8,
        side: "A",
        sz: "0.0",
        origSz: "2.2",
        timestamp: 1_720_000_000_002,
        reduceOnly: false,
        orderType: "Limit",
      },
      status: "filled",
      statusTimestamp: 1_720_000_000_003,
    },
  ],
  userFills: [
    {
      coin: "alpha:DUP",
      side: "B",
      px: "1.0000000000000001",
      sz: "2.0000000000000001",
      closedPnl: "0.0000000000000001",
      startPosition: "0.0",
      fee: "0.0001",
      feeToken: "USDC",
      oid: 8,
      time: 1_720_000_000_004,
      hash: "0xfill",
    },
  ],
  userFunding: [
    {
      time: 1_720_000_000_005,
      hash: "0xfunding",
      delta: {
        type: "funding",
        coin: "alpha:DUP",
        usdc: "-0.0000000000000001",
        szi: "2.0000000000000001",
        fundingRate: "0.0000000000000002",
      },
    },
  ],
  orderStatus: { status: "unknownOid", futureField: "accepted" },
  portfolio: [
    [
      "day",
      {
        accountValueHistory: [[1_720_000_000_000, "123.4567890123456789"]],
        pnlHistory: [[1_720_000_000_000, "0.0000000000000001"]],
        vlm: "42.0000000000000001",
      },
    ],
  ],
  subAccounts: null,
  vaultDetails: {
    name: "Test Vault",
    vaultAddress: VAULT_ADDRESS,
    leader: MASTER_ADDRESS,
    description: "Fixture vault",
    futureField: { accepted: true },
  },
} as const;

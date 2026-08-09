export const CATALOG_RESPONSES = {
  perpDexs: [
    null,
    { name: "alpha", fullName: "Alpha DEX", deployer: "0xalpha" },
    { name: "beta", fullName: "Beta DEX", deployer: "0xbeta" },
  ],
  native: [
    {
      universe: [
        { name: "BTC", szDecimals: 5, maxLeverage: 50 },
        { name: "DUP", szDecimals: 2, maxLeverage: 20 },
        { name: "BROKEN", szDecimals: 7, maxLeverage: 3 },
      ],
      marginTables: [],
      collateralToken: 0,
    },
    [
      {
        dayNtlVlm: "1169046.2940600000001",
        funding: "0.00001250000001",
        markPx: "118001.25000001",
        midPx: "118001.12500001",
        openInterest: "688.1100000001",
        oraclePx: "118002.0",
        prevDayPx: "117000.0",
      },
      {
        dayNtlVlm: "1.0",
        funding: "0.0",
        markPx: "1.0",
        midPx: "1.0",
        openInterest: "2.0",
        oraclePx: "1.0",
        prevDayPx: "1.0",
      },
      {
        dayNtlVlm: "0.0",
        funding: "0.0",
        markPx: "0.1",
        midPx: null,
        openInterest: "0.0",
        oraclePx: "0.1",
        prevDayPx: "0.1",
      },
    ],
  ],
  alpha: [
    {
      universe: [
        { name: "alpha:DUP", szDecimals: 3, maxLeverage: 10 },
        {
          name: "alpha:ISO",
          szDecimals: 2,
          maxLeverage: 5,
          onlyIsolated: true,
          marginMode: "strictIsolated",
        },
      ],
      marginTables: [],
      collateralToken: 0,
    },
    [
      {
        dayNtlVlm: "2.0",
        funding: "0.001",
        markPx: "10.0",
        midPx: "10.0",
        openInterest: "3.0",
        oraclePx: "10.0",
        prevDayPx: "9.0",
      },
      {
        dayNtlVlm: "3.0",
        funding: "0.002",
        markPx: "20.0",
        midPx: "20.0",
        openInterest: "4.0",
        oraclePx: "20.0",
        prevDayPx: "19.0",
      },
    ],
  ],
  beta: [
    {
      universe: [
        { name: "beta:DUP", szDecimals: 1, maxLeverage: 8 },
        {
          name: "beta:OLD",
          szDecimals: 1,
          maxLeverage: 3,
          isDelisted: true,
        },
      ],
      marginTables: [],
      collateralToken: 0,
    },
    [
      {
        dayNtlVlm: "4.0",
        funding: "0.003",
        markPx: "30.0",
        midPx: "30.0",
        openInterest: "5.0",
        oraclePx: "30.0",
        prevDayPx: "29.0",
      },
      {
        dayNtlVlm: "0.0",
        funding: "0.0",
        markPx: "1.0",
        midPx: null,
        openInterest: "0.0",
        oraclePx: "1.0",
        prevDayPx: "1.0",
      },
    ],
  ],
  spot: [
    {
      tokens: [
        {
          name: "USDC",
          szDecimals: 8,
          weiDecimals: 8,
          index: 0,
          tokenId: "0xusdc",
          isCanonical: true,
        },
        {
          name: "DUP",
          szDecimals: 2,
          weiDecimals: 8,
          index: 42,
          tokenId: "0xdup",
          isCanonical: false,
          fullName: "Duplicate Token",
        },
      ],
      universe: [{ name: "@7", tokens: [42, 0], index: 7, isCanonical: false }],
    },
    [
      {
        dayNtlVlm: "8906.00000000001",
        markPx: "0.14000000001",
        midPx: "0.20926500001",
        prevDayPx: "0.20432000001",
      },
    ],
  ],
  outcomes: {
    outcomes: [
      {
        outcome: 12,
        name: "Recurring",
        description:
          "class:priceBinary|underlying:BTC|expiry:20260810-0600|targetPrice:120000|period:1d",
        sideSpecs: [{ name: "Higher" }, { name: "Lower" }],
        futureField: "preserved by boundary tolerance",
      },
    ],
    questions: [],
  },
} as const;

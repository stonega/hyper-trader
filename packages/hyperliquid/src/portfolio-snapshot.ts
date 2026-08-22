import {
  parseClearinghouseState,
  parseOpenOrders,
  parsePortfolio,
  parseSpotClearinghouseState,
  parseUserFills,
  parseUserFunding,
} from "./accounts/parsers";
import type {
  ClearinghouseState,
  OpenOrder,
  PortfolioPeriod,
  SpotClearinghouseState,
  UserFill,
  UserFundingRecord,
} from "./accounts/types";
import { HyperliquidValidationError } from "./errors";
import type { HyperliquidNetwork } from "./network";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const MAX_DEXES = 128;
const MAX_GAPS = 128;

export interface PublicPortfolioLiveEnvelope {
  readonly schemaVersion: 1;
  readonly network: HyperliquidNetwork;
  readonly user: string;
  readonly generatedAtMs: number;
  readonly dexes: readonly {
    readonly dex: string;
    readonly clearinghouse: unknown;
    readonly openOrders: unknown;
  }[];
  readonly spot: unknown;
  readonly sourceGaps: readonly string[];
}

export interface PublicPortfolioHistoryEnvelope {
  readonly schemaVersion: 1;
  readonly network: HyperliquidNetwork;
  readonly user: string;
  readonly generatedAtMs: number;
  readonly fills: unknown;
  readonly funding: unknown;
  readonly periods: unknown;
  readonly sourceGaps: readonly string[];
}

export interface PublicPortfolioLiveSnapshot {
  readonly schemaVersion: 1;
  readonly network: HyperliquidNetwork;
  readonly user: string;
  readonly generatedAtMs: number;
  readonly dexes: readonly {
    readonly dex: string;
    readonly clearinghouse: ClearinghouseState;
    readonly openOrders: readonly OpenOrder[];
  }[];
  readonly spot: SpotClearinghouseState;
  readonly sourceGaps: readonly string[];
}

export interface PublicPortfolioHistorySnapshot {
  readonly schemaVersion: 1;
  readonly network: HyperliquidNetwork;
  readonly user: string;
  readonly generatedAtMs: number;
  readonly fills: readonly UserFill[];
  readonly funding: readonly UserFundingRecord[];
  readonly periods: readonly PortfolioPeriod[];
  readonly sourceGaps: readonly string[];
}

function object(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HyperliquidValidationError(path, "expected an object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  path: string,
): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new HyperliquidValidationError(path, "contained an unknown field");
  }
}

function envelopeIdentity(
  source: Readonly<Record<string, unknown>>,
  path: string,
  expected?: { readonly network: HyperliquidNetwork; readonly user: string },
): {
  readonly network: HyperliquidNetwork;
  readonly user: string;
  readonly generatedAtMs: number;
} {
  if (source.schemaVersion !== 1) {
    throw new HyperliquidValidationError(
      `${path}.schemaVersion`,
      "expected schema version 1",
    );
  }
  if (source.network !== "testnet" && source.network !== "mainnet") {
    throw new HyperliquidValidationError(
      `${path}.network`,
      "expected a supported network",
    );
  }
  if (typeof source.user !== "string" || !ADDRESS.test(source.user)) {
    throw new HyperliquidValidationError(
      `${path}.user`,
      "expected a lowercase account address",
    );
  }
  if (
    !Number.isSafeInteger(source.generatedAtMs) ||
    (source.generatedAtMs as number) < 0
  ) {
    throw new HyperliquidValidationError(
      `${path}.generatedAtMs`,
      "expected a non-negative timestamp",
    );
  }
  if (
    expected &&
    (source.network !== expected.network || source.user !== expected.user)
  ) {
    throw new HyperliquidValidationError(
      path,
      "response identity did not match the request",
    );
  }
  return {
    network: source.network,
    user: source.user,
    generatedAtMs: source.generatedAtMs as number,
  };
}

function sourceGaps(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_GAPS) {
    throw new HyperliquidValidationError(path, "expected bounded source gaps");
  }
  return value.map((gap, index) => {
    if (
      typeof gap !== "string" ||
      gap.length === 0 ||
      gap.length > 256 ||
      gap !== gap.trim()
    ) {
      throw new HyperliquidValidationError(
        `${path}[${index}]`,
        "expected bounded text",
      );
    }
    return gap;
  });
}

export function parsePublicPortfolioLiveSnapshot(
  value: unknown,
  expected?: { readonly network: HyperliquidNetwork; readonly user: string },
): PublicPortfolioLiveSnapshot {
  const source = object(value, "portfolioLive");
  exactKeys(
    source,
    [
      "schemaVersion",
      "network",
      "user",
      "generatedAtMs",
      "dexes",
      "spot",
      "sourceGaps",
    ],
    "portfolioLive",
  );
  const identity = envelopeIdentity(source, "portfolioLive", expected);
  if (!Array.isArray(source.dexes) || source.dexes.length > MAX_DEXES) {
    throw new HyperliquidValidationError(
      "portfolioLive.dexes",
      "expected a bounded DEX list",
    );
  }
  const seen = new Set<string>();
  const dexes = source.dexes.map((value, index) => {
    const dex = object(value, `portfolioLive.dexes[${index}]`);
    exactKeys(
      dex,
      ["dex", "clearinghouse", "openOrders"],
      `portfolioLive.dexes[${index}]`,
    );
    if (
      typeof dex.dex !== "string" ||
      dex.dex.length > 128 ||
      !/^[\x20-\x7e]*$/.test(dex.dex) ||
      seen.has(dex.dex)
    ) {
      throw new HyperliquidValidationError(
        `portfolioLive.dexes[${index}].dex`,
        "expected a unique bounded DEX name",
      );
    }
    seen.add(dex.dex);
    return {
      dex: dex.dex,
      clearinghouse: parseClearinghouseState(dex.clearinghouse),
      openOrders: parseOpenOrders(dex.openOrders),
    };
  });
  return {
    schemaVersion: 1,
    ...identity,
    dexes,
    spot: parseSpotClearinghouseState(source.spot),
    sourceGaps: sourceGaps(source.sourceGaps, "portfolioLive.sourceGaps"),
  };
}

export function parsePublicPortfolioHistorySnapshot(
  value: unknown,
  expected?: { readonly network: HyperliquidNetwork; readonly user: string },
): PublicPortfolioHistorySnapshot {
  const source = object(value, "portfolioHistory");
  exactKeys(
    source,
    [
      "schemaVersion",
      "network",
      "user",
      "generatedAtMs",
      "fills",
      "funding",
      "periods",
      "sourceGaps",
    ],
    "portfolioHistory",
  );
  const identity = envelopeIdentity(source, "portfolioHistory", expected);
  return {
    schemaVersion: 1,
    ...identity,
    fills: parseUserFills(source.fills),
    funding: parseUserFunding(source.funding),
    periods: parsePortfolio(source.periods),
    sourceGaps: sourceGaps(source.sourceGaps, "portfolioHistory.sourceGaps"),
  };
}

import { discoverMarketCatalog } from "./markets/catalog";
import {
  type Candle,
  type FundingRecord,
  type L2Book,
  type MidPrice,
  parseAllMids,
  parseAssetContexts,
  parseCandles,
  parseFundingHistory,
  parseL2Book,
  parseRecentTrades,
  type RecentTrade,
} from "./markets/reads";
import type { MarketCatalog, MarketContext } from "./markets/types";
import type { HyperliquidNetwork } from "./network";
import {
  getNotificationAccountDexSnapshot,
  getNotificationAccountGlobalSnapshot,
  getNotificationAccountSnapshot,
  type NotificationAccountDexSnapshot,
  type NotificationAccountDexSnapshotRequest,
  type NotificationAccountGlobalSnapshot,
  type NotificationAccountGlobalSnapshotRequest,
  type NotificationAccountSnapshot,
  type NotificationAccountSnapshotRequest,
} from "./public-account";
import {
  createInfoHttpTransport,
  type InfoHttpTransportOptions,
  type InfoRequestBudget,
  type InfoRequestOptions,
} from "./transport/http";

export * from "./errors";
export * from "./markets/reads";
export * from "./markets/types";
export * from "./network";
export * from "./numbers/decimal";
export * from "./numbers/precision";
export type {
  NotificationAccountDexSnapshot,
  NotificationAccountDexSnapshotRequest,
  NotificationAccountGlobalSnapshot,
  NotificationAccountGlobalSnapshotRequest,
  NotificationAccountSnapshot,
  NotificationAccountSnapshotRequest,
} from "./public-account";
export * from "./transport/http";
export * from "./transport/websocket";

export type CandleInterval =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "8h"
  | "12h"
  | "1d"
  | "3d"
  | "1w"
  | "1M";

export interface PublicHyperliquidClient {
  readonly network: HyperliquidNetwork;
  getRequestBudget(
    requestType: string,
    responseItemCount?: number,
  ): InfoRequestBudget;
  getAllMids(
    options?: InfoRequestOptions & { readonly dex?: string },
  ): Promise<MidPrice[]>;
  getMarketCatalog(options?: InfoRequestOptions): Promise<MarketCatalog>;
  getCandles(
    request: {
      readonly coin: string;
      readonly interval: CandleInterval;
      readonly startTime: number;
      readonly endTime?: number;
    },
    options?: InfoRequestOptions,
  ): Promise<Candle[]>;
  getL2Book(
    request: {
      readonly coin: string;
      readonly nSigFigs?: 2 | 3 | 4 | 5 | null;
      readonly mantissa?: 1 | 2 | 5;
    },
    options?: InfoRequestOptions,
  ): Promise<L2Book>;
  getRecentTrades(
    coin: string,
    options?: InfoRequestOptions,
  ): Promise<RecentTrade[]>;
  getPerpContexts(
    options?: InfoRequestOptions & { readonly dex?: string },
  ): Promise<MarketContext[]>;
  getSpotContexts(options?: InfoRequestOptions): Promise<MarketContext[]>;
  getFundingHistory(
    request: {
      readonly coin: string;
      readonly startTime: number;
      readonly endTime?: number;
    },
    options?: InfoRequestOptions,
  ): Promise<FundingRecord[]>;
  getNotificationAccountSnapshot(
    request: NotificationAccountSnapshotRequest,
    options?: InfoRequestOptions,
  ): Promise<NotificationAccountSnapshot>;
  getNotificationAccountGlobalSnapshot(
    request: NotificationAccountGlobalSnapshotRequest,
    options?: InfoRequestOptions,
  ): Promise<NotificationAccountGlobalSnapshot>;
  getNotificationAccountDexSnapshot(
    request: NotificationAccountDexSnapshotRequest,
    options?: InfoRequestOptions,
  ): Promise<NotificationAccountDexSnapshot>;
}

export interface PublicHyperliquidClientOptions
  extends InfoHttpTransportOptions {}

export function createPublicHyperliquidClient(
  options: PublicHyperliquidClientOptions = {},
): PublicHyperliquidClient {
  const transport = createInfoHttpTransport(options);
  return {
    network: transport.network,
    getRequestBudget: transport.budgetFor,
    async getAllMids(requestOptions = {}) {
      const { dex, ...optionsOnly } = requestOptions;
      return parseAllMids(
        await transport.request(
          { type: "allMids", ...(dex === undefined ? {} : { dex }) },
          optionsOnly,
        ),
      );
    },
    getMarketCatalog(requestOptions = {}) {
      return discoverMarketCatalog(transport, requestOptions);
    },
    async getCandles(request, requestOptions = {}) {
      return parseCandles(
        await transport.request(
          {
            type: "candleSnapshot",
            req: {
              coin: request.coin,
              interval: request.interval,
              startTime: request.startTime,
              ...(request.endTime === undefined
                ? {}
                : { endTime: request.endTime }),
            },
          },
          requestOptions,
        ),
      );
    },
    async getL2Book(request, requestOptions = {}) {
      return parseL2Book(
        await transport.request(
          {
            type: "l2Book",
            coin: request.coin,
            ...(request.nSigFigs === undefined
              ? {}
              : { nSigFigs: request.nSigFigs }),
            ...(request.mantissa === undefined
              ? {}
              : { mantissa: request.mantissa }),
          },
          requestOptions,
        ),
      );
    },
    async getRecentTrades(coin, requestOptions = {}) {
      return parseRecentTrades(
        await transport.request({ type: "recentTrades", coin }, requestOptions),
      );
    },
    async getPerpContexts(requestOptions = {}) {
      const { dex, ...optionsOnly } = requestOptions;
      return parseAssetContexts(
        await transport.request(
          {
            type: "metaAndAssetCtxs",
            ...(dex === undefined ? {} : { dex }),
          },
          optionsOnly,
        ),
        "metaAndAssetCtxs",
      );
    },
    async getSpotContexts(requestOptions = {}) {
      return parseAssetContexts(
        await transport.request(
          { type: "spotMetaAndAssetCtxs" },
          requestOptions,
        ),
        "spotMetaAndAssetCtxs",
      );
    },
    async getFundingHistory(request, requestOptions = {}) {
      return parseFundingHistory(
        await transport.request(
          {
            type: "fundingHistory",
            coin: request.coin,
            startTime: request.startTime,
            ...(request.endTime === undefined
              ? {}
              : { endTime: request.endTime }),
          },
          requestOptions,
        ),
      );
    },
    getNotificationAccountSnapshot(request, requestOptions = {}) {
      return getNotificationAccountSnapshot(transport, request, requestOptions);
    },
    getNotificationAccountGlobalSnapshot(request, requestOptions = {}) {
      return getNotificationAccountGlobalSnapshot(
        transport,
        request,
        requestOptions,
      );
    },
    getNotificationAccountDexSnapshot(request, requestOptions = {}) {
      return getNotificationAccountDexSnapshot(
        transport,
        request,
        requestOptions,
      );
    },
  };
}

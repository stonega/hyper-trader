import {
  parseClearinghouseState,
  parseHistoricalOrders,
  parseOpenOrders,
  parseUserFills,
  parseUserFunding,
} from "./accounts/parsers";
import type {
  ClearinghouseState,
  HistoricalOrder,
  OpenOrder,
  UserFill,
  UserFundingRecord,
} from "./accounts/types";
import { HyperliquidValidationError } from "./errors";
import type { InfoHttpTransport, InfoRequestOptions } from "./transport/http";

export interface NotificationAccountSnapshot {
  readonly user: string;
  readonly dex: string;
  readonly clearinghouse: ClearinghouseState;
  readonly openOrders: readonly OpenOrder[];
  readonly historicalOrders: readonly HistoricalOrder[];
  readonly fills: readonly UserFill[];
  readonly funding: readonly UserFundingRecord[];
}

export interface NotificationAccountGlobalSnapshot {
  readonly user: string;
  readonly historicalOrders: readonly HistoricalOrder[];
  readonly fills: readonly UserFill[];
  readonly funding: readonly UserFundingRecord[];
}

export interface NotificationAccountDexSnapshot {
  readonly user: string;
  readonly dex: string;
  readonly clearinghouse: ClearinghouseState;
  readonly openOrders: readonly OpenOrder[];
}

export interface NotificationAccountSnapshotRequest {
  readonly user: string;
  readonly dex: string;
  readonly fundingStartTime: number;
  readonly fundingEndTime?: number;
}

export interface NotificationAccountGlobalSnapshotRequest {
  readonly user: string;
  readonly fundingStartTime: number;
  readonly fundingEndTime?: number;
}

export interface NotificationAccountDexSnapshotRequest {
  readonly user: string;
  readonly dex: string;
}

export async function getNotificationAccountSnapshot(
  transport: InfoHttpTransport,
  request: NotificationAccountSnapshotRequest,
  options: InfoRequestOptions = {},
): Promise<NotificationAccountSnapshot> {
  validateRequest(request);
  const [dex, global] = await Promise.all([
    getNotificationAccountDexSnapshot(
      transport,
      { user: request.user, dex: request.dex },
      options,
    ),
    getNotificationAccountGlobalSnapshot(transport, request, options),
  ]);
  return {
    user: request.user,
    dex: request.dex,
    clearinghouse: dex.clearinghouse,
    openOrders: dex.openOrders,
    historicalOrders: global.historicalOrders,
    fills: global.fills,
    funding: global.funding,
  };
}

export async function getNotificationAccountGlobalSnapshot(
  transport: InfoHttpTransport,
  request: NotificationAccountGlobalSnapshotRequest,
  options: InfoRequestOptions = {},
): Promise<NotificationAccountGlobalSnapshot> {
  validateUser(request.user);
  validateFundingRange(request);
  const [historicalOrders, fills, funding] = await Promise.all([
    transport.request(
      { type: "historicalOrders", user: request.user },
      options,
    ),
    transport.request(
      { type: "userFills", user: request.user, aggregateByTime: false },
      options,
    ),
    transport.request(
      {
        type: "userFunding",
        user: request.user,
        startTime: request.fundingStartTime,
        ...(request.fundingEndTime === undefined
          ? {}
          : { endTime: request.fundingEndTime }),
      },
      options,
    ),
  ]);
  return {
    user: request.user,
    historicalOrders: parseHistoricalOrders(historicalOrders),
    fills: parseUserFills(fills),
    funding: parseUserFunding(funding),
  };
}

export async function getNotificationAccountDexSnapshot(
  transport: InfoHttpTransport,
  request: NotificationAccountDexSnapshotRequest,
  options: InfoRequestOptions = {},
): Promise<NotificationAccountDexSnapshot> {
  validateUser(request.user);
  validateDex(request.dex);
  const [clearinghouse, openOrders] = await Promise.all([
    transport.request(
      { type: "clearinghouseState", user: request.user, dex: request.dex },
      options,
    ),
    transport.request(
      { type: "openOrders", user: request.user, dex: request.dex },
      options,
    ),
  ]);
  return {
    user: request.user,
    dex: request.dex,
    clearinghouse: parseClearinghouseState(clearinghouse),
    openOrders: parseOpenOrders(openOrders),
  };
}

function validateRequest(request: NotificationAccountSnapshotRequest): void {
  validateUser(request.user);
  validateDex(request.dex);
  validateFundingRange(request);
}

function validateUser(user: string): void {
  if (!/^0x[0-9a-f]{40}$/.test(user)) {
    throw new HyperliquidValidationError(
      "notificationAccount.user",
      "expected an exact lowercase account address",
    );
  }
}

function validateDex(dex: string): void {
  if (dex.length > 128 || !/^[\x20-\x7e]*$/.test(dex)) {
    throw new HyperliquidValidationError(
      "notificationAccount.dex",
      "expected a bounded DEX name",
    );
  }
}

function validateFundingRange(request: {
  readonly fundingStartTime: number;
  readonly fundingEndTime?: number;
}): void {
  if (
    !Number.isSafeInteger(request.fundingStartTime) ||
    request.fundingStartTime < 0 ||
    (request.fundingEndTime !== undefined &&
      (!Number.isSafeInteger(request.fundingEndTime) ||
        request.fundingEndTime < request.fundingStartTime))
  ) {
    throw new HyperliquidValidationError(
      "notificationAccount.fundingTime",
      "expected a bounded funding time range",
    );
  }
}

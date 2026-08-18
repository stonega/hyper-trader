import { HyperliquidValidationError } from "../errors";
import type { HyperliquidNetwork } from "../network";
import {
  createInfoHttpTransport,
  type InfoHttpTransport,
  type InfoHttpTransportOptions,
  type InfoRequestBudget,
  type InfoRequestOptions,
} from "../transport/http";
import {
  parseClearinghouseState,
  parseHistoricalOrders,
  parseNamedApiWalletRegistrations,
  parseOpenOrders,
  parseOrderStatus,
  parsePortfolio,
  parseSpotClearinghouseState,
  parseSubaccounts,
  parseUserFills,
  parseUserFunding,
  parseVaultDetails,
} from "./parsers";
import type {
  AccountDataResult,
  AccountTarget,
  ClearinghouseState,
  HistoricalOrder,
  NamedApiWalletRegistration,
  OpenOrder,
  OrderStatus,
  PortfolioPeriod,
  SpotClearinghouseState,
  SubaccountSummary,
  UserFill,
  UserFundingRecord,
  VaultDetails,
} from "./types";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function validateAccountTarget(target: AccountTarget): AccountTarget {
  if (!ADDRESS_PATTERN.test(target.address)) {
    throw new HyperliquidValidationError(
      "accountTarget.address",
      "expected a 42-character hexadecimal account address",
    );
  }
  if (
    "masterAddress" in target &&
    target.masterAddress !== undefined &&
    !ADDRESS_PATTERN.test(target.masterAddress)
  ) {
    throw new HyperliquidValidationError(
      "accountTarget.masterAddress",
      "expected a 42-character hexadecimal master address",
    );
  }
  return target;
}

export interface AccountDataClient {
  readonly network: HyperliquidNetwork;
  getRequestBudget(
    requestType: string,
    responseItemCount?: number,
  ): InfoRequestBudget;
  getSubaccounts(
    master: Extract<AccountTarget, { readonly kind: "master" }>,
    options?: InfoRequestOptions,
  ): Promise<AccountDataResult<readonly SubaccountSummary[]>>;
  getVaultDetails(
    vault: Extract<AccountTarget, { readonly kind: "vault" }>,
    options?: InfoRequestOptions & { readonly user?: string },
  ): Promise<AccountDataResult<VaultDetails>>;
  getClearinghouseState(
    target: AccountTarget,
    dex: string,
    options?: InfoRequestOptions,
  ): Promise<AccountDataResult<ClearinghouseState>>;
  getSpotClearinghouseState(
    target: AccountTarget,
    options?: InfoRequestOptions,
  ): Promise<AccountDataResult<SpotClearinghouseState>>;
  getOpenOrders(
    target: AccountTarget,
    dex: string,
    options?: InfoRequestOptions,
  ): Promise<AccountDataResult<readonly OpenOrder[]>>;
  getHistoricalOrders(
    target: AccountTarget,
    options?: InfoRequestOptions,
  ): Promise<AccountDataResult<readonly HistoricalOrder[]>>;
  getFills(
    target: AccountTarget,
    options?: InfoRequestOptions & { readonly aggregateByTime?: boolean },
  ): Promise<AccountDataResult<readonly UserFill[]>>;
  getFunding(
    target: AccountTarget,
    range: { readonly startTime: number; readonly endTime?: number },
    options?: InfoRequestOptions,
  ): Promise<AccountDataResult<readonly UserFundingRecord[]>>;
  getOrderStatus(
    target: AccountTarget,
    oid: number | string,
    options?: InfoRequestOptions,
  ): Promise<AccountDataResult<OrderStatus>>;
  getPortfolio(
    target: AccountTarget,
    options?: InfoRequestOptions,
  ): Promise<AccountDataResult<readonly PortfolioPeriod[]>>;
  getNamedApiWallets(
    master: Extract<AccountTarget, { readonly kind: "master" }>,
    options?: InfoRequestOptions,
  ): Promise<AccountDataResult<readonly NamedApiWalletRegistration[]>>;
}

function result<T>(
  target: AccountTarget,
  sourceDex: string | null,
  data: T,
): AccountDataResult<T> {
  return { target, sourceDex, data };
}

export function createAccountDataClientFromTransport(
  transport: InfoHttpTransport,
): AccountDataClient {
  return {
    network: transport.network,
    getRequestBudget: transport.budgetFor,
    async getSubaccounts(master, options = {}) {
      validateAccountTarget(master);
      return result(
        master,
        null,
        parseSubaccounts(
          await transport.request(
            { type: "subAccounts", user: master.address },
            options,
          ),
        ),
      );
    },
    async getVaultDetails(vault, options = {}) {
      validateAccountTarget(vault);
      const { user, ...requestOptions } = options;
      if (user !== undefined && !ADDRESS_PATTERN.test(user)) {
        throw new HyperliquidValidationError(
          "vaultDetails.user",
          "expected a 42-character hexadecimal account address",
        );
      }
      return result(
        vault,
        null,
        parseVaultDetails(
          await transport.request(
            {
              type: "vaultDetails",
              vaultAddress: vault.address,
              ...(user === undefined ? {} : { user }),
            },
            requestOptions,
          ),
        ),
      );
    },
    async getClearinghouseState(target, dex, options = {}) {
      validateAccountTarget(target);
      return result(
        target,
        dex,
        parseClearinghouseState(
          await transport.request(
            { type: "clearinghouseState", user: target.address, dex },
            options,
          ),
        ),
      );
    },
    async getSpotClearinghouseState(target, options = {}) {
      validateAccountTarget(target);
      return result(
        target,
        null,
        parseSpotClearinghouseState(
          await transport.request(
            { type: "spotClearinghouseState", user: target.address },
            options,
          ),
        ),
      );
    },
    async getOpenOrders(target, dex, options = {}) {
      validateAccountTarget(target);
      return result(
        target,
        dex,
        parseOpenOrders(
          await transport.request(
            { type: "openOrders", user: target.address, dex },
            options,
          ),
        ),
      );
    },
    async getHistoricalOrders(target, options = {}) {
      validateAccountTarget(target);
      return result(
        target,
        null,
        parseHistoricalOrders(
          await transport.request(
            { type: "historicalOrders", user: target.address },
            options,
          ),
        ),
      );
    },
    async getFills(target, options = {}) {
      validateAccountTarget(target);
      const { aggregateByTime, ...requestOptions } = options;
      return result(
        target,
        null,
        parseUserFills(
          await transport.request(
            {
              type: "userFills",
              user: target.address,
              ...(aggregateByTime === undefined ? {} : { aggregateByTime }),
            },
            requestOptions,
          ),
        ),
      );
    },
    async getFunding(target, range, options = {}) {
      validateAccountTarget(target);
      return result(
        target,
        null,
        parseUserFunding(
          await transport.request(
            {
              type: "userFunding",
              user: target.address,
              startTime: range.startTime,
              ...(range.endTime === undefined
                ? {}
                : { endTime: range.endTime }),
            },
            options,
          ),
        ),
      );
    },
    async getOrderStatus(target, oid, options = {}) {
      validateAccountTarget(target);
      return result(
        target,
        null,
        parseOrderStatus(
          await transport.request(
            { type: "orderStatus", user: target.address, oid },
            options,
          ),
        ),
      );
    },
    async getPortfolio(target, options = {}) {
      validateAccountTarget(target);
      return result(
        target,
        null,
        parsePortfolio(
          await transport.request(
            { type: "portfolio", user: target.address },
            options,
          ),
        ),
      );
    },
    async getNamedApiWallets(master, options = {}) {
      validateAccountTarget(master);
      return result(
        master,
        null,
        parseNamedApiWalletRegistrations(
          await transport.request(
            { type: "extraAgents", user: master.address },
            options,
          ),
        ),
      );
    },
  };
}

export function createAccountDataClient(
  options: InfoHttpTransportOptions = {},
): AccountDataClient {
  return createAccountDataClientFromTransport(createInfoHttpTransport(options));
}

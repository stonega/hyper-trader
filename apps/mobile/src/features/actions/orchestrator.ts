import {
  type ActionJournalRepository,
  assertSignerBinding,
  assertTestnetSigningCapability,
  buildExchangeAction,
  buildL1TypedData,
  type ClockGateInput,
  type Eip712Payload,
  type Eip712Signature,
  type ExchangeClient,
  encodeL1Action,
  MINIMUM_ORDER_NOTIONAL_MESSAGE,
  type NonceAndJournalRepository,
  normalizeSignerBinding,
  type PreparedActionRecord,
  type SecretFreeIntent,
  type SignerBinding,
  serializeSecretFreeIntent,
  type TradingActionIntent,
  type TradingActionValidationInput,
  type ValidatedTradingAction,
  validateTradingAction,
} from "@hyper-trader/hyperliquid";
import { keccak256, toBytes } from "viem";
import { aggressiveOrderPrice } from "./aggressive-order-price";
import type { ActionReconciliationPort } from "./reconciler";
import {
  type ActionFlowPhase,
  type ActionFlowState,
  INITIAL_ACTION_FLOW,
  reduceActionFlow,
} from "./state-machine";

const CLOSE_REJECTED_MESSAGE =
  "Hyperliquid did not execute this close. The position or market may have changed. Refresh and try again.";
const CANCEL_REJECTED_MESSAGE =
  "Hyperliquid did not cancel this order. Refresh open orders before trying again.";

export interface ActionReviewSnapshot {
  readonly binding: SignerBinding;
  readonly validation: TradingActionValidationInput;
  readonly validated: ValidatedTradingAction;
  readonly vaultAddress: `0x${string}` | null;
  readonly presentation: ActionReviewPresentation;
}

export interface ActionReviewPresentation {
  readonly market: string;
  readonly account: string;
  readonly network: "Hyperliquid testnet";
  readonly action: string;
  readonly side: string;
  readonly price: string;
  readonly size: string;
  readonly leverageAndMargin: string;
  readonly reduceOnly: string;
  readonly estimatedFee: string;
  readonly slippage: string;
}

export interface ActionSessionPort {
  unlock(input: {
    readonly binding: SignerBinding;
    readonly capturedContextEpoch: number;
    readonly isContextCurrent: () => boolean;
  }): Promise<unknown>;
  signTypedData(input: {
    readonly expectedBinding: SignerBinding;
    readonly payload: Eip712Payload;
    readonly capturedContextEpoch: number;
    readonly isContextCurrent: () => boolean;
  }): Promise<Eip712Signature>;
}

export interface ActionIdSource {
  journalId(): string;
  correlationId(): string;
}

export interface ActionOrchestrator {
  read(): ActionFlowState;
  subscribe(listener: (state: ActionFlowState) => void): () => void;
  confirm(
    review: ActionReviewSnapshot,
    lifecycle?: {
      readonly onAuthenticated?: (review: ActionReviewSnapshot) => void;
    },
  ): Promise<ActionFlowState>;
  reset(): void;
}

type ActionRepository = Pick<
  NonceAndJournalRepository,
  "reservePreparedAction"
> &
  Pick<
    ActionJournalRepository,
    "getAction" | "markSubmissionStarted" | "transitionAction"
  >;

function currentBinding(
  review: ActionReviewSnapshot,
  validation: TradingActionValidationInput,
): SignerBinding {
  return {
    network: validation.context.network,
    masterAccount: validation.context.masterAccount,
    targetAccount: validation.context.targetAccount,
    agentAddress: review.binding.agentAddress,
    generation: review.binding.generation,
  };
}

function reviewPresentation(
  validation: TradingActionValidationInput,
  validated: ValidatedTradingAction,
  estimatedFee: string | null | undefined,
  marketLabel: string | undefined,
): ActionReviewPresentation {
  const intent = validated.intent;
  const isOrder =
    intent.type === "market_order" ||
    intent.type === "limit_order" ||
    intent.type === "reduce_only_close";
  const price =
    intent.type === "limit_order"
      ? intent.limitPrice
      : intent.type === "market_order" || intent.type === "reduce_only_close"
        ? intent.aggressiveLimitPrice
        : "Not applicable";
  const reduceOnly =
    intent.type === "reduce_only_close" ||
    (intent.type === "limit_order" && intent.reduceOnly);
  const action = actionLabel(intent);
  const leverageAndMargin =
    intent.type === "update_leverage"
      ? `${intent.leverage}× · ${intent.marginMode}`
      : validation.market.family === "perp"
        ? `${validation.account.leverage ?? "—"}× · ${validation.account.marginMode ?? "—"}`
        : "Spot";
  return {
    market: marketLabel?.trim() || validated.marketCanonicalId,
    account: validation.context.targetAccount,
    network: "Hyperliquid testnet",
    action,
    side: isOrder ? intent.side.toUpperCase() : "Not applicable",
    price,
    size: isOrder ? intent.size : "Not applicable",
    leverageAndMargin,
    reduceOnly: reduceOnly ? "Yes" : "No",
    estimatedFee: estimatedFee ?? "Unavailable until the refreshed quote",
    slippage:
      validation.controls.slippageBps === null
        ? "Not applicable"
        : `${validation.controls.slippageBps / 100}%`,
  };
}

function actionLabel(intent: TradingActionIntent): string {
  switch (intent.type) {
    case "market_order":
      return "Market order";
    case "limit_order":
      return `Limit order · ${intent.timeInForce}`;
    case "reduce_only_close":
      return "Full reduce-only close";
    case "cancel":
      return "Cancel order";
    case "update_leverage":
      return "Update leverage";
    case "bulk_cancel":
      return "Unsupported action";
  }
}

function cloneIntent(intent: TradingActionIntent): TradingActionIntent {
  if (intent.type === "cancel") {
    return {
      ...intent,
      target: { ...intent.target },
    };
  }
  if (intent.type === "bulk_cancel") {
    return {
      ...intent,
      cancels: intent.cancels.map((cancel) => ({
        ...cancel,
        target: { ...cancel.target },
      })),
    };
  }
  return { ...intent };
}

function cloneValidation(
  input: TradingActionValidationInput,
  normalizedIntent: TradingActionIntent,
): TradingActionValidationInput {
  return {
    context: { ...input.context },
    market: {
      ...input.market,
      pricePrecision:
        input.market.pricePrecision === null
          ? null
          : { ...input.market.pricePrecision },
    },
    account: {
      ...input.account,
      openOrders: input.account.openOrders?.map((order) => ({ ...order })),
    },
    controls: {
      ...input.controls,
      trigger:
        input.controls.trigger === null ? null : { ...input.controls.trigger },
    },
    intent: cloneIntent(normalizedIntent),
  };
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeDeep(child);
  }
  return Object.freeze(value);
}

export function createActionReview(input: {
  readonly binding: SignerBinding;
  readonly capturedContextEpoch: number;
  readonly validation: TradingActionValidationInput;
  readonly vaultAddress?: `0x${string}` | null;
  readonly estimatedFee?: string | null;
  readonly marketLabel?: string;
}): ActionReviewSnapshot {
  assertTestnetSigningCapability(input.validation.context.network);
  const binding = normalizeSignerBinding(input.binding);
  assertTestnetSigningCapability(binding.network);
  if (
    input.capturedContextEpoch !== input.validation.context.capturedContextEpoch
  ) {
    throw new Error("The review does not match its captured context epoch.");
  }
  assertSignerBinding(binding, {
    network: input.validation.context.network,
    masterAccount: input.validation.context.masterAccount,
    targetAccount: input.validation.context.targetAccount,
    agentAddress: binding.agentAddress,
    generation: binding.generation,
  });
  const requiredVaultAddress =
    binding.masterAccount === binding.targetAccount
      ? null
      : (binding.targetAccount as `0x${string}`);
  if (input.vaultAddress !== undefined) {
    const suppliedVaultAddress =
      input.vaultAddress === null
        ? null
        : (normalizeSignerBinding({
            ...binding,
            targetAccount: input.vaultAddress,
          }).targetAccount as `0x${string}`);
    if (suppliedVaultAddress !== requiredVaultAddress) {
      throw new Error(
        "The vault address does not match the exact reviewed target.",
      );
    }
  }
  const clonedValidation = cloneValidation(
    input.validation,
    input.validation.intent,
  );
  const validated = validateTradingAction(clonedValidation);
  const validation: TradingActionValidationInput = {
    ...clonedValidation,
    intent: cloneIntent(validated.intent),
  };
  const presentation = reviewPresentation(
    validation,
    validated,
    input.estimatedFee,
    input.marketLabel,
  );
  return freezeDeep({
    binding,
    validation,
    validated,
    vaultAddress: requiredVaultAddress,
    presentation,
  });
}

function withoutCloid(
  intent: TradingActionIntent,
): Readonly<Record<string, unknown>> {
  if (
    intent.type === "market_order" ||
    intent.type === "limit_order" ||
    intent.type === "reduce_only_close"
  ) {
    const { cloid: _cloid, ...rest } = intent;
    return rest;
  }
  return intent as unknown as Readonly<Record<string, unknown>>;
}

function storedIntent(
  validated: ValidatedTradingAction,
  validation: TradingActionValidationInput,
): SecretFreeIntent {
  const intent = validated.intent as unknown as Readonly<
    Record<string, unknown>
  >;
  const stored: Record<string, unknown> = {
    ...intent,
    marketCanonicalId: validated.marketCanonicalId,
    reviewedAccountStateVersion: validated.accountStateVersion,
  };
  if (validation.account.positionSize !== undefined) {
    stored.reviewedPositionSize = validation.account.positionSize;
  }
  if (validated.intent.type === "cancel") {
    stored.targetObservedBeforeSubmission = true;
  }
  return stored;
}

function digest(value: unknown): `0x${string}` {
  return keccak256(toBytes(serializeSecretFreeIntent(value)));
}

function identityFields(intent: TradingActionIntent): {
  readonly cloid: string | null;
  readonly assetId: number | null;
  readonly targetOid: number | null;
  readonly reconciliationKey: string;
} {
  switch (intent.type) {
    case "market_order":
    case "limit_order":
    case "reduce_only_close":
      return {
        cloid: intent.cloid.toLowerCase(),
        assetId: intent.assetId,
        targetOid: null,
        reconciliationKey: `order:${intent.assetId}:cloid:${intent.cloid.toLowerCase()}`,
      };
    case "cancel":
      return intent.target.kind === "oid"
        ? {
            cloid: null,
            assetId: intent.assetId,
            targetOid: intent.target.oid,
            reconciliationKey: `cancel:${intent.assetId}:oid:${intent.target.oid}`,
          }
        : {
            cloid: intent.target.cloid.toLowerCase(),
            assetId: intent.assetId,
            targetOid: null,
            reconciliationKey: `cancel:${intent.assetId}:cloid:${intent.target.cloid.toLowerCase()}`,
          };
    case "update_leverage":
      return {
        cloid: null,
        assetId: intent.assetId,
        targetOid: null,
        reconciliationKey: `leverage:${intent.assetId}:${intent.marginMode}:${intent.leverage}`,
      };
    case "bulk_cancel":
      throw new Error("Bulk cancel is not a U7 public action.");
  }
}

function sameReviewedIntent(
  left: TradingActionIntent,
  right: TradingActionIntent,
  refreshedInput: TradingActionValidationInput,
): boolean {
  if (left.type !== right.type) return false;
  if (
    (left.type === "market_order" || left.type === "reduce_only_close") &&
    (right.type === "market_order" || right.type === "reduce_only_close")
  ) {
    const slippageBps = refreshedInput.controls.slippageBps;
    const precision = refreshedInput.market.pricePrecision;
    const referencePrice = refreshedInput.market.referencePrice;
    if (
      slippageBps === null ||
      precision === null ||
      typeof referencePrice !== "string"
    ) {
      return false;
    }
    try {
      return (
        serializeSecretFreeIntent({
          ...left,
          aggressiveLimitPrice: aggressiveOrderPrice({
            referencePrice,
            side: left.side,
            slippageBps,
            precision,
          }),
        }) === serializeSecretFreeIntent(right)
      );
    } catch {
      return false;
    }
  }
  return serializeSecretFreeIntent(left) === serializeSecretFreeIntent(right);
}

function sameReviewedControls(
  review: ActionReviewSnapshot,
  refreshedInput: TradingActionValidationInput,
): boolean {
  return (
    serializeSecretFreeIntent(review.validation.controls) ===
    serializeSecretFreeIntent(refreshedInput.controls)
  );
}

function failureCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function preSubmissionFailureMessage(
  phase: ActionFlowPhase,
  error: unknown,
): string {
  const code = failureCode(error);
  if (phase === "unlocking") {
    if (code === "missing_or_invalidated" || code === "malformed_record") {
      return "The protected API wallet is no longer available. Set up a new testnet API wallet before trading.";
    }
    if (code === "authentication_failed") {
      return "Device authentication did not complete. Try again and finish the Face ID, biometric, or passcode prompt.";
    }
    if (code === "app_not_active" || code === "session_invalidated") {
      return "Device authentication was interrupted. Keep Hyper Trader open and try again.";
    }
    if (code === "context_changed") {
      return "The selected account changed during confirmation. Return to the order and review it again.";
    }
    return "The selected account or API wallet could not be confirmed. Check the account and try again.";
  }
  switch (phase) {
    case "refreshing":
      if (code === "cancel_target_not_open") {
        return "This order is no longer open. Refresh open orders before trying again.";
      }
      return "The latest market or account details could not be confirmed for this order. Return to the order, refresh, and try again.";
    case "reserving":
      return "The order could not be prepared safely. Return to the order and try again.";
    case "signing":
      return "The API wallet could not sign this order. Unlock it and try again.";
    case "submission_start":
      return "The order was not submitted because safe submission could not be started. Return to the order and try again.";
    default:
      return "The order was not submitted. Return to the order and try again.";
  }
}

export function createActionOrchestrator(options: {
  readonly repository: ActionRepository;
  readonly session: ActionSessionPort;
  readonly exchange: ExchangeClient;
  readonly reconciliation?: ActionReconciliationPort;
  readonly refresh: (
    review: ActionReviewSnapshot,
  ) => Promise<TradingActionValidationInput>;
  readonly isContextCurrent: (review: ActionReviewSnapshot) => boolean;
  readonly clock: () => ClockGateInput;
  readonly now: () => number;
  readonly ids: ActionIdSource;
  readonly onStateChange?: (state: ActionFlowState) => void;
}): ActionOrchestrator {
  let state = INITIAL_ACTION_FLOW;
  const listeners = new Set<(value: ActionFlowState) => void>();

  const publish = (next: ActionFlowState) => {
    state = next;
    try {
      options.onStateChange?.(next);
    } catch {
      // Observers never own action correctness or transport control.
    }
    for (const listener of listeners) {
      try {
        listener(next);
      } catch {
        // One presentation observer cannot interrupt the durable pipeline.
      }
    }
  };
  const dispatch = (action: Parameters<typeof reduceActionFlow>[1]) => {
    const next = reduceActionFlow(state, action);
    if (!Object.is(next, state)) publish(next);
  };
  const requireCurrent = (review: ActionReviewSnapshot) => {
    if (!options.isContextCurrent(review)) {
      throw new Error("The active trading context changed.");
    }
  };
  const advance = (
    generation: number,
    phase: Extract<
      ActionFlowPhase,
      | "unlocking"
      | "refreshing"
      | "reserving"
      | "signing"
      | "submission_start"
      | "submitting"
    >,
    journalId?: string,
  ) => dispatch({ type: "ADVANCE", generation, phase, journalId });

  const reconcileUnresolved = async (
    generation: number,
    journalId: string,
  ): Promise<ActionFlowState> => {
    if (options.reconciliation === undefined) return state;
    try {
      const phase = await options.reconciliation.reconcile(journalId);
      if (phase !== null) {
        dispatch({ type: "TERMINAL", generation, journalId, phase });
      }
    } catch {
      // Durable unresolved state remains authoritative. The result sheet can be
      // dismissed while a later restart-safe worker retries without signing.
    }
    return state;
  };

  const reconcileFailure = (
    generation: number,
    journalId: string | null,
    error: unknown,
  ): ActionFlowState => {
    const reflectDurable = (record: PreparedActionRecord): ActionFlowState => {
      if (state.phase === "submission_start") {
        advance(generation, "submitting", record.journalId);
      }
      if (
        record.state === "unresolved" ||
        record.state === "submission_started"
      ) {
        dispatch({
          type: "UNRESOLVED",
          generation,
          journalId: record.journalId,
        });
        return state;
      }
      const phase =
        record.state === "reconciled_ambiguous"
          ? "ambiguous"
          : record.state === "accepted" ||
              record.state === "rejected" ||
              record.state === "expired"
            ? record.state
            : null;
      if (phase !== null) {
        dispatch({
          type: "TERMINAL",
          generation,
          journalId: record.journalId,
          phase,
        });
      }
      return state;
    };

    let record =
      journalId === null ? null : options.repository.getAction(journalId);
    if (record?.state === "submission_started") {
      try {
        record = options.repository.transitionAction(
          record.journalId,
          "unresolved",
          "unresolved",
          options.now(),
        );
      } catch {
        record = options.repository.getAction(record.journalId) ?? record;
      }
      return reflectDurable(record);
    }
    if (
      record?.state === "unresolved" ||
      record?.state === "accepted" ||
      record?.state === "rejected" ||
      record?.state === "expired" ||
      record?.state === "reconciled_ambiguous"
    ) {
      return reflectDurable(record);
    }
    if (record?.state === "prepared") {
      try {
        record = options.repository.transitionAction(
          record.journalId,
          "abandoned_before_submission",
          null,
          options.now(),
        );
      } catch {
        record = options.repository.getAction(record.journalId) ?? record;
        if (record.state !== "prepared") return reflectDurable(record);
      }
    }
    if (
      record?.state === "submission_started" ||
      record?.state === "unresolved"
    ) {
      return reflectDurable(record);
    }
    dispatch({
      type: "FAIL_BEFORE_SUBMISSION",
      generation,
      journalId: record?.journalId,
      message: preSubmissionFailureMessage(state.phase, error),
    });
    return state;
  };

  const orchestrator: ActionOrchestrator = {
    read: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      dispatch({ type: "RESET" });
    },
    async confirm(review, lifecycle) {
      assertTestnetSigningCapability(review.binding.network);
      assertTestnetSigningCapability(review.validation.context.network);
      if (
        state.phase !== "review" &&
        state.phase !== "failed_before_submission"
      ) {
        throw new Error("An action confirmation is already in progress.");
      }
      dispatch({ type: "CONFIRM" });
      const generation = state.generation;
      let journalId: string | null = null;
      try {
        requireCurrent(review);
        const refreshedInput = await options.refresh(review);
        requireCurrent(review);
        const refreshed = validateTradingAction(refreshedInput);
        assertSignerBinding(
          review.binding,
          currentBinding(review, refreshedInput),
        );
        if (
          refreshedInput.context.capturedContextEpoch !==
            review.validation.context.capturedContextEpoch ||
          refreshed.marketCanonicalId !==
            review.validation.market.canonicalId ||
          refreshedInput.market.metadataFingerprint !==
            review.validation.market.metadataFingerprint ||
          refreshed.accountStateVersion !== review.validated.accountStateVersion
        ) {
          throw new Error("The reviewed market or account snapshot is stale.");
        }
        if (
          !sameReviewedControls(review, refreshedInput) ||
          !sameReviewedIntent(
            review.validated.intent,
            refreshed.intent,
            refreshedInput,
          )
        ) {
          throw new Error(
            "Market or account rules changed the reviewed action.",
          );
        }

        advance(generation, "unlocking");
        await options.session.unlock({
          binding: review.binding,
          capturedContextEpoch: review.validation.context.capturedContextEpoch,
          isContextCurrent: () => options.isContextCurrent(review),
        });
        requireCurrent(review);

        advance(generation, "reserving");
        try {
          lifecycle?.onAuthenticated?.(
            createActionReview({
              binding: review.binding,
              capturedContextEpoch:
                review.validation.context.capturedContextEpoch,
              validation: refreshedInput,
              vaultAddress: review.vaultAddress,
              estimatedFee: review.presentation.estimatedFee,
              marketLabel: review.presentation.market,
            }),
          );
        } catch {
          // Presentation observers never own action correctness.
        }
        const normalizedIntent = storedIntent(refreshed, refreshedInput);
        const identity = identityFields(refreshed.intent);
        const prepared = options.repository.reservePreparedAction({
          binding: review.binding,
          capturedContextEpoch: review.validation.context.capturedContextEpoch,
          clock: options.clock(),
          preparedAction: {
            journalId: options.ids.journalId(),
            correlationId: options.ids.correlationId(),
            actionType: refreshed.intent.type,
            intentVersion: 1,
            normalizedSecretFreeIntent: normalizedIntent,
            intentDigest: digest(normalizedIntent),
            equivalenceFingerprint: digest({
              action: withoutCloid(refreshed.intent),
              marketCanonicalId: refreshed.marketCanonicalId,
            }),
            ...identity,
          },
        });
        journalId = prepared.journalId;

        requireCurrent(review);
        advance(generation, "signing", prepared.journalId);
        const action = buildExchangeAction(refreshed.intent);
        const encoded = encodeL1Action({
          action,
          nonce: prepared.nonce,
          vaultAddress: review.vaultAddress,
          expiresAfter: prepared.expiresAfterMs,
        });
        const payload = buildL1TypedData("testnet", encoded);
        const signature = await options.session.signTypedData({
          expectedBinding: review.binding,
          payload: payload.typedData,
          capturedContextEpoch: review.validation.context.capturedContextEpoch,
          isContextCurrent: () => options.isContextCurrent(review),
        });
        requireCurrent(review);

        advance(generation, "submission_start", prepared.journalId);
        assertTestnetSigningCapability(review.binding.network);
        const receipt = options.repository.markSubmissionStarted(
          prepared.journalId,
          options.now(),
        );
        advance(generation, "submitting", prepared.journalId);
        const result = await receipt.transportPermit.consume(() =>
          options.exchange.submit({
            action,
            nonce: prepared.nonce,
            signature,
            vaultAddress: encoded.vaultAddress,
            expiresAfter: prepared.expiresAfterMs,
          }),
        );

        if (result.kind === "unresolved") {
          options.repository.transitionAction(
            prepared.journalId,
            "unresolved",
            "unresolved",
            options.now(),
          );
          dispatch({
            type: "UNRESOLVED",
            generation,
            journalId: prepared.journalId,
          });
          return reconcileUnresolved(generation, prepared.journalId);
        }
        const phase = result.kind;
        options.repository.transitionAction(
          prepared.journalId,
          phase,
          phase,
          options.now(),
        );
        dispatch({
          type: "TERMINAL",
          generation,
          journalId: prepared.journalId,
          phase,
          ...(result.kind === "rejected" && result.reason === "minimum_notional"
            ? { message: MINIMUM_ORDER_NOTIONAL_MESSAGE }
            : result.kind === "rejected" &&
                refreshed.intent.type === "reduce_only_close"
              ? { message: CLOSE_REJECTED_MESSAGE }
              : result.kind === "rejected" && refreshed.intent.type === "cancel"
                ? { message: CANCEL_REJECTED_MESSAGE }
                : {}),
        });
        return state;
      } catch (error) {
        const recovered = reconcileFailure(generation, journalId, error);
        return recovered.phase === "reconciling" && recovered.journalId !== null
          ? reconcileUnresolved(generation, recovered.journalId)
          : recovered;
      }
    },
  };
  return orchestrator;
}

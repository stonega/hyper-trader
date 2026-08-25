import {
  assertSignerBinding,
  createExchangeClient,
  hasTradingActionCapability,
  type SignerBinding,
} from "@hyper-trader/hyperliquid";
import { randomUUID } from "expo-crypto";
import type { JSX, PropsWithChildren } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  type TradingContextValue,
  useTradingContext,
} from "../../core/context/provider";
import type { NormalizedTradingContext } from "../../core/context/supervisor";
import { createSignerActivityGate } from "../../core/session/activity-gate";
import type { SignerSessionManager } from "../../core/session/manager";
import {
  SignerSessionProvider,
  useSignerSession,
} from "../../core/session/provider";
import type { SqliteNonceAndJournalRepository } from "../../platform/persistence/nonce-repository";
import {
  getManualSetupRuntime,
  type ManualSetupRuntime,
} from "../accounts/manual-setup-runtime";
import {
  type AuthoritativeServerClock,
  createAuthoritativeServerClock,
  isActionReviewContextCurrent,
  refreshReviewedOrder,
} from "./authoritative-order-refresh";
import { createHyperliquidReconciliationEvidenceSource } from "./authoritative-reconciliation";
import {
  signingRuntimeEnabled,
  tradingRuntimeEnabled,
} from "./development-capability";
import { createActionOrchestrator } from "./orchestrator";
import {
  createActionReconciler,
  createActionReconciliationPort,
} from "./reconciler";
import { ActionRuntimeProvider } from "./runtime-provider";

function isDevelopmentBuild(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

export function TradingSignerSessionProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const enabled = signingRuntimeEnabled(isDevelopmentBuild());
  const activityGateRef = useRef<ReturnType<
    typeof createSignerActivityGate
  > | null>(null);
  if (activityGateRef.current === null) {
    activityGateRef.current = createSignerActivityGate({
      initiallyActiveAndFocused: AppState.currentState === "active",
    });
  }
  const activityGate = activityGateRef.current;
  const [manager, setManager] = useState<SignerSessionManager | null>(null);

  useEffect(() => {
    activityGate.setActiveAndFocused(AppState.currentState === "active");
    const change = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        activityGate.interrupt();
        return;
      }
      activityGate.setActiveAndFocused(state === "active");
    });
    const focus = AppState.addEventListener("focus", () => {
      activityGate.setActiveAndFocused(AppState.currentState === "active");
    });
    const blur = AppState.addEventListener("blur", () => {
      activityGate.setActiveAndFocused(false);
    });
    return () => {
      change.remove();
      focus.remove();
      blur.remove();
      activityGate.interrupt();
    };
  }, [activityGate]);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    let created: SignerSessionManager | null = null;
    void getManualSetupRuntime()
      .then((runtime) => {
        if (!mounted) return;
        created = runtime.createSignerSessionManager({
          isActiveAndFocused: activityGate.isActiveAndFocused,
          waitUntilActiveAndFocused: activityGate.waitUntilActiveAndFocused,
        });
        setManager(created);
      })
      .catch(() => {
        if (mounted) setManager(null);
      });
    return () => {
      mounted = false;
      created?.lock("app_terminated");
    };
  }, [activityGate, enabled]);

  return (
    <SignerSessionProvider
      key={enabled && manager === null ? "runtime-loading" : "runtime-ready"}
      manager={manager}
    >
      {children}
    </SignerSessionProvider>
  );
}

interface ActionInfrastructure {
  readonly manual: ManualSetupRuntime;
  readonly repository: SqliteNonceAndJournalRepository;
  readonly clock: AuthoritativeServerClock;
}

function createReconciliationPort(input: {
  readonly infrastructure: ActionInfrastructure;
  readonly owner: string;
  readonly shouldContinue?: () => boolean;
}) {
  const reconciler = createActionReconciler({
    owner: input.owner,
    now: Date.now,
    repository: input.infrastructure.repository,
    evidence: createHyperliquidReconciliationEvidenceSource({
      clock: input.infrastructure.clock,
    }),
    isActiveContext: () => false,
    publishToActiveContext: () => undefined,
  });
  return createActionReconciliationPort({
    repository: input.infrastructure.repository,
    reconciler,
    now: Date.now,
    ...(input.shouldContinue === undefined
      ? {}
      : { shouldContinue: input.shouldContinue }),
  });
}

function bindingForContext(
  context: NormalizedTradingContext,
): SignerBinding | null {
  if (
    !hasTradingActionCapability(context.network) ||
    context.masterAccount === null ||
    context.targetAccount === null ||
    context.signer === null
  ) {
    return null;
  }
  return {
    network: context.network,
    masterAccount: context.masterAccount,
    targetAccount: context.targetAccount,
    agentAddress: context.signer.agentAddress,
    generation: context.signer.generation,
  };
}

function bindingKey(binding: SignerBinding | null): string | null {
  return binding === null
    ? null
    : JSON.stringify([
        binding.network,
        binding.masterAccount,
        binding.targetAccount,
        binding.agentAddress,
        binding.generation,
      ]);
}

function opaqueId(prefix: "jrnl" | "act"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function readCurrentActionContext(trading: TradingContextValue) {
  const capture = trading.capture();
  return { context: trading.current, epoch: capture.epoch };
}

export function TradingActionRuntimeProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const signerSession = useSignerSession();
  const trading = useTradingContext();
  const enabled = tradingRuntimeEnabled({
    isDevelopmentBuild: isDevelopmentBuild(),
    network: trading.current.network,
  });
  const tradingRef = useRef(trading);
  tradingRef.current = trading;
  const reconciliationOwnerRef = useRef<string | null>(null);
  if (reconciliationOwnerRef.current === null) {
    reconciliationOwnerRef.current = `recon_${randomUUID()
      .replaceAll("-", "")
      .toLowerCase()}`;
  }
  const reconciliationOwner = reconciliationOwnerRef.current;
  const [infrastructure, setInfrastructure] =
    useState<ActionInfrastructure | null>(null);
  const currentBinding = useMemo(
    () => bindingForContext(trading.current),
    [trading.current],
  );
  const currentBindingKey = bindingKey(currentBinding);
  const [registeredBindingKey, setRegisteredBindingKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    let mounted = true;
    void getManualSetupRuntime()
      .then((manual) => {
        if (!mounted) return;
        const repository = manual.createActionRepository({
          commitIfCurrent(input, commit) {
            const live = tradingRef.current;
            const capture = live.capture();
            const binding = bindingForContext(live.current);
            if (
              binding === null ||
              capture.epoch !== input.capturedContextEpoch ||
              !live.canCommit(capture)
            ) {
              throw new Error(
                "The trading context changed before nonce reservation.",
              );
            }
            assertSignerBinding(input.binding, binding);
            return commit();
          },
        });
        repository.recoverAfterRestart(Date.now());
        setInfrastructure({
          manual,
          repository,
          clock: createAuthoritativeServerClock(),
        });
      })
      .catch(() => {
        if (mounted) setInfrastructure(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setRegisteredBindingKey(null);
    if (
      infrastructure === null ||
      currentBinding === null ||
      currentBindingKey === null
    ) {
      return;
    }
    try {
      infrastructure.manual.registerActionSignerScope(
        infrastructure.repository,
        currentBinding,
        Date.now(),
      );
      setRegisteredBindingKey(currentBindingKey);
    } catch {
      setRegisteredBindingKey(null);
    }
  }, [currentBinding, currentBindingKey, infrastructure]);

  useEffect(() => {
    if (infrastructure === null) return;
    let active = true;
    const reconciliation = createReconciliationPort({
      infrastructure,
      owner: reconciliationOwner,
      shouldContinue: () => active,
    });
    const journalIds = infrastructure.repository
      .listReconcilableActions()
      .map(({ journalId }) => journalId);
    void Promise.all(
      journalIds.map((journalId) => reconciliation.reconcile(journalId)),
    ).catch(() => {
      // Durable unresolved records remain available for the next safe restart.
    });
    return () => {
      active = false;
    };
  }, [infrastructure, reconciliationOwner]);

  const orchestrator = useMemo(() => {
    if (
      !enabled ||
      infrastructure === null ||
      signerSession.manager === null ||
      currentBinding === null ||
      currentBindingKey === null ||
      registeredBindingKey !== currentBindingKey
    ) {
      return null;
    }
    const manager = signerSession.manager;
    const clock = infrastructure.clock;
    return createActionOrchestrator({
      repository: infrastructure.repository,
      session: manager,
      exchange: createExchangeClient({
        network: currentBinding.network,
        fetch: clock.fetch,
      }),
      reconciliation: createReconciliationPort({
        infrastructure,
        owner: reconciliationOwner,
      }),
      refresh: (review) =>
        refreshReviewedOrder({
          review,
          clock,
          readCurrentContext: () =>
            readCurrentActionContext(tradingRef.current),
        }),
      isContextCurrent: (review) =>
        isActionReviewContextCurrent(
          review,
          readCurrentActionContext(tradingRef.current),
        ),
      clock: () => clock.read(),
      now: Date.now,
      ids: {
        journalId: () => opaqueId("jrnl"),
        correlationId: () => opaqueId("act"),
      },
    });
  }, [
    currentBinding,
    currentBindingKey,
    enabled,
    infrastructure,
    reconciliationOwner,
    registeredBindingKey,
    signerSession.manager,
  ]);

  return (
    <ActionRuntimeProvider orchestrator={orchestrator}>
      {children}
    </ActionRuntimeProvider>
  );
}

/** @deprecated Use TradingSignerSessionProvider. */
export const DevelopmentSignerSessionProvider = TradingSignerSessionProvider;

/** @deprecated Use TradingActionRuntimeProvider. */
export const DevelopmentActionRuntimeProvider = TradingActionRuntimeProvider;

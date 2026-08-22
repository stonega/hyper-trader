import {
  assertSignerBinding,
  createExchangeClient,
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
  createTestnetServerClock,
  isActionReviewContextCurrent,
  refreshReviewedOrder,
  type TestnetServerClock,
} from "./authoritative-order-refresh";
import { developmentTestnetSubmissionEnabled } from "./development-capability";
import { createActionOrchestrator } from "./orchestrator";
import { ActionRuntimeProvider } from "./runtime-provider";

function developmentBuild(): boolean {
  return developmentTestnetSubmissionEnabled(
    typeof __DEV__ !== "undefined" && __DEV__,
  );
}

export function DevelopmentSignerSessionProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const enabled = developmentBuild();
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

interface DevelopmentActionInfrastructure {
  readonly manual: ManualSetupRuntime;
  readonly repository: SqliteNonceAndJournalRepository;
  readonly clock: TestnetServerClock;
}

function bindingForContext(
  context: NormalizedTradingContext,
): SignerBinding | null {
  if (
    context.network !== "testnet" ||
    context.masterAccount === null ||
    context.targetAccount === null ||
    context.signer === null
  ) {
    return null;
  }
  return {
    network: "testnet",
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

export function DevelopmentActionRuntimeProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const enabled = developmentBuild();
  const signerSession = useSignerSession();
  const trading = useTradingContext();
  const tradingRef = useRef(trading);
  tradingRef.current = trading;
  const [infrastructure, setInfrastructure] =
    useState<DevelopmentActionInfrastructure | null>(null);
  const currentBinding = useMemo(
    () => bindingForContext(trading.current),
    [trading.current],
  );
  const currentBindingKey = bindingKey(currentBinding);
  const [registeredBindingKey, setRegisteredBindingKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!enabled || signerSession.manager === null) {
      setInfrastructure(null);
      return;
    }
    let mounted = true;
    void getManualSetupRuntime()
      .then((manual) => {
        if (!mounted || signerSession.manager === null) return;
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
        setInfrastructure({
          manual,
          repository,
          clock: createTestnetServerClock(),
        });
      })
      .catch(() => {
        if (mounted) setInfrastructure(null);
      });
    return () => {
      mounted = false;
    };
  }, [enabled, signerSession.manager]);

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

  const orchestrator = useMemo(() => {
    if (
      !enabled ||
      infrastructure === null ||
      signerSession.manager === null ||
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
        network: "testnet",
        fetch: clock.fetch,
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
    currentBindingKey,
    enabled,
    infrastructure,
    registeredBindingKey,
    signerSession.manager,
  ]);

  return (
    <ActionRuntimeProvider orchestrator={orchestrator}>
      {children}
    </ActionRuntimeProvider>
  );
}

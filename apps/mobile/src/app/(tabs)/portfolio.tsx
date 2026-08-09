import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import { Skeleton } from "heroui-native/skeleton";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PerformanceChart } from "../../components/chart/performance-chart";
import { SetupResumeCard } from "../../components/setup-resume-card";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useTradingContext } from "../../core/context/provider";
import { useSignerSession } from "../../core/session/provider";
import { useActionRuntime } from "../../features/actions/runtime-provider";
import { useMarketCatalogPresentation } from "../../features/markets/query";
import type {
  CloseDraft,
  PortfolioFilter,
  PortfolioOpenOrderRow,
  PortfolioPositionRow,
  PortfolioRange,
} from "../../features/portfolio/portfolio-model";
import {
  resolvePortfolioTarget,
  usePortfolioData,
} from "../../features/portfolio/portfolio-query";
import {
  buildPortfolioCancelReview,
  buildPortfolioCloseReview,
  buildPortfolioLeverageReview,
  portfolioCloseScopeKey,
} from "../../features/portfolio/portfolio-review";
import {
  type PortfolioActionAccess,
  type PortfolioEditor,
  PortfolioRows,
  PortfolioSelectionChip,
} from "../../features/portfolio/portfolio-rows";
import {
  cloidFromRandomBytes,
  createTradeOperationFence,
} from "../../features/trade/trade-model";
import { expoCryptographicRandomBytes } from "../../platform/security/agent-signer";

const RANGES: readonly {
  readonly value: PortfolioRange;
  readonly label: string;
}[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

const FILTERS: readonly {
  readonly value: PortfolioFilter;
  readonly label: string;
}[] = [
  { value: "positions", label: "Positions" },
  { value: "open_orders", label: "Open orders" },
  { value: "spot_balances", label: "Spot balances" },
  { value: "fills", label: "Fills" },
  { value: "funding", label: "Funding" },
  { value: "activity", label: "Activity" },
];

function shortAddress(address: string | null): string {
  return address === null
    ? "no account"
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function LoadingPortfolio(): JSX.Element {
  const reducedMotion = useReducedMotion();
  return (
    <View accessibilityLabel="Loading private portfolio" className="gap-3">
      {["headline", "chart", "rows"].map((key) => (
        <Skeleton
          animation={reducedMotion ? "disable-all" : undefined}
          className="h-40 w-full rounded-2xl"
          key={key}
          variant={reducedMotion ? "none" : "shimmer"}
        />
      ))}
    </View>
  );
}

export default function PortfolioScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const tradingContext = useTradingContext();
  const { current } = tradingContext;
  const signerSession = useSignerSession();
  const actionRuntime = useActionRuntime();
  const { catalog, catalogQuery, presentation } = useMarketCatalogPresentation(
    current.network,
  );
  const targetResolution = resolvePortfolioTarget(current);
  const { portfolio, query, freshness } = usePortfolioData(
    current,
    targetResolution.target,
    catalog?.markets,
  );
  const [range, setRange] = useState<PortfolioRange>("24h");
  const [filter, setFilter] = useState<PortfolioFilter>("positions");
  const [interaction, setInteraction] = useState<{
    readonly editor: PortfolioEditor | null;
    readonly invalidationMessage: string | null;
  }>({ editor: null, invalidationMessage: null });
  const [actionError, setActionError] = useState<string | null>(null);
  const editor = interaction.editor;

  const nowMs = Date.now();
  const accountCurrent =
    portfolio !== null &&
    Number.isSafeInteger(portfolio.observedAtMs) &&
    portfolio.observedAtMs <= nowMs + 5_000 &&
    nowMs - portfolio.observedAtMs <= 30_000;
  const actionGate = (() => {
    if (targetResolution.target === null) return targetResolution.reason;
    if (current.network !== "testnet") {
      return "Mainnet Portfolio is read-only. This build reviews testnet actions only.";
    }
    if (presentation.freshness !== "fresh") {
      return "Current market metadata is not fresh. Cached rows remain visible, but actions stay closed.";
    }
    if (freshness !== "fresh" || !accountCurrent || portfolio === null) {
      return "Current account evidence is stale, offline, or refreshing. Cached rows remain browse-only.";
    }
    if (current.signer === null) {
      return "No exact API-wallet binding is active for this account and target.";
    }
    if (signerSession.reason === "credential_invalidated") {
      return "The bound API wallet is invalid. Reauthorize it before review.";
    }
    if (!actionRuntime.available) {
      return "Trading actions are not enabled in this build.";
    }
    return null;
  })();
  const actionsEnabled = actionGate === null;
  const actionAccess: PortfolioActionAccess =
    actionGate === null
      ? {
          allowed: true,
          message: "Ready to review with current account and market data.",
        }
      : { allowed: false, reason: actionGate };
  const reviewScope = JSON.stringify([
    portfolio?.ownerKey ?? null,
    portfolio?.version ?? null,
    portfolio?.observedAtMs ?? null,
    current.network,
    current.masterAccount,
    current.targetAccount,
    current.signer?.agentAddress ?? null,
    current.signer?.generation ?? null,
    signerSession.reason,
    freshness,
    presentation.freshness,
    actionRuntime.available,
  ]);
  const reviewScopeRef = useRef(reviewScope);
  reviewScopeRef.current = reviewScope;
  const previousReviewScope = useRef(reviewScope);
  const closeOperationFence = useRef(createTradeOperationFence());
  const closeInFlight = useRef<ReturnType<
    ReturnType<typeof createTradeOperationFence>["begin"]
  > | null>(null);
  const closeScope = (() => {
    if (
      editor?.kind !== "close" ||
      portfolio === null ||
      targetResolution.target === null
    ) {
      return null;
    }
    const position = portfolio.positions.find(
      (row) => row.id === editor.positionId,
    );
    return position === undefined
      ? null
      : portfolioCloseScopeKey({
          portfolio,
          position,
          draft: editor.draft,
          context: current,
          target: targetResolution.target,
        });
  })();
  const closeScopeRef = useRef(closeScope);
  closeScopeRef.current = closeScope;

  const setEditor = (next: PortfolioEditor | null) => {
    setActionError(null);
    setInteraction({ editor: next, invalidationMessage: null });
  };

  useEffect(() => {
    if (previousReviewScope.current === reviewScope) return;
    previousReviewScope.current = reviewScope;
    closeOperationFence.current.invalidate();
    setInteraction((active) => {
      if (active.editor === null) return active;
      return {
        editor: null,
        invalidationMessage:
          "Account or market data changed. Reopen the position action to use current values.",
      };
    });
    setActionError(null);
  }, [reviewScope]);

  const editorOpen = editor !== null;
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (Keyboard.isVisible()) {
          Keyboard.dismiss();
          return true;
        }
        if (editorOpen) {
          setActionError(null);
          setInteraction({ editor: null, invalidationMessage: null });
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [editorOpen]);

  const reportActionError = (error: unknown) => {
    setActionError(
      error instanceof Error
        ? error.message
        : "The action stopped safely before review.",
    );
  };
  const assertActionCurrent = () => {
    if (
      portfolio === null ||
      !Number.isSafeInteger(portfolio.observedAtMs) ||
      portfolio.observedAtMs > Date.now() + 5_000 ||
      Date.now() - portfolio.observedAtMs > 30_000
    ) {
      throw new Error(
        "The account snapshot expired before review. Refresh current account data.",
      );
    }
  };
  const openReview = (
    capture: ReturnType<typeof tradingContext.capture>,
    capturedScope: string,
    review: Parameters<typeof actionRuntime.openReview>[0],
  ) => {
    if (
      capturedScope !== reviewScopeRef.current ||
      !tradingContext.canCommit(capture)
    ) {
      throw new Error(
        "The account or market snapshot changed before review opened.",
      );
    }
    actionRuntime.openReview(review);
    setInteraction({ editor: null, invalidationMessage: null });
    setActionError(null);
    router.push("/action-review");
  };

  const reviewCancel = (order: PortfolioOpenOrderRow) => {
    try {
      if (
        !actionsEnabled ||
        portfolio === null ||
        targetResolution.target === null
      ) {
        throw new Error(actionGate ?? "Current account evidence is required.");
      }
      assertActionCurrent();
      Keyboard.dismiss();
      const capturedScope = reviewScopeRef.current;
      const capture = tradingContext.capture();
      const review = buildPortfolioCancelReview({
        portfolio,
        order,
        target: targetResolution.target,
        context: current,
        capturedContextEpoch: capture.epoch,
        nowMs: Date.now(),
      });
      openReview(capture, capturedScope, review);
    } catch (error) {
      reportActionError(error);
    }
  };

  const reviewClose = async (
    position: PortfolioPositionRow,
    draft: CloseDraft,
  ) => {
    let operation: ReturnType<
      ReturnType<typeof createTradeOperationFence>["begin"]
    > | null = null;
    try {
      if (
        !actionsEnabled ||
        portfolio === null ||
        targetResolution.target === null
      ) {
        throw new Error(actionGate ?? "Current account evidence is required.");
      }
      if (closeInFlight.current !== null) {
        throw new Error("A close review is already being prepared.");
      }
      assertActionCurrent();
      Keyboard.dismiss();
      const capturedScope = reviewScopeRef.current;
      const capturedCloseScope = portfolioCloseScopeKey({
        portfolio,
        position,
        draft,
        context: current,
        target: targetResolution.target,
      });
      if (capturedCloseScope !== closeScopeRef.current) {
        throw new Error(
          "The close details changed. Review the current values and try again.",
        );
      }
      operation = closeOperationFence.current.begin(
        position.canonicalMarketId ?? position.id,
        capturedCloseScope,
      );
      closeInFlight.current = operation;
      const capture = tradingContext.capture();
      const cloid = cloidFromRandomBytes(
        await expoCryptographicRandomBytes(16),
      );
      if (
        !closeOperationFence.current.canCommit(
          operation,
          closeScopeRef.current ?? "",
        ) ||
        capturedScope !== reviewScopeRef.current ||
        !tradingContext.canCommit(capture)
      ) {
        throw new Error(
          "The position or account snapshot changed while review was prepared.",
        );
      }
      const review = buildPortfolioCloseReview({
        portfolio,
        position,
        draft,
        cloid,
        target: targetResolution.target,
        context: current,
        capturedContextEpoch: capture.epoch,
        nowMs: Date.now(),
      });
      if (
        !closeOperationFence.current.canCommit(
          operation,
          closeScopeRef.current ?? "",
        )
      ) {
        throw new Error(
          "The close details changed while review was prepared. Try again with current values.",
        );
      }
      openReview(capture, capturedScope, review);
    } catch (error) {
      reportActionError(error);
    } finally {
      if (operation !== null && closeInFlight.current === operation) {
        closeInFlight.current = null;
      }
    }
  };

  const reviewMargin = (
    position: PortfolioPositionRow,
    leverage: number,
    marginMode: "cross" | "isolated",
  ) => {
    try {
      if (
        !actionsEnabled ||
        portfolio === null ||
        targetResolution.target === null
      ) {
        throw new Error(actionGate ?? "Current account evidence is required.");
      }
      assertActionCurrent();
      Keyboard.dismiss();
      const capturedScope = reviewScopeRef.current;
      const capture = tradingContext.capture();
      const review = buildPortfolioLeverageReview({
        portfolio,
        position,
        leverage,
        marginMode,
        target: targetResolution.target,
        context: current,
        capturedContextEpoch: capture.epoch,
        nowMs: Date.now(),
      });
      openReview(capture, capturedScope, review);
    } catch (error) {
      reportActionError(error);
    }
  };

  const selectedRange = portfolio?.ranges[range] ?? null;
  const loading =
    targetResolution.target !== null &&
    portfolio === null &&
    (catalogQuery.isPending || query.isPending);
  const failed =
    portfolio === null &&
    (catalogQuery.isError || query.isError || query.isRefetchError);
  const refreshing = catalogQuery.isRefetching || query.isRefetching;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-background"
    >
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="gap-5 px-5 pb-10"
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 20) }}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            accessibilityLabel="Refresh Portfolio account and market metadata"
            onRefresh={() => {
              const accountRefresh =
                targetResolution.target !== null && catalog !== undefined
                  ? [query.refetch()]
                  : [];
              void Promise.all([catalogQuery.refetch(), ...accountRefresh]);
            }}
            refreshing={refreshing}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-3">
          <View className="flex-row flex-wrap items-start justify-between gap-3">
            <Text
              accessibilityRole="header"
              className="min-w-44 flex-1 text-4xl font-semibold tracking-tight text-foreground"
            >
              Portfolio
            </Text>
            <Chip
              accessibilityLabel={`${current.network} network, target ${shortAddress(current.targetAccount)}`}
              color={current.network === "testnet" ? "accent" : "warning"}
              size="sm"
              variant="soft"
            >
              {current.network} · {shortAddress(current.targetAccount)}
            </Chip>
          </View>
          <Text className="text-base leading-6 text-muted">
            One performance-first account view across native perpetuals, builder
            venues, spot balances, and current activity.
          </Text>
          <Text className="text-sm leading-5 text-muted">
            Master {shortAddress(current.masterAccount)} · target{" "}
            {shortAddress(current.targetAccount)}
          </Text>
        </View>

        {targetResolution.target === null ? (
          current.masterAccount === null ? (
            <SetupResumeCard />
          ) : (
            <Card variant="tertiary">
              <Card.Body className="gap-2">
                <Card.Title>Exact target type required</Card.Title>
                <Card.Description>{targetResolution.reason}</Card.Description>
              </Card.Body>
            </Card>
          )
        ) : loading ? (
          <LoadingPortfolio />
        ) : failed ? (
          <Card variant="tertiary" className="gap-4">
            <Card.Body className="gap-2">
              <Card.Title>Portfolio unavailable</Card.Title>
              <Card.Description>
                No trustworthy market catalog and private snapshot are cached
                for this exact account, target, and network.
              </Card.Description>
            </Card.Body>
            <Card.Footer>
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                onPress={() => {
                  const accountRetry =
                    targetResolution.target !== null && catalog !== undefined
                      ? [query.refetch()]
                      : [];
                  void Promise.all([catalogQuery.refetch(), ...accountRetry]);
                }}
                variant="secondary"
              >
                Retry account refresh
              </Button>
            </Card.Footer>
          </Card>
        ) : portfolio !== null ? (
          <>
            {freshness !== "fresh" || presentation.freshness !== "fresh" ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-warning"
              >
                Cached Portfolio rows remain visible while data is {freshness}.
                State-changing actions require current account and market
                evidence.
              </Text>
            ) : null}
            {interaction.invalidationMessage ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-warning"
              >
                {interaction.invalidationMessage}
              </Text>
            ) : null}

            <Card variant="default">
              <Card.Body className="gap-3">
                <Card.Description>Total account value</Card.Description>
                <Card.Title className="text-4xl tabular-nums">
                  {selectedRange?.accountValue ?? "Unavailable"}
                </Card.Title>
                <View className="flex-row flex-wrap gap-x-5 gap-y-2">
                  <Text className="text-base tabular-nums text-foreground">
                    PnL {selectedRange?.absolutePnl ?? "Unavailable"}
                  </Text>
                  <Text className="text-base tabular-nums text-muted">
                    {selectedRange?.percentagePnl === null ||
                    selectedRange?.percentagePnl === undefined
                      ? "Percentage unavailable"
                      : `${selectedRange.percentagePnl}%`}
                  </Text>
                </View>
              </Card.Body>
            </Card>

            <ScrollView
              accessibilityLabel="Performance range"
              contentContainerClassName="gap-2"
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {RANGES.map((option) => (
                <PortfolioSelectionChip
                  key={option.value}
                  label={option.label}
                  onPress={() => setRange(option.value)}
                  selected={range === option.value}
                />
              ))}
            </ScrollView>
            <PerformanceChart data={selectedRange} />

            {portfolio.gaps.length > 0 ? (
              <Card variant="tertiary">
                <Card.Body className="gap-2">
                  <Card.Title>Source coverage</Card.Title>
                  <Card.Description>
                    Missing sources remain explicit; no values are interpolated
                    or merged under a guessed market identity.
                  </Card.Description>
                  {portfolio.gaps.map((gap) => (
                    <Text className="text-sm leading-5 text-muted" key={gap}>
                      • {gap}
                    </Text>
                  ))}
                </Card.Body>
              </Card>
            ) : null}

            <View className="gap-2">
              <Text className="text-lg font-medium text-foreground">
                Account details
              </Text>
              <ScrollView
                accessibilityLabel="Portfolio filters"
                contentContainerClassName="gap-2"
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
              >
                {FILTERS.map((option) => (
                  <PortfolioSelectionChip
                    key={option.value}
                    label={option.label}
                    onPress={() => {
                      setFilter(option.value);
                      setEditor(null);
                    }}
                    selected={filter === option.value}
                  />
                ))}
              </ScrollView>
            </View>

            {actionGate ? (
              <Text
                accessibilityLiveRegion="polite"
                className="text-sm leading-5 text-muted"
              >
                Actions unavailable · {actionGate}
              </Text>
            ) : (
              <Text className="text-sm leading-5 text-muted">
                Review shows the exact account action before confirmation and
                unlocks the bound signer when required.
              </Text>
            )}

            {actionError ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-danger"
              >
                {actionError}
              </Text>
            ) : null}

            <PortfolioRows
              actionAccess={actionAccess}
              editor={editor}
              error={actionError}
              filter={filter}
              onCancel={reviewCancel}
              onReviewClose={(position, draft) =>
                void reviewClose(position, draft)
              }
              onReviewMargin={reviewMargin}
              portfolio={portfolio}
              setEditor={setEditor}
            />

            <Card variant="tertiary">
              <Card.Body className="gap-3">
                <Card.Title>External funding only</Card.Title>
                <Card.Description>
                  Hyper Trader does not deposit, withdraw, transfer, or bridge
                  funds. Before using an external service, verify every detail:
                </Card.Description>
                <Text selectable className="text-sm leading-5 text-foreground">
                  Destination · {current.targetAccount}
                </Text>
                <Text className="text-sm leading-5 text-foreground">
                  Master account · {current.masterAccount}
                </Text>
                <Text className="text-sm leading-5 text-foreground">
                  Network · {current.network}
                </Text>
              </Card.Body>
            </Card>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

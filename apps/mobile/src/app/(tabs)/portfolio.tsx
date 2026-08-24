import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Keyboard,
  Platform,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/app-text";
import { PerformanceChart } from "../../components/chart/performance-chart";
import { KeyboardAwareView } from "../../components/keyboard-aware-view";
import { floatingTabBarInset } from "../../components/navigation/floating-tab-bar";
import { ScreenHeading } from "../../components/screen-heading";
import { SetupResumeCard } from "../../components/setup-resume-card";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useTradingContext } from "../../core/context/provider";
import { runManualRefresh } from "../../core/query/manual-refresh";
import { useSignerSession } from "../../core/session/provider";
import { GlobalAccountSwitcher } from "../../features/accounts/global-account-switcher";
import { useActionRuntime } from "../../features/actions/runtime-provider";
import { useMarketCatalogPresentation } from "../../features/markets/query";
import {
  portfolioEditorOwnerScopeKey,
  portfolioEditorPositionExists,
} from "../../features/portfolio/portfolio-editor-state";
import { portfolioEvidenceAllowsReview } from "../../features/portfolio/portfolio-freshness";
import { portfolioLoadingSections } from "../../features/portfolio/portfolio-loading";
import type {
  CloseDraft,
  PortfolioFilter,
  PortfolioOpenOrderRow,
  PortfolioPositionRow,
  PortfolioRange,
} from "../../features/portfolio/portfolio-model";
import {
  PortfolioRowsPlaceholder,
  PortfolioSummaryCard,
} from "../../features/portfolio/portfolio-overview";
import {
  resolvePortfolioTarget,
  usePortfolioData,
} from "../../features/portfolio/portfolio-query";
import {
  portfolioManualRefreshPlan,
  runPortfolioRefreshPlan,
} from "../../features/portfolio/portfolio-refresh";
import {
  buildPortfolioCancelReview,
  buildPortfolioCloseReview,
  portfolioCloseScopeKey,
} from "../../features/portfolio/portfolio-review";
import {
  type PortfolioActionAccess,
  type PortfolioEditor,
  PortfolioRows,
  PortfolioSelectionChip,
} from "../../features/portfolio/portfolio-rows";
import { useScopedTradingPreferences } from "../../features/settings/preferences-provider";
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
export default function PortfolioScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const tradingContext = useTradingContext();
  const { current } = tradingContext;
  const signerSession = useSignerSession();
  const actionRuntime = useActionRuntime();
  const scopedPreferences = useScopedTradingPreferences();
  const { catalog, catalogQuery, presentation } = useMarketCatalogPresentation(
    current.network,
  );
  const targetResolution = resolvePortfolioTarget(current);
  const { portfolio, query, historyQuery, freshness } = usePortfolioData(
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
  const manualRefreshGate = useRef(false);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const editor = interaction.editor;

  useEffect(() => {
    setRange(
      scopedPreferences.status === "ready" &&
        scopedPreferences.scopeKey !== null
        ? scopedPreferences.preferences.defaultChartRange
        : "24h",
    );
  }, [
    scopedPreferences.preferences.defaultChartRange,
    scopedPreferences.scopeKey,
    scopedPreferences.status,
  ]);

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
    if (
      !portfolioEvidenceAllowsReview(freshness) ||
      !accountCurrent ||
      portfolio === null
    ) {
      return "Current account evidence is stale or offline. Cached rows remain browse-only.";
    }
    if (current.signer === null) {
      return "No exact API-wallet binding is active for this account and target.";
    }
    if (signerSession.reason === "credential_invalidated") {
      return "The bound API wallet is invalid. Reauthorize it before review.";
    }
    return null;
  })();
  const actionsEnabled = actionGate === null;
  const actionAccess: PortfolioActionAccess =
    actionGate === null
      ? {
          allowed: true,
          message: "Ready to review.",
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
    presentation.freshness,
    actionRuntime.available,
  ]);
  const reviewScopeRef = useRef(reviewScope);
  reviewScopeRef.current = reviewScope;
  const previousReviewScope = useRef(reviewScope);
  const editorOwnerScope = portfolioEditorOwnerScopeKey({
    network: current.network,
    masterAccount: current.masterAccount,
    target: targetResolution.target,
  });
  const previousEditorOwnerScope = useRef(editorOwnerScope);
  const closeOperationFence = useRef(createTradeOperationFence());
  const cancelInFlight = useRef(false);
  const closeInFlight = useRef<ReturnType<
    ReturnType<typeof createTradeOperationFence>["begin"]
  > | null>(null);
  const setEditor = (next: PortfolioEditor | null) => {
    if (closeInFlight.current !== null) {
      closeOperationFence.current.invalidate();
    }
    setActionError(null);
    setInteraction({ editor: next, invalidationMessage: null });
  };

  useEffect(() => {
    if (previousReviewScope.current === reviewScope) return;
    previousReviewScope.current = reviewScope;
    closeOperationFence.current.invalidate();
    setActionError(null);
  }, [reviewScope]);

  useEffect(() => {
    if (previousEditorOwnerScope.current === editorOwnerScope) return;
    previousEditorOwnerScope.current = editorOwnerScope;
    closeOperationFence.current.invalidate();
    setInteraction((active) => {
      if (active.editor === null) return active;
      return {
        editor: null,
        invalidationMessage:
          "The selected account changed. Reopen the position action for the current account.",
      };
    });
    setActionError(null);
  }, [editorOwnerScope]);

  const editorPositionExists = portfolioEditorPositionExists(editor, portfolio);
  useEffect(() => {
    if (editor === null || editorPositionExists) return;
    closeOperationFence.current.invalidate();
    setInteraction({
      editor: null,
      invalidationMessage:
        "This position is no longer open. The Limit close draft was cleared.",
    });
    setActionError(null);
  }, [editor, editorPositionExists]);

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
  const reviewCancel = async (order: PortfolioOpenOrderRow) => {
    try {
      if (
        !actionsEnabled ||
        portfolio === null ||
        targetResolution.target === null
      ) {
        throw new Error(actionGate ?? "Current account evidence is required.");
      }
      if (cancelInFlight.current || closeInFlight.current !== null) {
        throw new Error("Another Portfolio action is already being prepared.");
      }
      cancelInFlight.current = true;
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
      if (
        capturedScope !== reviewScopeRef.current ||
        !tradingContext.canCommit(capture)
      ) {
        throw new Error(
          "The account or market snapshot changed before cancellation review.",
        );
      }
      setActionError(null);
      const result = await actionRuntime.reviewAndSubmit(review);
      if (result.phase === "failed_before_submission") {
        throw new Error(
          result.message ??
            "The cancellation could not be reviewed with current market and account details.",
        );
      }
    } catch (error) {
      reportActionError(error);
    } finally {
      cancelInFlight.current = false;
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
      if (cancelInFlight.current || closeInFlight.current !== null) {
        throw new Error("Another Portfolio action is already being prepared.");
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
        !closeOperationFence.current.canCommit(operation, capturedCloseScope) ||
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
        !closeOperationFence.current.canCommit(operation, capturedCloseScope) ||
        capturedScope !== reviewScopeRef.current ||
        !tradingContext.canCommit(capture)
      ) {
        throw new Error(
          "The close details changed while review was prepared. Try again with current values.",
        );
      }
      setInteraction({ editor: null, invalidationMessage: null });
      setActionError(null);
      const result = await actionRuntime.reviewAndSubmit(review);
      if (result.phase === "failed_before_submission") {
        throw new Error(
          result.message ??
            "The close could not be reviewed with current market and account details.",
        );
      }
    } catch (error) {
      reportActionError(error);
    } finally {
      if (operation !== null && closeInFlight.current === operation) {
        closeInFlight.current = null;
      }
    }
  };

  const selectedRange = portfolio?.ranges[range] ?? null;
  const selectRange = (nextRange: PortfolioRange) => {
    setRange(nextRange);
    if (scopedPreferences.status === "ready") {
      void scopedPreferences.update({ defaultChartRange: nextRange });
    }
  };
  const failed =
    portfolio === null &&
    (catalogQuery.isError || query.isError || query.isRefetchError);
  const loadingSections = portfolioLoadingSections({
    filter,
    hasPortfolio: portfolio !== null,
    hasSelectedRange: selectedRange !== null,
    historyPending: historyQuery.isPending,
  });
  const refetchCatalog = catalogQuery.refetch;
  const refetchPortfolio = query.refetch;
  const refetchPortfolioHistory = historyQuery.refetch;
  const manualRefreshPlan = portfolioManualRefreshPlan({
    hasExactTarget: targetResolution.target !== null,
    hasCatalog: catalog !== undefined,
    catalogFresh: presentation.freshness === "fresh",
    catalogFailed: catalogQuery.isError || catalogQuery.isRefetchError,
    catalogRefreshing: catalogQuery.isRefetching,
  });
  const refreshFromPullGesture = useCallback(
    () =>
      runManualRefresh(
        manualRefreshGate,
        () =>
          runPortfolioRefreshPlan(manualRefreshPlan, {
            account: () => refetchPortfolio({ cancelRefetch: false }),
            catalog: () => refetchCatalog({ cancelRefetch: false }),
            history: () => refetchPortfolioHistory({ cancelRefetch: false }),
          }),
        setIsPullRefreshing,
      ),
    [
      manualRefreshPlan,
      refetchCatalog,
      refetchPortfolio,
      refetchPortfolioHistory,
    ],
  );

  return (
    <KeyboardAwareView className="flex-1 bg-background">
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="gap-5 px-5"
        contentContainerStyle={{
          paddingBottom: floatingTabBarInset(insets.bottom) + 16,
          paddingTop: Math.max(insets.top, 20),
        }}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            accessibilityLabel="Refresh Portfolio account data"
            onRefresh={refreshFromPullGesture}
            refreshing={isPullRefreshing}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeading
          description="Balances, positions, orders, and activity."
          network={current.network}
          rightAccessory={<GlobalAccountSwitcher avatarOnly />}
          showContext={false}
          title="Portfolio"
        />

        {targetResolution.target === null ? (
          current.masterAccount === null ? (
            <SetupResumeCard />
          ) : (
            <Card variant="tertiary">
              <Card.Body className="gap-2">
                <Card.Title>Choose an account</Card.Title>
                <Card.Description>
                  Select a saved account above to view Portfolio.
                </Card.Description>
              </Card.Body>
            </Card>
          )
        ) : failed ? (
          <Card variant="tertiary" className="gap-4">
            <Card.Body className="gap-2">
              <Card.Title>Portfolio unavailable</Card.Title>
              <Card.Description>
                Account data could not be loaded.
              </Card.Description>
            </Card.Body>
            <Card.Footer>
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                onPress={() => void refreshFromPullGesture()}
                variant="secondary"
              >
                Retry account refresh
              </Button>
            </Card.Footer>
          </Card>
        ) : (
          <>
            {portfolio !== null && interaction.invalidationMessage ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-warning"
              >
                {interaction.invalidationMessage}
              </Text>
            ) : null}

            <PortfolioSummaryCard
              data={selectedRange}
              loading={loadingSections.summary}
              marketFreshness={presentation.freshness}
              portfolioFreshness={freshness}
            />

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
                  onPress={() => selectRange(option.value)}
                  selected={range === option.value}
                />
              ))}
            </ScrollView>
            <PerformanceChart
              data={selectedRange}
              loading={loadingSections.performance}
              range={range}
            />

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

            {actionError ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-danger"
              >
                {actionError}
              </Text>
            ) : null}

            {loadingSections.rows ? (
              <PortfolioRowsPlaceholder />
            ) : portfolio !== null ? (
              <PortfolioRows
                actionAccess={actionAccess}
                editor={editor}
                error={actionError}
                filter={filter}
                markets={catalog?.markets ?? []}
                onCancel={reviewCancel}
                onReviewClose={reviewClose}
                portfolio={portfolio}
                setEditor={setEditor}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAwareView>
  );
}

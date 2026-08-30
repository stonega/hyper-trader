import Ionicons from "@expo/vector-icons/Ionicons";
import type { AccountTarget } from "@hyper-trader/hyperliquid";
import type {
  HyperliquidNetwork,
  Market,
} from "@hyper-trader/hyperliquid/public";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { useThemeColor } from "heroui-native/hooks";
import type { JSX } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Keyboard,
  Platform,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/app-text";
import { KeyboardAwareView } from "../../components/keyboard-aware-view";
import { floatingTabBarInset } from "../../components/navigation/floating-tab-bar";
import { MarketActivity } from "../../components/order-book/market-activity";
import { ScreenHeading } from "../../components/screen-heading";
import { SetupResumeCard } from "../../components/setup-resume-card";
import { COMPACT_SEGMENT_HIT_SLOP } from "../../components/ui/control-metrics";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useDraftRegistry } from "../../core/actions/draft-provider";
import { useTradingContext } from "../../core/context/provider";
import {
  contextIdentityKey,
  type NormalizedTradingContext,
} from "../../core/context/supervisor";
import { useNativeRenderSurfaceActive } from "../../core/lifecycle/provider";
import { runManualRefresh } from "../../core/query/manual-refresh";
import { useSignerSession } from "../../core/session/provider";
import { useAccountDirectory } from "../../features/accounts/account-directory-provider";
import { GlobalAccountSwitcher } from "../../features/accounts/global-account-switcher";
import { useActionRuntime } from "../../features/actions/runtime-provider";
import { CatalogStatus } from "../../features/markets/catalog-status";
import { marketPairLabel } from "../../features/markets/discovery";
import { MarketCard } from "../../features/markets/market-card";
import { MarketSummarySwitcher } from "../../features/markets/market-summary-switcher";
import { useMarketPreferences } from "../../features/markets/preferences-provider";
import { useMarketCatalogPresentation } from "../../features/markets/query";
import {
  isUsableTradeSelection,
  normalizeMarketRouteParam,
  type ResolvedMarketSelection,
  resolveMarketSelection,
} from "../../features/markets/selection";
import { useUsableTradeMarker } from "../../features/markets/use-usable-trade-marker";
import { resolvePortfolioTarget } from "../../features/portfolio/portfolio-query";
import { useScopedTradingPreferences } from "../../features/settings/preferences-provider";
import { MarketKlinePriceChart } from "../../features/trade/kline-price-chart";
import type { TradeChartInterval } from "../../features/trade/market-chart-config";
import {
  useTradeCandleData,
  useTradeMarketActivityData,
  useTradeMarketData,
  useTradeMarketDetailRefresh,
} from "../../features/trade/market-data";
import { OrderPanel } from "../../features/trade/order-panel";
import {
  useTradeAccountSnapshot,
  useTradeOpenOrders,
} from "../../features/trade/trade-account-query";
import { buildTradeChartOverlays } from "../../features/trade/trade-chart-overlays";
import { shouldSplitTradeWorkspace } from "../../features/trade/trade-layout";
import {
  TradeActivityPlaceholder,
  TradeChartPlaceholder,
  TradeMarketSummaryPlaceholder,
  TradeOrderEntryPlaceholder,
} from "../../features/trade/trade-loading-cards";
import {
  buildTradeLeverageReview,
  buildTradeReview,
  canStartTradeReview,
  cloidFromRandomBytes,
  createTradeDraft,
  createTradeOperationFence,
  evaluateTradeGate,
  reconcileTradeDraft,
  resolveCanonicalMarketSwitch,
  shouldShowTradeSetupCard,
  type TradeAccountSnapshot,
  type TradeAuthority,
  type TradeDraft,
  type TradeSignerState,
  tradeConnectivityFromCatalogFreshness,
  tradeDraftValueKey,
  tradeMarketFingerprint,
  tradeReviewScopeKey,
} from "../../features/trade/trade-model";
import { expoCryptographicRandomBytes } from "../../platform/security/agent-signer";

const LiveTradeChart = memo(function LiveTradeChart({
  context,
  target,
  network,
  market,
  account,
  draft,
  interval,
  onIntervalChange,
}: {
  readonly context: NormalizedTradingContext;
  readonly target: AccountTarget | null;
  readonly network: HyperliquidNetwork;
  readonly market: Market;
  readonly account: TradeAccountSnapshot | null;
  readonly draft: TradeDraft | null;
  readonly interval: TradeChartInterval;
  readonly onIntervalChange: (interval: TradeChartInterval) => void;
}): JSX.Element {
  const screenFocused = useIsFocused();
  const nativeRenderSurfaceActive = useNativeRenderSurfaceActive();
  const candles = useTradeCandleData(network, market, interval);
  const openOrders = useTradeOpenOrders(context, target, market);
  const overlays = useMemo(
    () =>
      buildTradeChartOverlays({
        market,
        lastPrice: candles.data?.at(-1)?.close ?? null,
        account,
        draft,
        openOrders: openOrders.data ?? [],
      }),
    [account, candles.data, draft, market, openOrders.data],
  );
  return (
    <MarketKlinePriceChart
      candles={candles.data}
      canonicalMarketId={market.canonicalId}
      compact
      interval={interval}
      key={`${network}:${market.canonicalId}`}
      historyError={candles.historyError}
      liveRange={candles.liveRange}
      loading={candles.isPending}
      onIntervalChange={onIntervalChange}
      overlays={overlays}
      realtime
      renderSurface={screenFocused && nativeRenderSurfaceActive}
      unavailable={candles.isError && candles.data === undefined}
    />
  );
});

const LiveTradeActivity = memo(function LiveTradeActivity({
  network,
  market,
  compact,
  onSelectPrice,
}: {
  readonly network: HyperliquidNetwork;
  readonly market: Market;
  readonly compact: boolean;
  readonly onSelectPrice: (price: string) => void;
}): JSX.Element {
  const activity = useTradeMarketActivityData(network, market);
  return (
    <MarketActivity
      book={activity.book.data}
      bookLoading={activity.book.isPending}
      bookUnavailable={activity.book.isError || activity.book.isRefetchError}
      compact={compact}
      onSelectPrice={onSelectPrice}
      style={compact ? { flex: 1 } : undefined}
      trades={activity.trades.data}
      tradesLoading={activity.trades.isPending}
      tradesUnavailable={
        activity.trades.isError || activity.trades.isRefetchError
      }
    />
  );
});

export default function TradeScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const splitWorkspace = shouldSplitTradeWorkspace({ width, fontScale });
  const router = useRouter();
  const params = useLocalSearchParams<{ market?: string | string[] }>();
  const tradingContext = useTradingContext();
  const { current } = tradingContext;
  const signerSession = useSignerSession();
  const directory = useAccountDirectory();
  const drafts = useDraftRegistry();
  const actionRuntime = useActionRuntime();
  const scopedPreferences = useScopedTradingPreferences();
  const tradeDefaults = useMemo(
    () =>
      scopedPreferences.status === "ready"
        ? {
            defaultOrderType: scopedPreferences.preferences.defaultOrderType,
            defaultSlippageBps:
              scopedPreferences.preferences.defaultSlippageBps,
          }
        : undefined,
    [
      scopedPreferences.preferences.defaultOrderType,
      scopedPreferences.preferences.defaultSlippageBps,
      scopedPreferences.status,
    ],
  );
  const preferences = useMarketPreferences();
  const reducedMotion = useReducedMotion();
  const accent = useThemeColor("accent");
  const { catalog, catalogQuery, isBootstrap, presentation } =
    useMarketCatalogPresentation(current.network);
  const [layoutReady, setLayoutReady] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [candleInterval, setCandleInterval] =
    useState<TradeChartInterval>("15m");
  const [draftState, setDraftState] = useState<{
    readonly draft: TradeDraft | null;
    readonly invalidationMessage: string | null;
  }>({ draft: null, invalidationMessage: null });
  const manualRefreshGate = useRef(false);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const operationFence = useRef(createTradeOperationFence());
  const requestedMarket = normalizeMarketRouteParam(params.market);
  const selection = useMemo<ResolvedMarketSelection | null>(() => {
    if (preferences.status === "loading") return null;
    const exact =
      requestedMarket === null
        ? null
        : resolveCanonicalMarketSwitch(catalog?.markets ?? [], requestedMarket);
    if (exact) return { market: exact, source: "route" };
    return resolveMarketSelection(
      catalog?.markets ?? [],
      requestedMarket,
      preferences.preferences.lastMarketId,
      {
        allowVolumeFallback:
          !isBootstrap ||
          (requestedMarket === null &&
            preferences.preferences.lastMarketId === null),
      },
    );
  }, [
    catalog?.markets,
    isBootstrap,
    preferences.preferences.lastMarketId,
    preferences.status,
    requestedMarket,
  ]);
  const catalogMarket = selection?.market ?? null;
  const marketData = useTradeMarketData(current.network, catalogMarket);
  const refreshMarketDetails = useTradeMarketDetailRefresh(
    current.network,
    catalogMarket,
    candleInterval,
  );
  const market = useMemo(
    () =>
      catalogMarket === null
        ? null
        : { ...catalogMarket, ...marketData.context.data },
    [catalogMarket, marketData.context.data],
  );
  const accountTarget = resolvePortfolioTarget(current).target;
  const hasSavedAccountForNetwork = directory.accounts.some(
    (account) => account.network === current.network,
  );
  const accountQuery = useTradeAccountSnapshot(current, accountTarget, market);
  const signerState: TradeSignerState =
    current.signer === null
      ? "missing"
      : signerSession.snapshot.status === "unlocked"
        ? "unlocked"
        : signerSession.reason === "credential_invalidated"
          ? "expired"
          : "locked";
  const authority = useMemo<TradeAuthority>(
    () => ({
      connectivity: tradeConnectivityFromCatalogFreshness(
        presentation.freshness,
      ),
      account: accountQuery.data ?? null,
      signerState,
      actionRuntimeAvailable: actionRuntime.available,
    }),
    [
      accountQuery.data,
      actionRuntime.available,
      presentation.freshness,
      signerState,
    ],
  );
  const authorityScope = market
    ? tradeReviewScopeKey({ market, context: current, authority })
    : JSON.stringify(["no-market", current.network]);
  const reviewScope = draftState.draft
    ? `${authorityScope}:${tradeDraftValueKey(draftState.draft)}`
    : authorityScope;
  const reviewScopeRef = useRef(reviewScope);
  reviewScopeRef.current = reviewScope;
  const gate = market
    ? evaluateTradeGate({
        market,
        context: current,
        authority,
        nowMs: Date.now(),
      })
    : null;
  const reviewInputRef = useRef({
    market,
    context: current,
    authority,
    draftState,
  });
  reviewInputRef.current = {
    market,
    context: current,
    authority,
    draftState,
  };
  const usable = isUsableTradeSelection(
    catalog?.markets ?? [],
    market?.canonicalId ?? null,
    layoutReady && presentation.content === "ready",
  );
  useUsableTradeMarker(usable);

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!Keyboard.isVisible() || switcherOpen) return false;
      Keyboard.dismiss();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [switcherOpen]);

  useEffect(() => () => operationFence.current.invalidate(), []);

  useEffect(() => {
    if (
      selection?.market.lifecycle === "active" &&
      preferences.status !== "loading" &&
      (preferences.preferences.lastMarketId !== selection.market.canonicalId ||
        preferences.preferences.recentIds[0] !== selection.market.canonicalId)
    ) {
      preferences.selectMarket(selection.market.canonicalId);
    }
  }, [preferences, selection]);

  const draftReconciliationKey =
    market === null
      ? JSON.stringify(["no-market", scopedPreferences.status])
      : JSON.stringify([
          contextIdentityKey(current),
          market.canonicalId,
          tradeMarketFingerprint(market),
          authority.account?.leverage ?? null,
          scopedPreferences.status,
          tradeDefaults?.defaultOrderType ?? null,
          tradeDefaults?.defaultSlippageBps ?? null,
        ]);
  const draftReconciliationInputRef = useRef({
    market,
    context: current,
    account: authority.account,
    preferences: tradeDefaults,
    preferencesStatus: scopedPreferences.status,
  });
  draftReconciliationInputRef.current = {
    market,
    context: current,
    account: authority.account,
    preferences: tradeDefaults,
    preferencesStatus: scopedPreferences.status,
  };
  useEffect(() => {
    void draftReconciliationKey;
    const input = draftReconciliationInputRef.current;
    const reconciliationMarket = input.market;
    if (
      reconciliationMarket === null ||
      input.preferencesStatus === "loading"
    ) {
      setDraftState({ draft: null, invalidationMessage: null });
      return;
    }
    setDraftState((previous) => {
      if (previous.draft === null) {
        return {
          draft: createTradeDraft({
            market: reconciliationMarket,
            context: input.context,
            account: input.account,
            preferences: input.preferences,
          }),
          invalidationMessage: previous.invalidationMessage,
        };
      }
      const reconciled = reconcileTradeDraft(previous.draft, {
        market: reconciliationMarket,
        context: input.context,
        account: input.account,
        preferences: input.preferences,
      });
      if (reconciled.preserved) {
        return reconciled.draft === previous.draft
          ? previous
          : {
              draft: reconciled.draft,
              invalidationMessage: previous.invalidationMessage,
            };
      }
      return {
        draft: reconciled.draft,
        invalidationMessage: reconciled.message,
      };
    });
  }, [draftReconciliationKey]);

  const draftBinding = draftState.draft?.binding ?? null;
  useEffect(() => {
    if (draftBinding === null) return;
    return drafts.register(draftBinding, (result) => {
      operationFence.current.invalidate();
      setDraftState({ draft: null, invalidationMessage: result.message });
    });
  }, [draftBinding, drafts]);

  const invalidRestoredMarket =
    selection !== null &&
    (selection.source === "default_market" ||
      selection.source === "volume_fallback") &&
    (requestedMarket !== null || preferences.preferences.lastMarketId !== null);
  const marketUnavailable =
    market === null &&
    presentation.content !== "loading" &&
    preferences.status !== "loading";
  const refetchAccount = accountQuery.refetch;
  const refetchCatalog = catalogQuery.refetch;
  const refreshFromPullGesture = useCallback(
    () =>
      runManualRefresh(
        manualRefreshGate,
        async () => {
          const detailRefreshes = market
            ? [
                refreshMarketDetails(),
                ...(accountTarget === null ? [] : [refetchAccount()]),
              ]
            : [];
          await Promise.all([refetchCatalog(), ...detailRefreshes]);
        },
        setIsPullRefreshing,
      ),
    [
      accountTarget,
      market,
      refetchAccount,
      refetchCatalog,
      refreshMarketDetails,
    ],
  );
  const showCatalogStatus =
    presentation.freshness === "stale" ||
    presentation.freshness === "offline" ||
    presentation.content !== "ready" ||
    presentation.hasPartialSources;

  const switchMarket = (canonicalId: string) => {
    operationFence.current.invalidate();
    preferences.selectMarket(canonicalId);
    router.setParams({ market: canonicalId });
  };

  const selectOrderBookPrice = useCallback((limitPrice: string) => {
    operationFence.current.invalidate();
    setDraftState((previous) =>
      previous.draft === null
        ? previous
        : {
            draft: {
              ...previous.draft,
              orderType: "limit",
              limitPrice,
            },
            invalidationMessage: null,
          },
    );
  }, []);

  const openReview = async (requestedDraft: TradeDraft) => {
    if (!market || !draftState.draft) {
      throw new Error(
        gate?.reason ?? "A current market and draft are required.",
      );
    }
    const startGate = evaluateTradeGate({
      market,
      context: current,
      authority,
      nowMs: Date.now(),
    });
    if (!canStartTradeReview(startGate)) {
      throw new Error(startGate.reason);
    }
    const initialReviewDraft = {
      ...draftState.draft,
      side: requestedDraft.side,
    };
    if (
      tradeDraftValueKey(initialReviewDraft) !==
      tradeDraftValueKey(requestedDraft)
    ) {
      throw new Error("The order changed before review could start.");
    }
    Keyboard.dismiss();
    const capture = tradingContext.capture();
    let reviewMarket = market;
    let reviewContext = current;
    let reviewAuthority = authority;
    if (startGate.code === "stale_account") {
      const refreshed = await refetchAccount({ cancelRefetch: false });
      if (!tradingContext.canCommit(capture)) {
        throw new Error(
          "Account context changed while account details were refreshed.",
        );
      }
      const latest = reviewInputRef.current;
      if (
        latest.market === null ||
        latest.market.canonicalId !== market.canonicalId
      ) {
        throw new Error("The selected market changed during account refresh.");
      }
      const refreshedAccount = refreshed.data;
      if (
        refreshed.isError ||
        refreshedAccount === undefined ||
        refreshedAccount === null
      ) {
        throw new Error(
          "Current account details could not be refreshed. Check your connection and try again.",
        );
      }
      reviewMarket = latest.market;
      reviewContext = latest.context;
      reviewAuthority = {
        ...latest.authority,
        account: refreshedAccount,
      };
      const refreshedGate = evaluateTradeGate({
        market: reviewMarket,
        context: reviewContext,
        authority: reviewAuthority,
        nowMs: Date.now(),
      });
      if (!refreshedGate.enabled) {
        throw new Error(refreshedGate.reason);
      }
    }
    const latestDraft = reviewInputRef.current.draftState.draft;
    if (latestDraft === null) {
      throw new Error(
        "The order changed while account details were refreshed.",
      );
    }
    const reviewDraft = {
      ...latestDraft,
      side: requestedDraft.side,
    };
    if (
      tradeDraftValueKey(reviewDraft) !== tradeDraftValueKey(requestedDraft)
    ) {
      throw new Error("The order changed before review could start.");
    }
    const reviewAuthorityScope = tradeReviewScopeKey({
      market: reviewMarket,
      context: reviewContext,
      authority: reviewAuthority,
    });
    const requestedReviewScope = `${reviewAuthorityScope}:${tradeDraftValueKey(reviewDraft)}`;
    setDraftState({ draft: reviewDraft, invalidationMessage: null });
    reviewScopeRef.current = requestedReviewScope;
    const operation = operationFence.current.begin(
      reviewMarket.canonicalId,
      requestedReviewScope,
    );
    const cloid = cloidFromRandomBytes(await expoCryptographicRandomBytes(16));
    if (
      !operationFence.current.canCommit(operation, reviewScopeRef.current) ||
      !tradingContext.canCommit(capture)
    ) {
      throw new Error(
        "Market or account context changed while review was prepared. Review the reset draft.",
      );
    }
    const review = buildTradeReview({
      market: reviewMarket,
      context: reviewContext,
      capturedContextEpoch: capture.epoch,
      authority: reviewAuthority,
      draft: reviewDraft,
      cloid,
      nowMs: Date.now(),
    });
    if (
      !operationFence.current.canCommit(operation, reviewScopeRef.current) ||
      !tradingContext.canCommit(capture)
    ) {
      throw new Error(
        "Market or account context changed before review opened.",
      );
    }
    const result = await actionRuntime.reviewAndSubmit(review);
    if (result.phase === "failed_before_submission") {
      throw new Error(
        result.message ??
          "The order could not be reviewed with current market and account details.",
      );
    }
  };

  const changeLeverage = async (leverage: number) => {
    if (!market) throw new Error("A current perpetual market is required.");
    const startGate = evaluateTradeGate({
      market,
      context: current,
      authority,
      nowMs: Date.now(),
    });
    if (!canStartTradeReview(startGate)) throw new Error(startGate.reason);
    Keyboard.dismiss();
    const capture = tradingContext.capture();
    let reviewMarket = market;
    let reviewContext = current;
    let reviewAuthority = authority;
    if (startGate.code === "stale_account") {
      const refreshed = await refetchAccount({ cancelRefetch: false });
      if (!tradingContext.canCommit(capture)) {
        throw new Error(
          "Account context changed while account details were refreshed.",
        );
      }
      const latest = reviewInputRef.current;
      if (
        latest.market === null ||
        latest.market.canonicalId !== market.canonicalId
      ) {
        throw new Error("The selected market changed during account refresh.");
      }
      const refreshedAccount = refreshed.data;
      if (
        refreshed.isError ||
        refreshedAccount === undefined ||
        refreshedAccount === null
      ) {
        throw new Error(
          "Current account details could not be refreshed. Check your connection and try again.",
        );
      }
      reviewMarket = latest.market;
      reviewContext = latest.context;
      reviewAuthority = { ...latest.authority, account: refreshedAccount };
      const refreshedGate = evaluateTradeGate({
        market: reviewMarket,
        context: reviewContext,
        authority: reviewAuthority,
        nowMs: Date.now(),
      });
      if (!refreshedGate.enabled) throw new Error(refreshedGate.reason);
    }
    const leverageReviewScope = `${tradeReviewScopeKey({
      market: reviewMarket,
      context: reviewContext,
      authority: reviewAuthority,
    })}:leverage:${leverage}`;
    reviewScopeRef.current = leverageReviewScope;
    const operation = operationFence.current.begin(
      reviewMarket.canonicalId,
      leverageReviewScope,
    );
    const review = buildTradeLeverageReview({
      market: reviewMarket,
      context: reviewContext,
      capturedContextEpoch: capture.epoch,
      authority: reviewAuthority,
      leverage,
      nowMs: Date.now(),
    });
    if (
      !operationFence.current.canCommit(operation, leverageReviewScope) ||
      !tradingContext.canCommit(capture)
    ) {
      throw new Error(
        "Market or account context changed before leverage review opened.",
      );
    }
    const result = await actionRuntime.reviewAndSubmit(review);
    if (result.phase === "failed_before_submission") {
      throw new Error(
        result.message ??
          "The leverage change could not be reviewed with current account details.",
      );
    }
    if (result.phase === "accepted") {
      await refetchAccount({ cancelRefetch: false });
    }
  };

  return (
    <KeyboardAwareView className="flex-1 bg-background">
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="gap-3 px-3"
        contentContainerStyle={{
          paddingBottom: floatingTabBarInset(insets.bottom) + 16,
          paddingTop: Math.max(insets.top, 20),
        }}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        onLayout={() => setLayoutReady(true)}
        refreshControl={
          <RefreshControl
            accessibilityLabel="Refresh Trade market and activity"
            onRefresh={refreshFromPullGesture}
            refreshing={isPullRefreshing}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeading
          network={current.network}
          rightAccessory={<GlobalAccountSwitcher avatarOnly />}
          showContext={false}
          title="Trade"
          titleAccessory={
            <Button
              accessibilityHint="Opens the market selector."
              accessibilityLabel={
                market
                  ? `Switch market. ${marketPairLabel(market)}`
                  : "Choose a market"
              }
              animation={reducedMotion ? "disable-all" : undefined}
              className="h-10 min-h-10 min-w-0 max-w-40 gap-1 px-3"
              hitSlop={COMPACT_SEGMENT_HIT_SLOP}
              onPress={() => setSwitcherOpen(true)}
              size="sm"
              variant="secondary"
            >
              <Button.Label
                adjustsFontSizeToFit
                className="min-w-0 shrink"
                numberOfLines={1}
              >
                {market ? marketPairLabel(market) : "Market"}
              </Button.Label>
              <Ionicons
                accessibilityElementsHidden
                color={accent}
                importantForAccessibility="no-hide-descendants"
                name="chevron-down"
                size={16}
              />
            </Button>
          }
        />

        {shouldShowTradeSetupCard({
          hasMarket: market !== null,
          accountDirectoryReady: directory.status === "ready",
          hasSavedAccountForNetwork,
          gate,
        }) ? (
          <SetupResumeCard network={current.network} />
        ) : null}

        {invalidRestoredMarket ? (
          <Text
            accessibilityRole="alert"
            className="text-sm leading-5 text-warning"
          >
            {selection?.source === "default_market"
              ? "The requested or last market is no longer available. Trade selected BTC-USDC."
              : "The requested or last market and BTC-USDC are unavailable. Trade selected the highest-volume current market."}
          </Text>
        ) : null}

        {market && catalogMarket ? (
          <MarketCard
            market={market}
            showOrderAvailability
            status={
              showCatalogStatus ? (
                <CatalogStatus
                  compact
                  onRetry={() => void catalogQuery.refetch()}
                  state={presentation}
                />
              ) : undefined
            }
          />
        ) : presentation.content === "loading" ||
          preferences.status === "loading" ? (
          <TradeMarketSummaryPlaceholder />
        ) : (
          <TradeMarketSummaryPlaceholder unavailable />
        )}

        {market &&
        (presentation.freshness === "offline" ||
          presentation.freshness === "stale") ? (
          <Text
            accessibilityRole="alert"
            className="text-sm leading-5 text-warning"
          >
            Some market data may be out of date. Pull to refresh.
          </Text>
        ) : null}

        {market ? (
          <LiveTradeChart
            account={authority.account}
            context={current}
            draft={draftState.draft}
            network={current.network}
            market={market}
            interval={candleInterval}
            onIntervalChange={setCandleInterval}
            target={accountTarget}
          />
        ) : (
          <TradeChartPlaceholder
            interval={candleInterval}
            onIntervalChange={setCandleInterval}
            unavailable={marketUnavailable}
          />
        )}

        <View
          className={splitWorkspace ? "flex-row items-stretch gap-2" : "gap-3"}
        >
          {market && draftState.draft && gate ? (
            <OrderPanel
              authority={authority}
              compact={splitWorkspace}
              draft={draftState.draft}
              gate={gate}
              invalidationMessage={draftState.invalidationMessage}
              key={`${draftState.draft.binding.contextKey}:${draftState.draft.binding.marketCanonicalId}:${draftState.draft.binding.metadataFingerprint}`}
              market={market}
              onDraftChange={(draft) =>
                setDraftState({ draft, invalidationMessage: null })
              }
              onLeverageChange={changeLeverage}
              onReview={openReview}
              style={splitWorkspace ? { flex: 1.35 } : undefined}
            />
          ) : (
            <TradeOrderEntryPlaceholder
              splitWorkspace={splitWorkspace}
              unavailable={marketUnavailable}
            />
          )}
          {catalogMarket ? (
            <LiveTradeActivity
              compact={splitWorkspace}
              market={catalogMarket}
              network={current.network}
              onSelectPrice={selectOrderBookPrice}
            />
          ) : (
            <TradeActivityPlaceholder
              splitWorkspace={splitWorkspace}
              unavailable={marketUnavailable}
            />
          )}
        </View>
      </ScrollView>
      <MarketSummarySwitcher
        network={current.network}
        onClose={() => setSwitcherOpen(false)}
        onSelect={switchMarket}
        selectedCanonicalId={market?.canonicalId ?? null}
        visible={switcherOpen}
      />
    </KeyboardAwareView>
  );
}

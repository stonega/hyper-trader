import Ionicons from "@expo/vector-icons/Ionicons";
import type { Market } from "@hyper-trader/hyperliquid/public";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import { useThemeColor } from "heroui-native/hooks";
import { Skeleton } from "heroui-native/skeleton";
import type { JSX } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/app-text";
import { floatingTabBarInset } from "../../components/navigation/floating-tab-bar";
import { MarketActivity } from "../../components/order-book/market-activity";
import { ScreenHeading } from "../../components/screen-heading";
import { SetupResumeCard } from "../../components/setup-resume-card";
import { COMPACT_SEGMENT_HIT_SLOP } from "../../components/ui/control-metrics";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useDraftRegistry } from "../../core/actions/draft-provider";
import { useTradingContext } from "../../core/context/provider";
import { useSignerSession } from "../../core/session/provider";
import { GlobalAccountSwitcher } from "../../features/accounts/global-account-switcher";
import { useActionRuntime } from "../../features/actions/runtime-provider";
import { CatalogStatus } from "../../features/markets/catalog-status";
import {
  marketDisplayLabel,
  marketPairLabel,
  marketPriceChangePercent,
  marketVenueLabel,
} from "../../features/markets/discovery";
import {
  formatCompactDecimal,
  formatMarketPrice,
  formatPercent,
} from "../../features/markets/format";
import { MarketSwitcher } from "../../features/markets/market-switcher";
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
import { MarketCandlestickChart } from "../../features/trade/candlestick-chart";
import type { TradeChartInterval } from "../../features/trade/market-chart-config";
import { useTradeMarketData } from "../../features/trade/market-data";
import { OrderPanel } from "../../features/trade/order-panel";
import { useTradeAccountSnapshot } from "../../features/trade/trade-account-query";
import { shouldSplitTradeWorkspace } from "../../features/trade/trade-layout";
import {
  buildTradeReview,
  cloidFromRandomBytes,
  createTradeDraft,
  createTradeOperationFence,
  evaluateTradeGate,
  reconcileTradeDraft,
  resolveCanonicalMarketSwitch,
  type TradeAuthority,
  type TradeDraft,
  type TradeSignerState,
  tradeConnectivityFromCatalogFreshness,
  tradeDraftValueKey,
  tradeReviewScopeKey,
} from "../../features/trade/trade-model";
import { expoCryptographicRandomBytes } from "../../platform/security/agent-signer";

function MarketSummary({ market }: { readonly market: Market }): JSX.Element {
  const orderable =
    market.orderAvailability === "enabled" && market.lifecycle === "active";
  return (
    <Card variant="default" className="gap-3">
      <Card.Header className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Card.Title className="text-xl">
            {marketDisplayLabel(market)}
          </Card.Title>
          <Card.Description>{marketVenueLabel(market)}</Card.Description>
        </View>
        <View className="items-end gap-1">
          <Text
            adjustsFontSizeToFit
            className="text-2xl font-semibold tabular-nums text-foreground"
            numberOfLines={1}
          >
            {formatMarketPrice(market)}
          </Text>
          <Text className="text-sm tabular-nums text-muted">
            {formatPercent(marketPriceChangePercent(market))} · 24h
          </Text>
        </View>
      </Card.Header>
      <Card.Body className="flex-row flex-wrap items-end gap-x-4 gap-y-2">
        <View className="min-w-28 flex-1">
          <Stat
            label="24h volume"
            value={formatCompactDecimal(market.dayNtlVlm)}
          />
        </View>
        {market.family === "perp" ? (
          <>
            <View className="min-w-24 flex-1">
              <Stat
                label="Funding"
                value={formatCompactDecimal(market.funding)}
              />
            </View>
            <View className="min-w-28 flex-1">
              <Stat
                label="Open interest"
                value={formatCompactDecimal(market.openInterest)}
              />
            </View>
          </>
        ) : market.family === "spot" ? (
          <View className="min-w-28 flex-1">
            <Stat
              label="Pair"
              value={`${market.baseToken.name}/${market.quoteToken.name}`}
            />
          </View>
        ) : (
          <View className="min-w-28 flex-1">
            <Stat label="Outcome" value={market.sideName} />
          </View>
        )}
        <Chip
          accessibilityLabel={
            orderable
              ? "Order metadata is present; freshness and authority are checked separately"
              : "Browse-only market"
          }
          color={orderable ? "success" : "warning"}
          size="sm"
          variant="soft"
        >
          {orderable ? "Trading" : "Browse only"}
        </Chip>
      </Card.Body>
    </Card>
  );
}

function Stat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <View className="gap-1">
      <Text className="text-xs uppercase tracking-wide text-muted">
        {label}
      </Text>
      <Text className="text-base tabular-nums text-foreground">{value}</Text>
    </View>
  );
}

function TradeLoading(): JSX.Element {
  const reducedMotion = useReducedMotion();
  return (
    <View accessibilityLabel="Loading selected Trade market" className="gap-3">
      {["summary", "chart", "activity", "order"].map((key) => (
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

export default function TradeScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const splitWorkspace = shouldSplitTradeWorkspace({ width, fontScale });
  const router = useRouter();
  const params = useLocalSearchParams<{ market?: string | string[] }>();
  const tradingContext = useTradingContext();
  const { current } = tradingContext;
  const signerSession = useSignerSession();
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
  const market = selection?.market ?? null;
  const accountTarget = resolvePortfolioTarget(current).target;
  const accountQuery = useTradeAccountSnapshot(current, accountTarget, market);
  const marketData = useTradeMarketData(
    current.network,
    market,
    candleInterval,
  );
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

  useEffect(() => {
    if (market === null || scopedPreferences.status === "loading") {
      setDraftState({ draft: null, invalidationMessage: null });
      return;
    }
    setDraftState((previous) => {
      if (previous.draft === null) {
        return {
          draft: createTradeDraft({
            market,
            context: current,
            account: authority.account,
            preferences: tradeDefaults,
          }),
          invalidationMessage: previous.invalidationMessage,
        };
      }
      const reconciled = reconcileTradeDraft(previous.draft, {
        market,
        context: current,
        account: authority.account,
        preferences: tradeDefaults,
      });
      return reconciled.preserved
        ? previous
        : {
            draft: reconciled.draft,
            invalidationMessage: reconciled.message,
          };
    });
  }, [
    authority.account,
    current,
    market,
    scopedPreferences.status,
    tradeDefaults,
  ]);

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
    selection.source === "volume_fallback" &&
    (requestedMarket !== null || preferences.preferences.lastMarketId !== null);
  const marketDataHasCachedContent =
    marketData.candles.data !== undefined ||
    marketData.book.data !== undefined ||
    marketData.trades.data !== undefined;
  const marketDataUnavailable =
    marketData.candles.isError ||
    marketData.book.isError ||
    marketData.trades.isError;
  const marketDataRefreshing =
    marketData.candles.isRefetching ||
    marketData.book.isRefetching ||
    marketData.trades.isRefetching;

  const switchMarket = (canonicalId: string) => {
    const next = resolveCanonicalMarketSwitch(
      catalog?.markets ?? [],
      canonicalId,
    );
    if (next === null) return;
    operationFence.current.invalidate();
    if (next.lifecycle === "active") preferences.selectMarket(next.canonicalId);
    router.setParams({ market: next.canonicalId });
  };

  const openReview = async (requestedDraft: TradeDraft) => {
    if (!market || !draftState.draft || !gate?.enabled) {
      throw new Error(
        gate?.reason ?? "A current market and draft are required.",
      );
    }
    const reviewDraft = {
      ...draftState.draft,
      side: requestedDraft.side,
    };
    if (
      tradeDraftValueKey(reviewDraft) !== tradeDraftValueKey(requestedDraft)
    ) {
      throw new Error("The order changed before review could start.");
    }
    const requestedReviewScope = `${authorityScope}:${tradeDraftValueKey(reviewDraft)}`;
    setDraftState({ draft: reviewDraft, invalidationMessage: null });
    reviewScopeRef.current = requestedReviewScope;
    Keyboard.dismiss();
    const capture = tradingContext.capture();
    const operation = operationFence.current.begin(
      market.canonicalId,
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
      market,
      context: current,
      capturedContextEpoch: capture.epoch,
      authority,
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
    actionRuntime.openReview(review);
    router.push("/action-review");
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-background"
    >
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
            onRefresh={() => {
              const detailRefreshes = market
                ? [
                    marketData.candles.refetch(),
                    marketData.book.refetch(),
                    marketData.trades.refetch(),
                    ...(accountTarget === null ? [] : [accountQuery.refetch()]),
                  ]
                : [];
              void Promise.all([catalogQuery.refetch(), ...detailRefreshes]);
            }}
            refreshing={
              catalogQuery.isRefetching ||
              marketDataRefreshing ||
              accountQuery.isRefetching
            }
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

        {invalidRestoredMarket ? (
          <Text
            accessibilityRole="alert"
            className="text-sm leading-5 text-warning"
          >
            The requested or last market is no longer in the catalog. Trade
            selected the highest-volume current market.
          </Text>
        ) : null}

        {market ? (
          <>
            <MarketSummary market={market} />
            {presentation.freshness === "stale" ||
            presentation.freshness === "offline" ||
            presentation.content !== "ready" ||
            presentation.hasPartialSources ? (
              <CatalogStatus
                onRetry={() => void catalogQuery.refetch()}
                state={presentation}
              />
            ) : null}
            {marketDataHasCachedContent &&
            (marketDataUnavailable ||
              presentation.freshness === "offline" ||
              presentation.freshness === "stale") ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-warning"
              >
                Some market data may be out of date. Pull to refresh.
              </Text>
            ) : marketDataRefreshing && marketDataHasCachedContent ? (
              <Text
                accessibilityLiveRegion="polite"
                className="text-sm leading-5 text-muted"
              >
                Updating market data…
              </Text>
            ) : null}
            <MarketCandlestickChart
              candles={marketData.candles.data}
              interval={candleInterval}
              loading={marketData.candles.isPending}
              market={market}
              onIntervalChange={setCandleInterval}
              compact
              realtime
              unavailable={
                marketData.candles.isError &&
                marketData.candles.data === undefined
              }
            />
            <View
              className={
                splitWorkspace ? "flex-row items-stretch gap-2" : "gap-3"
              }
            >
              {draftState.draft && gate ? (
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
                  onReview={openReview}
                  style={splitWorkspace ? { flex: 1.35 } : undefined}
                />
              ) : (
                <View
                  className="min-w-0"
                  style={splitWorkspace ? { flex: 1.35 } : undefined}
                >
                  <TradeLoading />
                </View>
              )}
              <MarketActivity
                book={marketData.book.data}
                bookLoading={marketData.book.isPending}
                bookUnavailable={
                  marketData.book.isError || marketData.book.isRefetchError
                }
                compact={splitWorkspace}
                style={splitWorkspace ? { flex: 1 } : undefined}
                trades={marketData.trades.data}
                tradesLoading={marketData.trades.isPending}
                tradesUnavailable={
                  marketData.trades.isError || marketData.trades.isRefetchError
                }
              />
            </View>
            {gate?.code === "read_only" || gate?.code === "expired_agent" ? (
              <SetupResumeCard />
            ) : null}
          </>
        ) : presentation.content === "loading" ||
          preferences.status === "loading" ? (
          <TradeLoading />
        ) : (
          <Card variant="secondary">
            <Card.Body className="gap-2">
              <Card.Title>No valid market selected</Card.Title>
              <Card.Description>
                {presentation.content === "unavailable"
                  ? "Markets could not be loaded. Pull to refresh."
                  : "No markets are available. Pull to refresh."}
              </Card.Description>
            </Card.Body>
          </Card>
        )}
      </ScrollView>
      <MarketSwitcher
        markets={catalog?.markets ?? []}
        onClose={() => setSwitcherOpen(false)}
        onSelect={switchMarket}
        selectedCanonicalId={market?.canonicalId ?? null}
        visible={switcherOpen}
      />
    </KeyboardAvoidingView>
  );
}

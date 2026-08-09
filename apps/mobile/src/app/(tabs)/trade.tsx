import type { Market } from "@hyper-trader/hyperliquid/public";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
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
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TextMarketChart } from "../../components/chart/text-market-chart";
import { MarketActivity } from "../../components/order-book/market-activity";
import { SetupResumeCard } from "../../components/setup-resume-card";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useDraftRegistry } from "../../core/actions/draft-provider";
import { useTradingContext } from "../../core/context/provider";
import { useSignerSession } from "../../core/session/provider";
import { GlobalAccountSwitcher } from "../../features/accounts/global-account-switcher";
import { useActionRuntime } from "../../features/actions/runtime-provider";
import { CatalogStatus } from "../../features/markets/catalog-status";
import {
  marketDisplayLabel,
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
import { useScopedTradingPreferences } from "../../features/settings/preferences-provider";
import { useTradeMarketData } from "../../features/trade/market-data";
import { OrderPanel } from "../../features/trade/order-panel";
import {
  buildTradeReview,
  cloidFromRandomBytes,
  createTradeDraft,
  createTradeOperationFence,
  evaluateTradeGate,
  reconcileTradeDraft,
  resolveCanonicalMarketSwitch,
  signerBindingForTradeContext,
  type TradeAuthority,
  type TradeConnectivity,
  type TradeDraft,
  type TradeSignerState,
  tradeDraftValueKey,
  tradeReviewScopeKey,
} from "../../features/trade/trade-model";
import { expoCryptographicRandomBytes } from "../../platform/security/agent-signer";

function shortAddress(address: string | null): string {
  return address === null
    ? "no account"
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function connectivityFromFreshness(
  freshness: "fresh" | "refreshing" | "stale" | "offline",
): TradeConnectivity {
  if (freshness === "offline") return "offline";
  if (freshness === "stale") return "stale";
  if (freshness === "refreshing") return "reconnecting";
  return "current";
}

function MarketSummary({ market }: { readonly market: Market }): JSX.Element {
  return (
    <Card variant="default" className="gap-4">
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-52 flex-1 gap-1">
          <Card.Title className="text-2xl">
            {marketDisplayLabel(market)}
          </Card.Title>
          <Card.Description>
            {marketVenueLabel(market)} · {market.canonicalId}
          </Card.Description>
        </View>
        <Chip
          accessibilityLabel={
            market.orderAvailability === "enabled" &&
            market.lifecycle === "active"
              ? "Order metadata is present; freshness and authority are checked separately"
              : "Browse-only market"
          }
          color={
            market.orderAvailability === "enabled" &&
            market.lifecycle === "active"
              ? "success"
              : "warning"
          }
          size="sm"
          variant="soft"
        >
          {market.orderAvailability === "enabled" &&
          market.lifecycle === "active"
            ? "Order metadata present"
            : market.lifecycle === "delisted"
              ? "Delisted · browse only"
              : "Browse only"}
        </Chip>
      </Card.Header>
      <Card.Body className="gap-4">
        <Text className="text-4xl font-semibold tabular-nums text-foreground">
          {formatMarketPrice(market)}
        </Text>
        <View className="flex-row flex-wrap gap-x-6 gap-y-3">
          <Stat
            label="24h change"
            value={formatPercent(marketPriceChangePercent(market))}
          />
          <Stat
            label="24h volume"
            value={formatCompactDecimal(market.dayNtlVlm)}
          />
          {market.family === "perp" ? (
            <>
              <Stat
                label="Funding"
                value={formatCompactDecimal(market.funding)}
              />
              <Stat
                label="Open interest"
                value={formatCompactDecimal(market.openInterest)}
              />
              <Stat
                label="Margin"
                value={
                  market.onlyIsolated
                    ? "Isolated only"
                    : (market.marginMode ?? "Cross or isolated")
                }
              />
            </>
          ) : market.family === "spot" ? (
            <Stat
              label="Pair"
              value={`${market.baseToken.name}/${market.quoteToken.name}`}
            />
          ) : (
            <Stat label="Outcome" value={market.sideName} />
          )}
        </View>
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
    <View className="min-w-32 flex-1 gap-1">
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
  const { catalog, catalogQuery, presentation } = useMarketCatalogPresentation(
    current.network,
  );
  const [layoutReady, setLayoutReady] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
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
    );
  }, [
    catalog?.markets,
    preferences.preferences.lastMarketId,
    preferences.status,
    requestedMarket,
  ]);
  const market = selection?.market ?? null;
  const marketData = useTradeMarketData(current.network, market);
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
      connectivity: connectivityFromFreshness(presentation.freshness),
      // The portfolio/account integration owns the authoritative account adapter.
      // Trade never fabricates funds,
      // leverage, target kind, or account-state versions while that seam is absent.
      account: null,
      signerState,
      actionRuntimeAvailable: actionRuntime.available,
    }),
    [actionRuntime.available, presentation.freshness, signerState],
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

  const openReview = async () => {
    if (!market || !draftState.draft || !gate?.enabled) {
      throw new Error(
        gate?.reason ?? "A current market and draft are required.",
      );
    }
    Keyboard.dismiss();
    const capture = tradingContext.capture();
    const operation = operationFence.current.begin(
      market.canonicalId,
      reviewScope,
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
      draft: draftState.draft,
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

  const unlockSession = async () => {
    const manager = signerSession.manager;
    if (
      manager === null ||
      current.network !== "testnet" ||
      current.masterAccount === null ||
      current.targetAccount === null ||
      current.signer === null
    )
      return;
    setSessionMessage("Unlocking this exact testnet account and target…");
    const capture = tradingContext.capture();
    try {
      await manager.unlock({
        binding: signerBindingForTradeContext(current),
        capturedContextEpoch: capture.epoch,
        isContextCurrent: () => tradingContext.canCommit(capture),
      });
      setSessionMessage(
        "Trading session unlocked. The draft was preserved and still requires fresh account data.",
      );
    } catch {
      setSessionMessage(
        "Unlock stopped safely. No order was reviewed, signed, or submitted.",
      );
    }
  };

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
                  ]
                : [];
              void Promise.all([catalogQuery.refetch(), ...detailRefreshes]);
            }}
            refreshing={catalogQuery.isRefetching || marketDataRefreshing}
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
              Trade
            </Text>
            <Chip
              accessibilityLabel={`${current.network} network, account ${shortAddress(current.targetAccount)}, session ${signerState}`}
              color={current.network === "testnet" ? "accent" : "warning"}
              size="sm"
              variant="soft"
            >
              {current.network} · {shortAddress(current.targetAccount)}
            </Chip>
          </View>
          <Text className="text-base leading-6 text-muted">
            Inspect, draft, and reach explicit review without leaving this
            market surface.
          </Text>
          <Text className="text-sm leading-5 text-muted">
            Session · {signerState.replaceAll("_", " ")} · target{" "}
            {shortAddress(current.targetAccount)}
          </Text>
        </View>

        <GlobalAccountSwitcher />

        <Button
          accessibilityHint="Opens the complete searchable catalog without changing account or network."
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          onPress={() => setSwitcherOpen(true)}
          variant="secondary"
        >
          {market
            ? `Switch market · ${marketDisplayLabel(market)} · ${marketVenueLabel(market)}`
            : "Choose a market"}
        </Button>

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
            <CatalogStatus
              onRetry={() => void catalogQuery.refetch()}
              sourceErrors={catalog?.sourceErrors ?? []}
              state={presentation}
            />
            {marketDataHasCachedContent &&
            (marketDataUnavailable ||
              presentation.freshness === "offline" ||
              presentation.freshness === "stale") ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-warning"
              >
                Cached chart or activity rows remain visible. Presentation-feed
                errors do not independently open or close review; the order
                panel reports the authoritative gate.
              </Text>
            ) : marketDataRefreshing && marketDataHasCachedContent ? (
              <Text
                accessibilityLiveRegion="polite"
                className="text-sm leading-5 text-muted"
              >
                Cached chart and activity remain visible while current rows
                refresh.
              </Text>
            ) : null}
            <TextMarketChart
              candles={marketData.candles.data}
              loading={marketData.candles.isPending}
              market={market}
              unavailable={
                marketData.candles.isError &&
                marketData.candles.data === undefined
              }
            />
            <MarketActivity
              book={marketData.book.data}
              bookLoading={marketData.book.isPending}
              bookUnavailable={
                marketData.book.isError || marketData.book.isRefetchError
              }
              trades={marketData.trades.data}
              tradesLoading={marketData.trades.isPending}
              tradesUnavailable={
                marketData.trades.isError || marketData.trades.isRefetchError
              }
            />
            {draftState.draft && gate ? (
              <OrderPanel
                authority={authority}
                draft={draftState.draft}
                gate={gate}
                invalidationMessage={draftState.invalidationMessage}
                key={`${draftState.draft.binding.contextKey}:${draftState.draft.binding.marketCanonicalId}:${draftState.draft.binding.metadataFingerprint}`}
                market={market}
                onDraftChange={(draft) =>
                  setDraftState({ draft, invalidationMessage: null })
                }
                onReview={openReview}
              />
            ) : (
              <TradeLoading />
            )}
            {gate?.code === "locked" ? (
              <Card variant="secondary" className="gap-3">
                <Card.Body className="gap-2">
                  <Card.Title>Unlock preserved draft</Card.Title>
                  <Card.Description>
                    Device authentication unlocks only this exact testnet
                    binding. It does not approve or submit the order.
                  </Card.Description>
                  {sessionMessage ? (
                    <Text
                      accessibilityLiveRegion="polite"
                      className="text-sm text-muted"
                    >
                      {sessionMessage}
                    </Text>
                  ) : null}
                </Card.Body>
                <Card.Footer>
                  <Button
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="min-h-12 w-full"
                    isDisabled={signerSession.manager === null}
                    onPress={() => void unlockSession()}
                    variant="secondary"
                  >
                    {signerSession.manager === null
                      ? "Unlock unavailable in this gated build"
                      : "Unlock trading session"}
                  </Button>
                </Card.Footer>
              </Card>
            ) : null}
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
                  ? "The catalog is unavailable and no trustworthy saved market can be restored."
                  : "The current catalog has no markets. Retry when current metadata is available."}
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

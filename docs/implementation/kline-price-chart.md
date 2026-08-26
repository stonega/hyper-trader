# Native K-line price chart

## Runtime

The Trade price chart uses
[`react-native-kline-chart`](https://github.com/xinKyy/react-native-kline-chart)
`0.1.1`. It renders directly through Shopify Skia and handles horizontal pan,
pinch zoom, and long-press crosshair gestures on the UI thread. There is no
WebView, bundled browser runtime, JavaScript bridge, or chart asset-copy config
plugin.

The package's required peers are already part of the Expo application:
`@shopify/react-native-skia`, React Native Gesture Handler, React Native
Reanimated, and React Native Worklets. The package adds
`react-native-haptic-feedback` for crosshair movement feedback. Expo prebuild
autolinks that native module, so a new native build is required after the
dependency change.

## Data boundary

`MarketKlinePriceChart` receives only candles already validated by the public
Hyperliquid package. `buildCandlestickChartModel` rejects invalid decimal or
OHLC geometry before the renderer receives data. Valid decimal strings are
converted to finite numbers only for disposable chart drawing data:

```ts
{
  time: candle.timestamp,
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
}
```

The exact decimal strings remain in the native OHLC and overlay rails used for
visible and assistive text. The chart is presentation-only and cannot submit,
edit, or cancel an order.

Each interval still owns an independent TanStack Query cache entry and live
Hyperliquid candle subscription. A validated series remains visible while a
new interval loads, but it is never retained across a canonical-market
boundary. The chart remounts when the displayed market or interval changes so
its internal viewport starts at the newest candles.

The library does not expose a request-more-history callback. The renderer uses
the validated window already owned by the app rather than making transport
requests of its own.

## Android surface lifecycle

The chart always paints its complete frame with the opaque HeroUI `surface`
color. A project-owned Bun patch exposes Skia's `opaque` canvas option through
`react-native-kline-chart`; Android therefore renders this chart through a
`SurfaceView` instead of the default `TextureView`, removing `SurfaceTexture`
from the chart's rendering path.

The Skia-backed `KlineChart` is also mounted only while both the Trade route and
the native application window are focused. Android `AppState` blur events
(including the notification shade), inactive/background transitions, and
navigation away from Trade unmount the renderer. Returning to the focused Trade
route mounts a fresh renderer with the retained validated candle series.

Only the native drawing surface is suspended. The fixed-height chart frame,
interval controls, exact OHLC summary, overlay labels, and retained candle model
stay mounted, so lifecycle transitions neither shift the layout nor discard
presentation data.

## Theme and layout

The chart measures its native container and passes exact pixel dimensions to
`KlineChart`. Its `backgroundColor` comes from the HeroUI Native `surface`
token, the same semantic color used by the surrounding card. Bullish, bearish,
grid, label, moving-average, and crosshair colors are also derived from HeroUI
semantic tokens and normalized to React Native RGBA colors before entering
Skia.

The compact Trade chart keeps the same 210-pixel drawing frame while candle
data is loading, unavailable, or ready. Its OHLC and price-overlay rails also
remain mounted, using placeholder values until validated candles arrive, so a
K-line response does not resize the card or move the controls below it.

The Skia surface is hidden from the accessibility tree because its drawn text
is not a reliable native accessibility surface. Native controls retain interval
selection, direction labels, an exact OHLC summary, and exact price-overlay
labels.

## Verification

Run from the repository root:

```sh
bun run check
bun run typecheck
bun test
```

Run a native build from `apps/mobile` after installing or updating the chart
package so the haptics dependency is linked into iOS and Android.

import {
  createPublicHyperliquidClient,
  type OpenWebSocketConnection,
  openPublicWebSocketSession,
  parseCandles,
} from "@hyper-trader/hyperliquid/public";

const coin = "BTC";
const interval = "15m" as const;
const controller = new AbortController();

const open: OpenWebSocketConnection = (url, { signal }) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let opened = false;
    const cleanupOpening = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    };
    const onAbort = () => {
      cleanupOpening();
      socket.close();
      if (!opened) {
        reject(new Error("The public WebSocket opening was canceled."));
      }
    };
    const onError = () => {
      cleanupOpening();
      reject(new Error("The public WebSocket could not be opened."));
    };
    const onOpen = () => {
      opened = true;
      cleanupOpening();
      signal?.addEventListener("abort", onAbort, { once: true });
      resolve({
        send: (data) => socket.send(data),
        close() {
          signal?.removeEventListener("abort", onAbort);
          socket.close();
        },
        addMessageListener(listener) {
          const onMessage = (event: MessageEvent) => listener(event.data);
          socket.addEventListener("message", onMessage);
          return () => socket.removeEventListener("message", onMessage);
        },
        addCloseListener(listener) {
          const onClose = () => listener();
          socket.addEventListener("close", onClose);
          return () => socket.removeEventListener("close", onClose);
        },
      });
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    if (signal?.aborted) onAbort();
  });

const client = createPublicHyperliquidClient({ network: "mainnet" });
const endTime = Date.now();
let candles = await client.getCandles({
  coin,
  interval,
  startTime: endTime - 24 * 60 * 60 * 1_000,
  endTime,
});
console.log(`Seeded ${candles.length} ${coin} candles from REST.`);

const session = await openPublicWebSocketSession({
  network: "mainnet",
  open,
  signal: controller.signal,
  onGap: () =>
    console.log("The stream disconnected; reload REST before resuming."),
});
const unsubscribe = session.subscribe(
  { type: "candle", coin, interval },
  ({ data }) => {
    const next = parseCandles([data], { coin, interval })[0];
    if (!next) return;
    const matching = candles.findIndex(
      ({ openTime }) => openTime === next.openTime,
    );
    candles =
      matching >= 0
        ? candles.map((candle, index) => (index === matching ? next : candle))
        : [...candles, next].slice(-97);
    console.log(
      `${coin} ${interval}: O=${next.open} H=${next.high} L=${next.low} C=${next.close}`,
    );
  },
);

setTimeout(() => {
  unsubscribe();
  session.close();
  controller.abort();
}, 60_000);

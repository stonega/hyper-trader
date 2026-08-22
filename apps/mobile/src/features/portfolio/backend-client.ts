import {
  type HyperliquidNetwork,
  type PublicPortfolioHistorySnapshot,
  type PublicPortfolioLiveSnapshot,
  parsePublicPortfolioHistorySnapshot,
  parsePublicPortfolioLiveSnapshot,
} from "@hyper-trader/hyperliquid/public";

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const ADDRESS = /^0x[0-9a-f]{40}$/;

export interface PortfolioBackendClient {
  readLive(
    network: HyperliquidNetwork,
    user: string,
    signal?: AbortSignal,
  ): Promise<PublicPortfolioLiveSnapshot>;
  readHistory(
    network: HyperliquidNetwork,
    user: string,
    signal?: AbortSignal,
  ): Promise<PublicPortfolioHistorySnapshot>;
}

export function createPortfolioBackendClient(options: {
  readonly origin: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}): PortfolioBackendClient {
  const origin = exactHttpsOrigin(options.origin);
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);

  const read = async (
    phase: "live" | "history",
    network: HyperliquidNetwork,
    user: string,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const normalizedUser = user.trim().toLowerCase();
    if (!ADDRESS.test(normalizedUser) || normalizedUser !== user) {
      throw new Error("Portfolio backend requires a lowercase account address");
    }
    const response = await withRequestDeadline(signal, timeoutMs, (deadline) =>
      fetchRequest(
        new Request(`${origin}/v1/portfolio-snapshots/${phase}`, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ network, user: normalizedUser }),
          redirect: "error",
          signal: deadline,
        }),
      ),
    );
    if (!response.ok) {
      throw new Error(`Portfolio backend returned ${response.status}`);
    }
    if (
      response.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
        "application/json" ||
      !response.headers.get("cache-control")?.includes("no-store")
    ) {
      throw new Error("Portfolio backend response is invalid");
    }
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength) ||
        Number(declaredLength) > MAX_RESPONSE_BYTES)
    ) {
      throw new Error("Portfolio backend response is too large");
    }
    return readBoundedJson(response);
  };

  return {
    async readLive(network, user, signal) {
      return parsePublicPortfolioLiveSnapshot(
        await read("live", network, user, signal),
        { network, user },
      );
    },
    async readHistory(network, user, signal) {
      return parsePublicPortfolioHistorySnapshot(
        await read("history", network, user, signal),
        { network, user },
      );
    },
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (response.body === null) {
    throw new Error("Portfolio backend response is invalid");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Portfolio backend response is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Portfolio backend response is invalid");
  }
}

async function withRequestDeadline<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw signal.reason;
  const controller = new AbortController();
  const abort = () =>
    controller.abort(signal?.reason ?? new Error("Portfolio request aborted"));
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Portfolio backend timed out")),
    timeoutMs,
  );
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function exactHttpsOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Portfolio backend must use an exact HTTPS origin");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Portfolio backend must use an exact HTTPS origin");
  }
  return value;
}

function timeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
    throw new Error("Portfolio backend timeout is invalid");
  }
  return value;
}

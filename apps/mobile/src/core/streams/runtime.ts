import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";

import {
  createForegroundStreamManager,
  type ManagedStreamBaseline,
  type ManagedStreamConnection,
  type ManagedStreamMessage,
} from "./manager";
import {
  type DeclarativeStreamWire,
  openNativeManagedConnection,
} from "./native-websocket";

export interface StreamDeclaration {
  readonly wire: DeclarativeStreamWire;
  loadBaseline(options: {
    readonly signal: AbortSignal;
    readonly generation: number;
  }): Promise<ManagedStreamBaseline>;
  applyBaseline(baseline: ManagedStreamBaseline): void;
  applyDelta(message: ManagedStreamMessage): void;
}

export interface StreamRuntime {
  declare(declaration: StreamDeclaration): () => void;
  setForeground(foreground: boolean): void;
  setOnline(online: boolean): void;
  setNetwork(network: HyperliquidNetwork): void;
  close(): void;
}

export function createStreamRuntime(
  options: {
    readonly initialNetwork?: HyperliquidNetwork;
    readonly openConnection?: (options: {
      readonly network: HyperliquidNetwork;
      readonly signal: AbortSignal;
    }) => Promise<ManagedStreamConnection>;
    readonly onError?: (error: unknown) => void;
    readonly setTimeout?: (callback: () => void, delay: number) => unknown;
    readonly clearTimeout?: (handle: unknown) => void;
  } = {},
): StreamRuntime {
  const declarations = new Map<string, StreamDeclaration>();
  let network = options.initialNetwork ?? "mainnet";
  let foreground = false;
  let online = false;
  const openConnection = options.openConnection ?? openNativeManagedConnection;
  const manager = createForegroundStreamManager({
    connect: ({ signal }) => openConnection({ network, signal }),
    loadBaseline: ({ key }, request) => {
      const declaration = declarations.get(key);
      if (!declaration) {
        throw new Error(`Stream declaration ${key} is no longer active.`);
      }
      return declaration.loadBaseline(request);
    },
    applyBaseline: (key, baseline) =>
      declarations.get(key)?.applyBaseline(baseline),
    applyDelta: (key, message) => declarations.get(key)?.applyDelta(message),
    onError: options.onError,
    setTimeout: options.setTimeout,
    clearTimeout: options.clearTimeout,
  });

  const synchronize = () => {
    manager.setSubscriptions(
      [...declarations.values()].map(({ wire }) => ({
        key: wire.key,
        wire,
      })),
    );
  };

  return {
    declare(declaration) {
      const key = declaration.wire.key;
      if (declarations.has(key)) {
        throw new Error(`Stream declaration ${key} already exists.`);
      }
      declarations.set(key, declaration);
      synchronize();
      return () => {
        if (declarations.get(key) === declaration) {
          declarations.delete(key);
          synchronize();
        }
      };
    },
    setForeground(next) {
      if (foreground === next) {
        return;
      }
      foreground = next;
      void manager.setEnvironment({ foreground, online });
    },
    setOnline(next) {
      if (online === next) {
        return;
      }
      online = next;
      void manager.setEnvironment({ foreground, online });
    },
    setNetwork(next) {
      if (network === next) {
        return;
      }
      network = next;
      synchronize();
    },
    close: () => manager.close(),
  };
}

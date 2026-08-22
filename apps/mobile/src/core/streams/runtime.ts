import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";

import { DEFAULT_HYPERLIQUID_NETWORK } from "../network";
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

function exclusiveAccountChannel(wire: DeclarativeStreamWire): {
  readonly type: "userEvents" | "orderUpdates";
  readonly user: string;
} | null {
  const subscription = wire.subscription;
  return subscription.type === "userEvents" ||
    subscription.type === "orderUpdates"
    ? { type: subscription.type, user: subscription.user }
    : null;
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
  const declarations = new Map<
    string,
    {
      readonly wire: DeclarativeStreamWire;
      readonly listeners: Set<StreamDeclaration>;
    }
  >();
  let network = options.initialNetwork ?? DEFAULT_HYPERLIQUID_NETWORK;
  let foreground = false;
  let online = false;
  const openConnection = options.openConnection ?? openNativeManagedConnection;
  const manager = createForegroundStreamManager({
    connect: ({ signal }) => openConnection({ network, signal }),
    loadBaseline: ({ key }, request) => {
      const entry = declarations.get(key);
      const declaration = entry?.listeners.values().next().value;
      if (!declaration) {
        throw new Error(`Stream declaration ${key} is no longer active.`);
      }
      return declaration.loadBaseline(request);
    },
    applyBaseline: (key, baseline) => {
      for (const declaration of declarations.get(key)?.listeners ?? []) {
        declaration.applyBaseline(baseline);
      }
    },
    applyDelta: (key, message) => {
      for (const declaration of declarations.get(key)?.listeners ?? []) {
        declaration.applyDelta(message);
      }
    },
    onError: options.onError,
    setTimeout: options.setTimeout,
    clearTimeout: options.clearTimeout,
  });

  let synchronizationScheduled = false;
  const synchronize = () => {
    if (synchronizationScheduled) return;
    synchronizationScheduled = true;
    queueMicrotask(() => {
      synchronizationScheduled = false;
      manager.setSubscriptions(
        [...declarations.values()].map(({ wire }) => ({
          key: wire.key,
          wire,
        })),
      );
    });
  };

  return {
    declare(declaration) {
      const key = declaration.wire.key;
      const existing = declarations.get(key);
      if (existing) {
        if (
          JSON.stringify(existing.wire.subscription) !==
          JSON.stringify(declaration.wire.subscription)
        ) {
          throw new Error(
            `Stream declaration ${key} conflicts with its active subscription.`,
          );
        }
        existing.listeners.add(declaration);
      } else {
        const exclusive = exclusiveAccountChannel(declaration.wire);
        if (
          exclusive &&
          [...declarations.values()].some((entry) => {
            const active = exclusiveAccountChannel(entry.wire);
            return (
              active?.type === exclusive.type && active.user !== exclusive.user
            );
          })
        ) {
          throw new Error(
            `Stream channel ${exclusive.type} cannot multiplex different accounts.`,
          );
        }
        declarations.set(key, {
          wire: declaration.wire,
          listeners: new Set([declaration]),
        });
        synchronize();
      }
      return () => {
        const current = declarations.get(key);
        if (!current?.listeners.delete(declaration)) return;
        if (current.listeners.size === 0) {
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

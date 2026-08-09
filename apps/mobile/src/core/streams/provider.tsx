import {
  createContext,
  type JSX,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
} from "react";

import { createStreamRuntime, type StreamRuntime } from "./runtime";

const StreamRuntimeContext = createContext<StreamRuntime | null>(null);

export function StreamRuntimeProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const runtime = useRef<StreamRuntime | null>(null);
  runtime.current ??= createStreamRuntime();
  useEffect(() => () => runtime.current?.close(), []);
  return (
    <StreamRuntimeContext.Provider value={runtime.current}>
      {children}
    </StreamRuntimeContext.Provider>
  );
}

export function useStreamRuntime(): StreamRuntime {
  const runtime = useContext(StreamRuntimeContext);
  if (!runtime) {
    throw new Error(
      "useStreamRuntime must be used inside StreamRuntimeProvider.",
    );
  }
  return runtime;
}

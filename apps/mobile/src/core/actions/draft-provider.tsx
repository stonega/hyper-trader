import {
  createContext,
  type JSX,
  type PropsWithChildren,
  useContext,
  useRef,
} from "react";

import {
  createDraftInvalidationRegistry,
  type DraftInvalidationRegistry,
} from "./draft-registry";

const DraftRegistryContext = createContext<DraftInvalidationRegistry | null>(
  null,
);

export function DraftRegistryProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const registry = useRef<DraftInvalidationRegistry | null>(null);
  registry.current ??= createDraftInvalidationRegistry();
  return (
    <DraftRegistryContext.Provider value={registry.current}>
      {children}
    </DraftRegistryContext.Provider>
  );
}

export function useDraftRegistry(): DraftInvalidationRegistry {
  const registry = useContext(DraftRegistryContext);
  if (!registry) {
    throw new Error(
      "useDraftRegistry must be used inside DraftRegistryProvider.",
    );
  }
  return registry;
}

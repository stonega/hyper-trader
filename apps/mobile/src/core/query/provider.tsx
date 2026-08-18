import AsyncStorage from "@react-native-async-storage/async-storage";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import type { JSX, PropsWithChildren } from "react";

import { warmResumeMarkers } from "../performance/warm-resume";
import { createSafePublicCachePersister } from "../storage/public-cache";
import { createMobileQueryClient } from "./client";
import {
  createPublicCacheDehydrateOptions,
  PUBLIC_CACHE_BUSTER,
  PUBLIC_CACHE_MAX_AGE_MS,
} from "./persistence";

const mobileQueryClient = createMobileQueryClient();
const publicCachePersister = createSafePublicCachePersister(AsyncStorage);

export function MobileQueryProvider({
  children,
}: PropsWithChildren): JSX.Element {
  return (
    <PersistQueryClientProvider
      client={mobileQueryClient}
      onError={async () => {
        await publicCachePersister.removeClient();
        warmResumeMarkers.markPublicCacheReady();
      }}
      onSuccess={() => warmResumeMarkers.markPublicCacheReady()}
      persistOptions={{
        buster: PUBLIC_CACHE_BUSTER,
        dehydrateOptions: createPublicCacheDehydrateOptions(),
        maxAge: PUBLIC_CACHE_MAX_AGE_MS,
        persister: publicCachePersister,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}

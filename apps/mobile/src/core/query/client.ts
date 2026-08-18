import { QueryClient } from "@tanstack/react-query";

import { PUBLIC_CACHE_GC_TIME_MS } from "./persistence";

export function createMobileQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        gcTime: PUBLIC_CACHE_GC_TIME_MS,
        retry: 2,
        staleTime: 10_000,
      },
    },
  });
}

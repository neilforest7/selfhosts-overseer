"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  // Create QueryClient using the standard React Query SSR pattern
  // This ensures each request has its own cache and prevents data leakage
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, set staleTime above 0 to avoid immediate refetching on client
        staleTime: 60 * 1000, // 60 seconds
        // Reduce background refetch frequency to prevent race conditions
        refetchOnWindowFocus: false,
        // Smart retry logic - avoid retrying on specific errors
        retry: (failureCount, error: any) => {
          if (error?.message?.includes('Cannot read properties') ||
              error?.message?.includes('undefined') ||
              error?.message?.includes('call')) {
            return false;
          }
          return failureCount < 2;
        },
        // Set reasonable cache time
        gcTime: 10 * 60 * 1000, // 10 minutes
      },
    },
  }));

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}



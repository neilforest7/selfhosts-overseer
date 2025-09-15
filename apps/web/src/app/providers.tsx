"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reduce background refetch frequency to prevent race conditions
      refetchOnWindowFocus: false,
      // Add retry configuration
      retry: 1,
      // Set reasonable stale time
      staleTime: 5000, // 5 seconds
      // Set cache time
      gcTime: 10 * 60 * 1000, // 10 minutes
    },
  },
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
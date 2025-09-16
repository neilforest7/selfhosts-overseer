'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { apiClient } from '@/src/lib/api-client';

export type HostStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export interface HostConnectivityData {
  hostId: string;
  hostName: string;
  status: HostStatus;
  responseTime?: number;
  lastChecked?: string;
  lastOnline?: string;
  lastOffline?: string;
  errorMessage?: string;
}

export interface ConnectivityEvent {
  hostId: string;
  hostName: string;
  previousStatus: HostStatus;
  currentStatus: HostStatus;
  responseTime?: number;
  errorMessage?: string;
  timestamp: string;
}

export interface ConnectivityStats {
  total: number;
  online: number;
  offline: number;
  unknown: number;
  averageResponseTime: number;
}

interface UseHostConnectivityOptions {
  hostId?: string;
  autoConnect?: boolean;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

export function useHostConnectivity(options: UseHostConnectivityOptions = {}) {
  const {
    hostId,
    autoConnect = true,
    reconnectAttempts = 5,
    reconnectDelay = 3000,
  } = options;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectivityData, setConnectivityData] = useState<Map<string, HostConnectivityData>>(new Map());
  
  const queryClient = useQueryClient();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);

  // Fetch connectivity stats
  const { data: stats, refetch: refetchStats } = useQuery<ConnectivityStats>({
    queryKey: ['connectivity', 'stats'],
    queryFn: async () => {
      const response = await apiClient.get('/api/v1/hosts/connectivity/stats');
      if (!response.success) throw new Error('Failed to fetch connectivity stats');
      return response.data as ConnectivityStats;
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Fetch connectivity history for a specific host
  const { data: hostHistory, refetch: refetchHostHistory } = useQuery({
    queryKey: ['connectivity', 'history', hostId],
    queryFn: async () => {
      if (!hostId) return null;
      const response = await apiClient.get(`/api/v1/hosts/${hostId}/connectivity?limit=50`);
      if (!response.success) throw new Error('Failed to fetch host connectivity history');
      return response.data as any[];
    },
    enabled: !!hostId,
    refetchInterval: 60000, // Refetch every minute
  });

  // Fetch initial connectivity data for all hosts
  const { data: initialHosts } = useQuery({
    queryKey: ['hosts', 'all', 'connectivity'],
    queryFn: async () => {
      const response = await apiClient.get('/api/v1/hosts?limit=1000'); // Fetch a large number of hosts
      if (!response.success) throw new Error('Failed to fetch hosts for connectivity');
      return (response.data as any)?.items as any[];
    },
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (initialHosts) {
      console.log('Received hosts for connectivity status:', initialHosts);
      setConnectivityData(prev => {
        const updated = new Map(prev);
        initialHosts.forEach((host: any) => {
          // Only update if not already present from a websocket event
          if (!updated.has(host.id)) {
            const newEntry = {
              hostId: host.id,
              hostName: host.name,
              status: host.status || 'UNKNOWN',
              lastChecked: host.lastConnectivityCheck,
              // We don't get these from the initial fetch, so keep them undefined
              responseTime: undefined,
              lastOnline: undefined,
              lastOffline: undefined,
              errorMessage: undefined,
            };
            updated.set(host.id, newEntry);
          }
        });
        console.log('Updated connectivity data map:', updated);
        return updated;
      });
    }
  }, [initialHosts]);

  // Initialize WebSocket connection
  const connectSocket = useCallback(() => {
    if (socket?.connected) return;

    const newSocket = io(process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : undefined, {
      transports: ['websocket'],
      upgrade: false,
      reconnection: false, // Handle reconnection manually
    });

    newSocket.on('connect', () => {
      console.log('Connected to connectivity WebSocket');
      setIsConnected(true);
      setConnectionError(null);
      reconnectAttemptsRef.current = 0;

      // Join connectivity room
      const room = hostId ? { hostId } : {};
      newSocket.emit('joinConnectivity', room);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Disconnected from connectivity WebSocket:', reason);
      setIsConnected(false);
      
      // Attempt to reconnect if not manually disconnected
      if (reason !== 'io client disconnect' && reconnectAttemptsRef.current < reconnectAttempts) {
        reconnectAttemptsRef.current++;
        setConnectionError(`Connection lost. Reconnecting... (${reconnectAttemptsRef.current}/${reconnectAttempts})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connectSocket();
        }, reconnectDelay);
      } else if (reconnectAttemptsRef.current >= reconnectAttempts) {
        setConnectionError('Failed to reconnect. Please refresh the page.');
      }
    });

    newSocket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      setConnectionError(`Connection error: ${error.message}`);
      setIsConnected(false);
    });

    // Listen for connectivity status changes
    newSocket.on('connectivity.status.changed', (event: ConnectivityEvent) => {
      console.log('Host status changed:', event);
      
      setConnectivityData(prev => {
        const updated = new Map(prev);
        updated.set(event.hostId, {
          hostId: event.hostId,
          hostName: event.hostName,
          status: event.currentStatus,
          responseTime: event.responseTime,
          lastChecked: event.timestamp,
          lastOnline: event.currentStatus === 'ONLINE' ? event.timestamp : prev.get(event.hostId)?.lastOnline,
          lastOffline: event.currentStatus === 'OFFLINE' ? event.timestamp : prev.get(event.hostId)?.lastOffline,
          errorMessage: event.errorMessage,
        });
        return updated;
      });

      // Invalidate and refetch related queries
      if (queryClient) {
        queryClient.invalidateQueries({ queryKey: ['connectivity', 'stats'] });
        if (hostId === event.hostId) {
          queryClient.invalidateQueries({ queryKey: ['connectivity', 'history', hostId] });
        }
      }
    });

    // Listen for host online events
    newSocket.on('connectivity.host.online', (event: ConnectivityEvent) => {
      console.log('Host came online:', event);
      // Handle specific online event if needed
    });

    // Listen for host offline events
    newSocket.on('connectivity.host.offline', (event: ConnectivityEvent) => {
      console.log('Host went offline:', event);
      // Handle specific offline event if needed
    });

    setSocket(newSocket);
  }, [hostId, reconnectAttempts, reconnectDelay]);

  // Disconnect WebSocket
  const disconnectSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (socket) {
      const room = hostId ? { hostId } : {};
      socket.emit('leaveConnectivity', room);
      socket.disconnect();
      setSocket(null);
    }
    
    setIsConnected(false);
    setConnectionError(null);
  }, []); // Remove dependencies to prevent infinite loops

  // Manual connectivity check
  const checkConnectivity = useCallback(async (targetHostId?: string) => {
    try {
      const id = targetHostId || hostId;
      if (!id) {
        // Check all hosts
        const response = await apiClient.post('/api/v1/hosts/check-all-connectivity');
        if (!response.success) throw new Error('Failed to check connectivity for all hosts');
        const results = response.data as any[];
        
        // Update local state with results
        setConnectivityData(prev => {
          const updated = new Map(prev);
          results.forEach((result: any) => {
            updated.set(result.hostId, {
              hostId: result.hostId,
              hostName: result.hostName || result.hostId,
              status: result.status,
              responseTime: result.responseTime,
              lastChecked: result.checkedAt,
              errorMessage: result.errorMessage,
            });
          });
          return updated;
        });
        
        refetchStats();
        return results;
      } else {
        // Check specific host
        const response = await apiClient.post(`/api/v1/hosts/${id}/check-connectivity`);
        if (!response.success) throw new Error('Failed to check host connectivity');
        const result = response.data as any;
        
        // Update local state
        setConnectivityData(prev => {
          const updated = new Map(prev);
          updated.set(result.hostId, {
            hostId: result.hostId,
            hostName: result.hostName || result.hostId,
            status: result.status,
            responseTime: result.responseTime,
            lastChecked: result.checkedAt,
            errorMessage: result.errorMessage,
          });
          return updated;
        });
        
        refetchStats();
        if (hostId === id) {
          refetchHostHistory();
        }
        
        return result;
      }
    } catch (error) {
      console.error('Failed to check connectivity:', error);
      throw error;
    }
  }, [hostId, refetchStats, refetchHostHistory]);

  // Initialize connection on mount
  useEffect(() => {
    if (autoConnect) {
      connectSocket();
    }

    return () => {
      disconnectSocket();
    };
  }, [autoConnect]); // Remove connectSocket and disconnectSocket from dependencies

  // Get connectivity data for a specific host
  const getHostConnectivity = useCallback((targetHostId: string): HostConnectivityData | undefined => {
    return connectivityData.get(targetHostId);
  }, [connectivityData]);

  // Get all connectivity data
  const getAllConnectivityData = useCallback((): HostConnectivityData[] => {
    return Array.from(connectivityData.values());
  }, [connectivityData]);

  return {
    // Connection state
    isConnected,
    connectionError,
    
    // Data
    stats,
    hostHistory,
    connectivityData: getAllConnectivityData(),
    
    // Actions
    connect: connectSocket,
    disconnect: disconnectSocket,
    checkConnectivity,
    getHostConnectivity,
    
    // Utilities
    refetchStats,
    refetchHostHistory,
  };
}

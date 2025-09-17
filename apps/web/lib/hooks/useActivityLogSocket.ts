"use client";

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ActivityLog } from '../types';

interface UseActivityLogSocketOptions {
  hostId?: string;
  onNewActivity?: (activity: ActivityLog) => void;
  onHistoryReceived?: (activities: ActivityLog[]) => void;
}

export function useActivityLogSocket({
  hostId,
  onNewActivity,
  onHistoryReceived,
}: UseActivityLogSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Initialize socket connection
    const socket = io(process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001', {
      transports: ['websocket'],
      upgrade: false,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      
      // Join the activity log room
      socket.emit('joinActivityLog', { hostId });
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    // Listen for activity history
    socket.on('activity.history', (data: { activities: ActivityLog[] }) => {
      setActivities(data.activities);
      onHistoryReceived?.(data.activities);
    });

    // Listen for new activities
    socket.on('activity.new', (activity: ActivityLog) => {
      setActivities(prev => [activity, ...prev.slice(0, 49)]); // Keep only latest 50
      onNewActivity?.(activity);
    });

    return () => {
      // Leave the activity log room
      socket.emit('leaveActivityLog', { hostId });
      socket.disconnect();
    };
  }, [hostId, onNewActivity, onHistoryReceived]);

  const reconnect = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current.connect();
    }
  };

  return {
    isConnected,
    activities,
    reconnect,
  };
}

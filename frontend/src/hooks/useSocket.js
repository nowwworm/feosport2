import { useEffect } from 'react';
import { useSocket } from '../context/SocketContext';

/**
 * Subscribe to a socket.io event; automatically unsubscribes on unmount
 * or when dependencies change.
 */
export function useSocketEvent(event, handler) {
  const socket = useSocket();
  useEffect(() => {
    if (!socket || !event) return;
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, [socket, event, handler]);
}

import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function initSocket() {
  const token = localStorage.getItem('access_token') || undefined;
  if (socket) {
    const existingToken = (socket.auth as any)?.token;
    if (existingToken !== token) {
      socket.auth = { token } as any;
      socket.io.opts.query = { token } as any;
      if (socket.connected) socket.disconnect();
      socket.connect();
    }
    return socket;
  }
  // connect to same origin; Vite's proxy / dev server will forward /socket
  socket = io(window.location.origin, {
    path: '/socket',
    auth: { token },
    query: { token },
    transports: ['websocket', 'polling'],
    autoConnect: true
  });

  socket.on('connect_error', (err) => console.warn('socket connect error', err));
  socket.on('connect', () => console.log('socket connected', socket?.id));
  socket.on('disconnect', (reason) => console.log('socket disconnected', reason));

  // Debug: log any event received. Helpful when only transport-level pings are observed.
  socket.onAny((event, ...args) => {
    // hide verbose internal engine events if desired
    if (event && String(event).startsWith('message.')) {
      console.log('socket event', event, args);
    } else {
      // you can uncomment below to log all events
      // console.debug('socket event (other)', event, args);
    }
  });

  return socket;
}

export function getSocket() {
  return socket || initSocket();
}

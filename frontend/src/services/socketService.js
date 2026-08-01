import { io } from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.currentRoom = null;
    this.listeners = new Map();
  }

  getSocketUrl() {
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    return backendUrl.replace(/\/api\/?$/, '');
  }

  connect() {
    if (this.socket && this.socket.connected) {
      return this.socket;
    }

    const socketUrl = this.getSocketUrl();
    this.socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    this.socket.on('connect', () => {
      console.log('⚡ Socket connected:', this.socket.id);
      if (this.currentRoom) {
        this.joinRoom(this.currentRoom.roomId, this.currentRoom.user);
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('⚡ Socket disconnected:', reason);
    });

    this.socket.on('reconnect_attempt', (attempt) => {
      console.log(`⚡ Socket reconnecting (attempt ${attempt})...`);
    });

    return this.socket;
  }

  joinRoom(roomId, user = {}) {
    this.connect();
    this.currentRoom = { roomId, user };
    this.socket.emit('join-room', { roomId, ...user });
  }

  leaveRoom() {
    if (this.socket && this.currentRoom) {
      this.socket.emit('leave-room');
      this.currentRoom = null;
    }
  }

  sendOffer(targetSocketId, offer, senderInfo) {
    if (this.socket) {
      this.socket.emit('webrtc-offer', { targetSocketId, offer, senderInfo });
    }
  }

  sendAnswer(targetSocketId, answer) {
    if (this.socket) {
      this.socket.emit('webrtc-answer', { targetSocketId, answer });
    }
  }

  sendIceCandidate(targetSocketId, candidate) {
    if (this.socket) {
      this.socket.emit('ice-candidate', { targetSocketId, candidate });
    }
  }

  notifyScreenShare(roomId, isSharing, streamMetaData) {
    if (this.socket) {
      this.socket.emit('screen-share-status', { roomId, isSharing, streamMetaData });
    }
  }

  on(event, callback) {
    this.connect();
    this.socket.on(event, callback);
  }

  off(event, callback) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const socketService = new SocketService();
export default socketService;

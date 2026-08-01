const roomParticipants = new Map();

export const setupSocketHandler = (io) => {
  io.on('connection', (socket) => {
    let currentRoomId = null;
    let currentUser = null;

    socket.on('join-room', ({ roomId, userId, userName }) => {
      if (!roomId) return;

      currentRoomId = roomId;
      currentUser = { userId: userId || socket.id, userName: userName || 'Guest', socketId: socket.id };

      socket.join(roomId);

      if (!roomParticipants.has(roomId)) {
        roomParticipants.set(roomId, new Map());
      }
      
      const participants = roomParticipants.get(roomId);
      participants.set(socket.id, currentUser);

      const existingPeers = Array.from(participants.values()).filter(p => p.socketId !== socket.id);

      socket.emit('room-peers', {
        roomId,
        peers: existingPeers,
        yourSocketId: socket.id
      });

      socket.to(roomId).emit('user-joined', {
        socketId: socket.id,
        user: currentUser
      });

      console.log(`[Socket] Client ${socket.id} (${currentUser.userName}) joined room: ${roomId}`);
    });

    socket.on('webrtc-offer', ({ targetSocketId, offer, senderInfo }) => {
      io.to(targetSocketId).emit('webrtc-offer', {
        senderSocketId: socket.id,
        offer,
        senderInfo
      });
    });

    socket.on('webrtc-answer', ({ targetSocketId, answer }) => {
      io.to(targetSocketId).emit('webrtc-answer', {
        senderSocketId: socket.id,
        answer
      });
    });

    socket.on('ice-candidate', ({ targetSocketId, candidate }) => {
      io.to(targetSocketId).emit('ice-candidate', {
        senderSocketId: socket.id,
        candidate
      });
    });

    socket.on('screen-share-status', ({ roomId, isSharing, streamMetaData }) => {
      if (roomId) {
        socket.to(roomId).emit('screen-share-status', {
          socketId: socket.id,
          isSharing,
          streamMetaData
        });
      }
    });

    socket.on('adjust-bitrate', ({ targetSocketId, targetBitrate }) => {
      io.to(targetSocketId).emit('adjust-bitrate', {
        senderSocketId: socket.id,
        targetBitrate
      });
    });

    socket.on('leave-room', () => {
      handleUserLeave(socket, io, currentRoomId);
      currentRoomId = null;
    });

    socket.on('disconnect', () => {
      handleUserLeave(socket, io, currentRoomId);
    });
  });
};

function handleUserLeave(socket, io, roomId) {
  if (!roomId) return;

  socket.leave(roomId);

  if (roomParticipants.has(roomId)) {
    const participants = roomParticipants.get(roomId);
    participants.delete(socket.id);

    if (participants.size === 0) {
      roomParticipants.delete(roomId);
    } else {
      socket.to(roomId).emit('user-left', {
        socketId: socket.id
      });
    }
  }

  console.log(`[Socket] Client ${socket.id} left room: ${roomId}`);
}

export const getActiveConnectionsCount = (io) => {
  return io?.engine?.clientsCount || 0;
};

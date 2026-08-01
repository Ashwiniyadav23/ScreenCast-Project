// WebRTC Peer Connection & Stream Optimization Manager

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

export class WebRTCManager {
  constructor(socketService) {
    this.socketService = socketService;
    this.peerConnections = new Map(); // socketId -> RTCPeerConnection
    this.iceCandidateQueues = new Map(); // socketId -> array of candidates
    this.localStream = null;
  }

  setLocalStream(stream) {
    this.localStream = stream;
  }

  async createPeerConnection(targetSocketId, isInitiator = false, onRemoteStream = null) {
    if (this.peerConnections.has(targetSocketId)) {
      return this.peerConnections.get(targetSocketId);
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.peerConnections.set(targetSocketId, pc);
    this.iceCandidateQueues.set(targetSocketId, []);

    // Add local tracks if available
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, this.localStream);
        
        // Apply encoding bitrate constraints for smooth screen sharing (max 2.5 Mbps)
        if (track.kind === 'video') {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = 2500000; // 2.5 Mbps
          params.encodings[0].maxFramerate = 30;
          sender.setParameters(params).catch(console.warn);
        }
      });
    }

    // ICE Candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socketService.sendIceCandidate(targetSocketId, event.candidate);
      }
    };

    // Remote track handler
    pc.ontrack = (event) => {
      if (onRemoteStream && event.streams[0]) {
        onRemoteStream(targetSocketId, event.streams[0]);
      }
    };

    // Connection state monitoring for freeze auto-recovery
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${targetSocketId} connectionState: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        this.restartIce(targetSocketId);
      }
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveVideo: true,
          offerToReceiveAudio: true
        });
        await pc.setLocalDescription(offer);
        this.socketService.sendOffer(targetSocketId, offer);
      } catch (err) {
        console.error('Error creating WebRTC offer:', err);
      }
    }

    return pc;
  }

  async handleOffer(senderSocketId, offer, onRemoteStream) {
    const pc = await this.createPeerConnection(senderSocketId, false, onRemoteStream);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    // Flush queued ICE candidates
    const queuedCandidates = this.iceCandidateQueues.get(senderSocketId) || [];
    while (queuedCandidates.length > 0) {
      const candidate = queuedCandidates.shift();
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socketService.sendAnswer(senderSocketId, answer);
  }

  async handleAnswer(senderSocketId, answer) {
    const pc = this.peerConnections.get(senderSocketId);
    if (pc && pc.signalingState !== 'stable') {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      const queuedCandidates = this.iceCandidateQueues.get(senderSocketId) || [];
      while (queuedCandidates.length > 0) {
        const candidate = queuedCandidates.shift();
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
      }
    }
  }

  async handleIceCandidate(senderSocketId, candidate) {
    const pc = this.peerConnections.get(senderSocketId);
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn);
    } else {
      const queue = this.iceCandidateQueues.get(senderSocketId) || [];
      queue.push(candidate);
      this.iceCandidateQueues.set(senderSocketId, queue);
    }
  }

  async restartIce(targetSocketId) {
    const pc = this.peerConnections.get(targetSocketId);
    if (pc) {
      try {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        this.socketService.sendOffer(targetSocketId, offer);
      } catch (err) {
        console.error('ICE restart failed:', err);
      }
    }
  }

  closePeerConnection(targetSocketId) {
    const pc = this.peerConnections.get(targetSocketId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(targetSocketId);
      this.iceCandidateQueues.delete(targetSocketId);
    }
  }

  cleanup() {
    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();
    this.iceCandidateQueues.clear();
    this.localStream = null;
  }
}

export default WebRTCManager;

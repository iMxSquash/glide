const { contextBridge, ipcRenderer } = require("electron");

// Pont IPC exposé au renderer (contextIsolation: true, nodeIntegration:
// false) : le renderer ne touche jamais ipcRenderer directement.
contextBridge.exposeInMainWorld("glideWebRTC", {
  onStartAsHost: (callback) => ipcRenderer.on("webrtc:start-as-host", callback),
  onRemoteAnswer: (callback) =>
    ipcRenderer.on("webrtc:remote-answer", (_event, payload) => callback(payload)),
  onRemoteIceCandidate: (callback) =>
    ipcRenderer.on("webrtc:remote-ice-candidate", (_event, payload) => callback(payload)),
  onClosePeer: (callback) => ipcRenderer.on("webrtc:close-peer", callback),
  onSendControlMessage: (callback) =>
    ipcRenderer.on("webrtc:send-control-message", (_event, payload) => callback(payload)),

  sendLocalOffer: (sdp) => ipcRenderer.send("webrtc:local-offer", { sdp }),
  sendLocalIceCandidate: (candidate) =>
    ipcRenderer.send("webrtc:local-ice-candidate", { candidate }),
  sendDataChannelMessage: (channel, message) =>
    ipcRenderer.send("webrtc:datachannel-message", { channel, message }),
  sendDataChannelOpen: (channel) => ipcRenderer.send("webrtc:datachannel-open", { channel }),
  sendDataChannelClosed: (channel) => ipcRenderer.send("webrtc:datachannel-closed", { channel }),
  sendPeerConnectionFailed: () => ipcRenderer.send("webrtc:peer-connection-failed"),
});

// Tourne dans la fenêtre Electron cachée (Chromium), pas dans le main process
// Node : c'est ici, et seulement ici, que l'API WebRTC du navigateur existe.

let pc = null;
let controlChannel = null;
let inputChannel = null;

function closePeer() {
  if (inputChannel) {
    inputChannel.close();
    inputChannel = null;
  }
  if (controlChannel) {
    controlChannel.close();
    controlChannel = null;
  }
  if (pc) {
    pc.close();
    pc = null;
  }
}

function setupDataChannel(channel, label) {
  channel.onopen = () => window.glideWebRTC.sendDataChannelOpen(label);
  channel.onclose = () => window.glideWebRTC.sendDataChannelClosed(label);
  channel.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      window.glideWebRTC.sendDataChannelMessage(label, message);
    } catch (err) {
      console.error("Invalid DataChannel message on", label, err);
    }
  };
}

async function startAsHost() {
  closePeer();

  // Pas de STUN/TURN : PC et téléphone sont sur le même LAN, les host
  // candidates suffisent (voir TODO.md, hors-LAN est un besoin v2).
  pc = new RTCPeerConnection({ iceServers: [] });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      window.glideWebRTC.sendLocalIceCandidate(event.candidate.toJSON());
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc && (pc.connectionState === "failed" || pc.connectionState === "closed")) {
      window.glideWebRTC.sendPeerConnectionFailed();
    }
  };

  // Une frame mouseDelta/scroll perdue est de toute façon remplacée par la
  // suivante : pas de retransmission, pas d'ordre à préserver.
  inputChannel = pc.createDataChannel("input", { ordered: false, maxRetransmits: 0 });
  setupDataChannel(inputChannel, "input");

  // Clics, clavier, volume, auth : canal fiable par défaut (ordered, retransmit).
  controlChannel = pc.createDataChannel("control");
  setupDataChannel(controlChannel, "control");

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  window.glideWebRTC.sendLocalOffer(pc.localDescription.toJSON());
}

window.glideWebRTC.onStartAsHost(() => {
  startAsHost().catch((err) => console.error("Failed to start WebRTC host", err));
});

window.glideWebRTC.onRemoteAnswer(async ({ sdp }) => {
  if (!pc) return;
  try {
    await pc.setRemoteDescription(sdp);
  } catch (err) {
    console.error("Failed to set remote answer", err);
  }
});

window.glideWebRTC.onRemoteIceCandidate(async ({ candidate }) => {
  if (!pc) return;
  try {
    await pc.addIceCandidate(candidate);
  } catch (err) {
    console.error("Failed to add remote ICE candidate", err);
  }
});

window.glideWebRTC.onClosePeer(() => closePeer());

window.glideWebRTC.onSendControlMessage((message) => {
  if (controlChannel && controlChannel.readyState === "open") {
    controlChannel.send(JSON.stringify(message));
  }
});

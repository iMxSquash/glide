import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("glide", {
  send: (channel: string, data: any) => {
    const validChannels = [
      "mouseDelta",
      "leftClick",
      "rightClick",
      "volumeUp",
      "volumeDown",
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
});

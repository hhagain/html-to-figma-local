const { contextBridge, ipcRenderer } = require('electron');
// The main process checks the frame URL and pending pairing ID again.
if (process.isMainFrame) contextBridge.exposeInMainWorld('h2fAssistant', Object.freeze({
  send: message => {
    if (!message || typeof message.action !== 'string') return;
    ipcRenderer.send('h2f:assistant', { action: message.action, ...(typeof message.id === 'string' ? { id: message.id } : {}) });
  },
}));

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  alert: () => ipcRenderer.send('alert-message', 'Hello from preload'),
});
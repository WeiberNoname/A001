const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lab', {
  onPorts: cb => ipcRenderer.on('serial-ports', (_e, list) => cb(list)),
  choosePort: portId => ipcRenderer.send('serial-choose', portId),
  saveCsv: (name, content) => ipcRenderer.invoke('save-csv', { name, content }),
  loadBatches: () => ipcRenderer.invoke('batches-load'),
  saveBatches: batches => ipcRenderer.invoke('batches-save', batches)
});

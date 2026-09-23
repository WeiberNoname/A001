const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let win;
let pendingPortCallback = null;

const batchesFile = () => path.join(app.getPath('userData'), 'batches.json');

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 420,
    minHeight: 500,
    title: 'Vacuum Burst Lab',
    backgroundColor: '#EEF0EE',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  // Open external links in the user's browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Web Serial: let the page show its own port chooser.
  const ses = win.webContents.session;
  ses.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();
    pendingPortCallback = callback;
    win.webContents.send('serial-ports', portList.map(p => ({
      portId: p.portId,
      name: p.displayName || p.portName,
      portName: p.portName
    })));
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial');
  ses.setDevicePermissionHandler(details => details.deviceType === 'serial');
}

ipcMain.on('serial-choose', (_e, portId) => {
  if (pendingPortCallback) {
    pendingPortCallback(portId || '');
    pendingPortCallback = null;
  }
});

ipcMain.handle('save-csv', async (_e, { name, content }) => {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: name,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, content, 'utf8');
  return result.filePath;
});

ipcMain.handle('batches-load', () => {
  try {
    return JSON.parse(fs.readFileSync(batchesFile(), 'utf8'));
  } catch {
    return [];
  }
});

ipcMain.handle('batches-save', (_e, batches) => {
  fs.writeFileSync(batchesFile(), JSON.stringify(batches, null, 2), 'utf8');
  return true;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const electronReload = require('electron-reload');
const path = require('path');
const logger = require('./logger');

let liveReloadEnabled = false;
if (process.argv.includes('--live-reload')) {
  console.log('Live-reload enabled');
  liveReloadEnabled = true;
}

if (process.argv.includes('--port')) {
  port = parseInt(process.argv[process.argv.indexOf('--port') + 1]);
}

if (liveReloadEnabled) {
  electronReload([path.join(__dirname, 'src'), path.join(__dirname, 'index.html'), path.join(__dirname, 'styles.css')], {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron')
  });
}

let win;
let menu;
let userDataPath;
let configPath;
let dataPath;

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'renderer.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: true,
    },
  });
  winURL = `file://${path.join(__dirname, 'index.html')}`;
  win.loadURL(winURL);

  // Create the menu
  menu = createMenu();
  Menu.setApplicationMenu(menu);

  win.on('closed', () => {
    win = null;
  });
}

// Create the menu
function createMenu() {
  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Import',
          accelerator: 'CmdOrCtrl+I',  // Shortcut for import
          click: () => {
            // Send an IPC message to renderer to trigger import
            // TODO: Remove pointless 2-way communication on init.. We can import in main and then send the file path from here.
            win.webContents.send('import-file');
          },
        },
        {
          label: 'Export',
          accelerator: 'CmdOrCtrl+E',  // Shortcut for export
          click: () => {
            // Send an IPC message to renderer to trigger export
            win.webContents.send('export-file');
          },
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Edit Flashcard',
          accelerator: 'CmdOrCtrl+E', // Optional: Can add a shortcut for this action
          click: () => {
            // Send IPC message to renderer to trigger editing of the current flashcard
            win.webContents.send('edit-text');
          },
        },
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',  // Optional: Add keyboard shortcut for copy
          click: () => {
            // Send IPC message to renderer to copy the content of #textItem
            win.webContents.send('copy-text');
          },
        },
        {
          label: 'Inspect Element',
          accelerator: 'CmdOrCtrl+Shift+I', // Optional: Add a keyboard shortcut
          click: () => {
            // Open the DevTools for the current window
            win.webContents.openDevTools();
          },
        },
        { type: 'separator' },
        {
          role: 'reload',
        },
      ],
    },
    {
      label: 'Preferences',
      submenu: [
          {
              label: 'Listen after recording',
              type: 'checkbox',
              checked: false,
              click: (menuItem) => {
                  win.webContents.send('update-preferences', {
                      "listenAfterRecord": menuItem.checked,
                  });
              },
          },
          {
              label: 'Listen when flashcards load',
              type: 'checkbox',
              checked: false,
              click: (menuItem) => {
                  win.webContents.send('update-preferences', {
                    "listenAfterLoad": menuItem.checked,
                  });
              },
          },
      ],
  },
  ];

  const menuVal = Menu.buildFromTemplate(menuTemplate);
  return menuVal;
}

ipcMain.on('update-on-preference', (event, data) => {
  let listenLoadMenuItem = menu.items[2].submenu.items[1]; // Access the checkbox item
  listenLoadMenuItem.checked = data.listenAfterLoad; // Update the checked state

  let listenRecordMenuItem = menu.items[2].submenu.items[0]; // Access the checkbox item
  listenRecordMenuItem.checked = data.listenAfterRecord; // Update the checked state
});

// IPC listener for opening a dialog
ipcMain.handle('dialog:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Import a flashcard file (File must be zip, txt, or csv. Refer to help for more info.)',
    defaultPath: path.join(dataPath),
    properties: ['openFile'],
    filters: [{ name: 'Text/CSV Files', extensions: ['txt', 'csv', 'zip'] }],
  }).then(result => {
    logger.debug(`string result: ${JSON.stringify(result)}`);
    if (!result.canceled) {
      logger.info('Imported file:', result.filePaths);
      return result.filePaths; // Return the selected file paths
    }
  }).catch(err => {
    logger.error('Error importing file:', err);
    return;
  });
  return result;
});

// IPC listener for opening a dialog
ipcMain.handle('dialog:save', async (event, { defaultFileName, filters }) => {
  const result = await dialog.showSaveDialog({
    title: 'Export to zip (zip includes flashcard and audio files)',
    defaultPath: path.join(dataPath, defaultFileName),
    properties: ['createDirectory'],
    filters: filters,
  }).then(result => {
    logger.debug(`string result: ${JSON.stringify(result)}`);
    if (!result.canceled) {
      logger.info('Exported file to:', result.filePath);
      return result.filePath;
    }
  }).catch(err => {
    logger.error('Error exporting file:', err);
    return;
  });
  return result;
});

// Example IPC handler to get the config path
ipcMain.handle('get-config-path', (event) => {
  logger.debug(`config path ${configPath}`);
  return configPath;
});

// Example IPC handler to get the config path
ipcMain.handle('get-data-path', (event) => {
  logger.debug(`data path ${dataPath}`);
  return dataPath;
});


app.whenReady().then(() => {
  userDataPath = app.getPath('userData');
  logger.info(`userDataPath ${userDataPath}`);
  configPath = path.join(userDataPath, 'config/'); // Config directory
  dataPath = path.join(userDataPath, 'data/'); // Data directory

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});


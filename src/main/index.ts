import { app, BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { openDatabase } from './db/database';
import { registerIpcHandlers } from './ipcHandlers';
import { registerStorageIpcHandlers } from './storageIpcHandlers';
import { registerReportIpcHandlers } from './reportsIpcHandlers';
import { detectOneDrivePath, resolveStorageFolder, saveStorageFolder, dbFilePathFor } from './storage/storageLocation';
import { ensureMonthlySnapshot } from './backup/snapshotService';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let db: Database.Database | null = null;
let mainWindow: BrowserWindow | null = null;
let dbFolderPath = '';

/**
 * Runs once, before any window exists, when there's no saved storage
 * location yet on this laptop (fresh install, or the previously saved
 * folder has gone missing). Detects OneDrive on THIS machine - never a
 * path baked in ahead of time - offers it as the default, and falls back
 * to a manual folder picker either way. If the shopkeeper dismisses
 * everything, the app still starts up using its own local data folder so
 * they're never blocked; they can set a real location later from
 * Settings.
 */
async function runFirstRunFolderPicker(fallbackFolderPath: string): Promise<string> {
  const oneDrivePath = detectOneDrivePath();

  if (oneDrivePath) {
    const choice = await dialog.showMessageBox({
      type: 'question',
      title: 'Set up backups',
      message: 'We found OneDrive on this computer.',
      detail: `Store your data in OneDrive so it's always backed up?\n\n${oneDrivePath}`,
      buttons: ['Use OneDrive', 'Choose a different folder', 'Skip for now'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice.response === 0) return oneDrivePath;
    if (choice.response === 2) return fallbackFolderPath;
    // else fall through to the manual picker below
  } else {
    const choice = await dialog.showMessageBox({
      type: 'info',
      title: 'Set up backups',
      message: "We couldn't find OneDrive on this computer.",
      detail: 'Choose a folder (e.g. a OneDrive, Google Drive, or Dropbox folder) to keep your data always backed up. You can also set this up later from Settings.',
      buttons: ['Choose a folder', 'Skip for now'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response === 1) return fallbackFolderPath;
  }

  const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (picked.canceled || picked.filePaths.length === 0) return fallbackFolderPath;
  return picked.filePaths[0];
}

function createWindow(): void {
  // Copied alongside the compiled main process by scripts/copy-assets.js,
  // from build/icon.ico - see that script's comment. Only affects the
  // running app's own window (title bar/taskbar); the installer, Desktop
  // shortcut, and .exe file icon are handled separately by electron-builder
  // reading build/icon.ico directly (see package.json's "win.icon").
  const iconPath = path.join(__dirname, 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    title: 'Ghousia Chicken Khata',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      // Renderer never gets direct Node/electron access - everything goes
      // through the explicit, typed bridge in preload/index.ts.
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // In dev, load the Vite dev server for hot reload; otherwise load the
  // static build that `vite build` produced alongside the compiled main
  // process. This is driven by an explicit env var (set only by the
  // `dev:electron` script) rather than app.isPackaged, because `npm start`
  // also runs unpackaged but must load the built file, not the dev server.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const resolved = resolveStorageFolder();
  dbFolderPath = resolved.dbFolderPath;

  if (resolved.isFirstRun) {
    dbFolderPath = await runFirstRunFolderPicker(resolved.dbFolderPath);
    saveStorageFolder(dbFolderPath);
  }

  db = openDatabase(dbFilePathFor(dbFolderPath));

  registerIpcHandlers(db);
  registerStorageIpcHandlers(
    () => db!,
    () => dbFolderPath,
    () => mainWindow
  );
  registerReportIpcHandlers(
    () => db!,
    () => mainWindow
  );
  createWindow();

  // Cheap no-op most days (only actually copies anything once a month) -
  // safe and fast enough to run on every launch without the shopkeeper
  // noticing any delay.
  ensureMonthlySnapshot(db, dbFolderPath).catch(() => {
    // A failed snapshot (e.g. disk full, folder briefly unavailable
    // mid-sync) shouldn't block the shopkeeper from using the app -
    // it'll simply retry next launch.
  });

  app.on('activate', () => {
    // macOS convention: re-create a window when the dock icon is clicked
    // and no windows are open. Harmless no-op on Windows/Linux.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Flush and close cleanly.
  db?.close();
  db = null;
});
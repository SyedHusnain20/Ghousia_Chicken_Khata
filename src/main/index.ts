import { app, BrowserWindow } from 'electron';
import path from 'path';
import Database from 'better-sqlite3';
import { openDatabase } from './db/database';
import { registerIpcHandlers } from './ipcHandlers';

let db: Database.Database | null = null;
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    title: 'Ghousia Chicken Khata',
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

app.whenReady().then(() => {
  // Single local DB file living in the OS user-data folder, e.g.
  // %APPDATA%/Ghousia Chicken Khata/khata.db on Windows - persists across
  // app updates and is what Settings > Backup/Restore will read and write
  // in a later phase.
  const dbPath = path.join(app.getPath('userData'), 'khata.db');
  db = openDatabase(dbPath);

  registerIpcHandlers(db);
  createWindow();

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
  // Flush and close cleanly so WAL files don't linger unmerged.
  db?.close();
  db = null;
});
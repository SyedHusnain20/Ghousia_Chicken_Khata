import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { IpcChannels } from '../shared/ipc';
import type {
  ChooseFolderResult,
  ChooseRestoreFileResult,
  ConfirmChangeStorageRequest,
  ConfirmRestoreRequest,
  StorageInfo,
} from '../shared/ipc';
import {
  detectOneDrivePath,
  dbFilePathFor,
  moveDatabaseTo,
  isValidKhataDatabase,
  restoreDatabaseFrom,
} from './storage/storageLocation';
import { listSnapshots, createSnapshotNow } from './backup/snapshotService';

/**
 * Registers the storage:* IPC channels used by the Settings screen.
 *
 * Unlike registerIpcHandlers() in ipcHandlers.ts, this needs a live
 * reference to the *current* db folder (which can change at runtime via
 * "Change Location") and the main window (for parenting native dialogs),
 * so it takes small getter functions rather than fixed values.
 */
export function registerStorageIpcHandlers(
  getDb: () => Database.Database,
  getDbFolderPath: () => string,
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle(IpcChannels.STORAGE_GET_INFO, (): StorageInfo => {
    const dbFolderPath = getDbFolderPath();
    const oneDriveDetectedPath = detectOneDrivePath();
    return {
      dbFolderPath,
      dbFilePath: dbFilePathFor(dbFolderPath),
      isOneDrive: oneDriveDetectedPath !== null && isInside(dbFolderPath, oneDriveDetectedPath),
      oneDriveDetectedPath,
      snapshots: listSnapshots(dbFolderPath),
    };
  });

  ipcMain.handle(IpcChannels.STORAGE_CHOOSE_FOLDER, async (): Promise<ChooseFolderResult | null> => {
    const win = getMainWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folderPath = result.filePaths[0];
    return {
      folderPath,
      hasExistingDatabase: fs.existsSync(dbFilePathFor(folderPath)),
    };
  });

  ipcMain.handle(IpcChannels.STORAGE_CONFIRM_CHANGE, (_event, req: ConfirmChangeStorageRequest): void => {
    const db = getDb();
    const currentDbPath = dbFilePathFor(getDbFolderPath());
    db.close(); // must close before moving the file out from under it
    try {
      moveDatabaseTo(currentDbPath, req.folderPath, req.overwrite);
    } catch (err) {
      // moveDatabaseTo only saves the new location after a verified copy
      // succeeds, so on failure the saved config still points at the
      // original folder - a relaunch below harmlessly reopens things
      // exactly as they were. Just make sure the shopkeeper sees why.
      dialog.showErrorBox('Could not change location', err instanceof Error ? err.message : String(err));
    } finally {
      // Simplest, safest way to make the result "live" either way:
      // restart the whole app rather than trying to hot-swap every open
      // reference to the old database connection.
      app.relaunch();
      app.exit(0);
    }
  });

  ipcMain.handle(IpcChannels.STORAGE_CREATE_SNAPSHOT_NOW, () => {
    return createSnapshotNow(getDb(), getDbFolderPath());
  });

  ipcMain.handle(IpcChannels.STORAGE_OPEN_FOLDER, async () => {
    await shell.openPath(getDbFolderPath());
  });

  ipcMain.handle(IpcChannels.STORAGE_CHOOSE_RESTORE_FILE, async (): Promise<ChooseRestoreFileResult | null> => {
    const win = getMainWindow();
    const options = {
      title: 'Choose a backup to restore',
      defaultPath: path.join(getDbFolderPath(), 'Snapshots'),
      filters: [{ name: 'Khata database', extensions: ['db'] }],
      properties: ['openFile'] as Array<'openFile'>,
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    return { filePath, isValid: isValidKhataDatabase(filePath) };
  });

  ipcMain.handle(IpcChannels.STORAGE_CONFIRM_RESTORE, (_event, req: ConfirmRestoreRequest): void => {
    const db = getDb();
    const currentDbPath = dbFilePathFor(getDbFolderPath());
    db.close(); // must close before overwriting the file out from under it
    try {
      restoreDatabaseFrom(currentDbPath, req.filePath);
    } catch (err) {
      dialog.showErrorBox('Could not restore backup', err instanceof Error ? err.message : String(err));
    } finally {
      app.relaunch();
      app.exit(0);
    }
  });
}

function isInside(childPath: string, parentPath: string): boolean {
  const normalizedChild = childPath.toLowerCase().replace(/\\/g, '/');
  const normalizedParent = parentPath.toLowerCase().replace(/\\/g, '/');
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

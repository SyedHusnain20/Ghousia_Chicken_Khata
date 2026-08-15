import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { ACTIVATION_GET_MACHINE_ID, ACTIVATION_SUBMIT_CODE } from './ipcChannels';
import { getMachineId } from './machineId';
import { tryActivate } from './licenseService';

export function showActivationWindow(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;

    const win = new BrowserWindow({
      width: 480,
      height: 440,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Activate Ghousia Chicken Khata',
      webPreferences: {
        preload: path.join(__dirname, '../../preload/activation.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, 'activation.html'));

    ipcMain.handle(ACTIVATION_GET_MACHINE_ID, () => getMachineId());

    ipcMain.handle(ACTIVATION_SUBMIT_CODE, (_event, code: string) => {
      const accepted = tryActivate(code);
      if (accepted) {
        settled = true;
        ipcMain.removeHandler(ACTIVATION_GET_MACHINE_ID);
        ipcMain.removeHandler(ACTIVATION_SUBMIT_CODE);
        // Brief pause so the "Activated!" message is actually visible
        // before the window disappears and the real app takes over.
        setTimeout(() => {
          win.close();
          resolve();
        }, 900);
      }
      return accepted;
    });

    win.on('closed', () => {
      if (!settled) {
        // Hard block: closing this window without a valid code means
        // there's nothing else for the app to do.
        ipcMain.removeHandler(ACTIVATION_GET_MACHINE_ID);
        ipcMain.removeHandler(ACTIVATION_SUBMIT_CODE);
        app.quit();
      }
    });
  });
}

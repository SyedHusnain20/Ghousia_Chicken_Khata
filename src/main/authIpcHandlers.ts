import { ipcMain } from 'electron';
import { IpcChannels } from '../shared/ipc';
import type { AuthStatus, SetupPasswordRequest, UnlockRequest, ChangePasswordRequest } from '../shared/ipc';
import type { AppLock } from './security/appLock';

/**
 * Registers the auth:* channels behind the lock screen and the Settings >
 * Change Password form. These are the only channels that work while the
 * app is still locked (everything else goes through guardedHandle()).
 */
export function registerAuthIpcHandlers(lock: AppLock): void {
  ipcMain.handle(IpcChannels.AUTH_GET_STATUS, (): AuthStatus => {
    return { hasPassword: lock.hasPassword(), unlocked: lock.isUnlocked() };
  });

  ipcMain.handle(IpcChannels.AUTH_SETUP, (_event, req: SetupPasswordRequest): void => {
    lock.setInitialPassword(req.password, req.confirmPassword);
  });

  ipcMain.handle(IpcChannels.AUTH_UNLOCK, (_event, req: UnlockRequest): void => {
    lock.unlock(req.password);
  });

  ipcMain.handle(IpcChannels.AUTH_CHANGE_PASSWORD, (_event, req: ChangePasswordRequest): void => {
    lock.changePassword(req.currentPassword, req.newPassword, req.confirmNewPassword);
  });
}

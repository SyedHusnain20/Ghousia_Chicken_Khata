import { contextBridge, ipcRenderer } from 'electron';
import { ACTIVATION_GET_MACHINE_ID, ACTIVATION_SUBMIT_CODE } from '../main/license/ipcChannels';

contextBridge.exposeInMainWorld('activation', {
  getMachineId: (): Promise<string> => ipcRenderer.invoke(ACTIVATION_GET_MACHINE_ID),
  submitCode: (code: string): Promise<boolean> => ipcRenderer.invoke(ACTIVATION_SUBMIT_CODE, code),
});

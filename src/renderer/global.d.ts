import { KhataApi } from '../shared/ipc';

declare global {
  interface Window {
    khata: KhataApi;
  }
}

export {};
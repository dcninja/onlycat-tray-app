import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('onlycat', {
  getSettings: () => ipcRenderer.invoke('notification-settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('notification-settings:save', settings),
  getToken: () => ipcRenderer.invoke('settings:get-token'),
  updateToken: (token: string) => ipcRenderer.invoke('settings:update-token', token),
  close: () => ipcRenderer.send('notification-settings:close'),
});

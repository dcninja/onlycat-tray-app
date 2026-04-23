import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('onlycat', {
  getSettings: () => ipcRenderer.invoke('notification-settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('notification-settings:save', settings),
  getToken: () => ipcRenderer.invoke('settings:get-token'),
  updateToken: (token: string) => ipcRenderer.invoke('settings:update-token', token),
  getAutoStart: () => ipcRenderer.invoke('settings:get-auto-start'),
  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('settings:set-auto-start', enabled),
  testNotification: () => ipcRenderer.invoke('settings:test-notification'),
  close: () => ipcRenderer.send('notification-settings:close'),
});

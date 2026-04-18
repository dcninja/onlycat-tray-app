import { contextBridge, ipcRenderer } from 'electron';
import type { NotificationSettings } from '../../main/SettingsStore';

contextBridge.exposeInMainWorld('onlycat', {
  getSettings: () => ipcRenderer.invoke('notification-settings:get'),
  saveSettings: (settings: NotificationSettings) => ipcRenderer.invoke('notification-settings:save', settings),
  close: () => ipcRenderer.send('notification-settings:close'),
});

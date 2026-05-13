import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('onlycat', {
  getTelemetry: (measureName: string, range: string) =>
    ipcRenderer.invoke('telemetry:get', measureName, range),
  getLatestTelemetry: () =>
    ipcRenderer.invoke('telemetry:get-latest'),
});

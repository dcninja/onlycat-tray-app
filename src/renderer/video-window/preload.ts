import { contextBridge, ipcRenderer } from 'electron';
import type { DeviceEvent } from '../../shared/types';

// Inline channel names to avoid module resolution issues in sandboxed preload
const VIDEO_OPEN = 'video:open';
const VIDEO_EVENT_DATA = 'video:event-data';
const VIDEO_EVENT_UPDATE = 'video:event-update';
const VIDEO_READY = 'video:ready';

contextBridge.exposeInMainWorld('onlycat', {
  signalReady: () => ipcRenderer.send(VIDEO_READY),
  requestRetry: (deviceId: string, eventId: number) =>
    ipcRenderer.send(VIDEO_OPEN, { deviceId, eventId }),
  onVideoOpen: (cb: (payload: { deviceId: string; eventId: number }) => void) => {
    ipcRenderer.on(VIDEO_OPEN, (_e, payload) => cb(payload));
  },
  onEventData: (cb: (event: DeviceEvent) => void) => {
    ipcRenderer.on(VIDEO_EVENT_DATA, (_e, event: DeviceEvent) => cb(event));
  },
  onEventUpdate: (cb: (event: DeviceEvent) => void) => {
    ipcRenderer.on(VIDEO_EVENT_UPDATE, (_e, event: DeviceEvent) => cb(event));
  },
});

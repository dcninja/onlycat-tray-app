import { contextBridge, ipcRenderer } from 'electron';
import type { DeviceEvent } from '../../shared/types';

// Inline channel names to avoid module resolution issues in sandboxed preload
const EVENTS_LOAD_MORE = 'events:load-more';
const EVENTS_LIST = 'events:list';
const EVENTS_LOAD_MORE_RESULT = 'events:load-more-result';
const EVENTS_PREPEND = 'events:prepend';
const VIDEO_OPEN = 'video:open';

contextBridge.exposeInMainWorld('onlycat', {
  loadMore: (beforeGlobalId?: number) =>
    ipcRenderer.send(EVENTS_LOAD_MORE, { beforeGlobalId }),
  openVideo: (deviceId: string, eventId: number) =>
    ipcRenderer.send(VIDEO_OPEN, { deviceId, eventId }),
  onEventsList: (cb: (events: DeviceEvent[]) => void) => {
    ipcRenderer.on(EVENTS_LIST, (_e, events: DeviceEvent[]) => cb(events));
  },
  onEventsLoadMoreResult: (cb: (events: DeviceEvent[]) => void) => {
    ipcRenderer.on(EVENTS_LOAD_MORE_RESULT, (_e, events: DeviceEvent[]) => cb(events));
  },
  onEventPrepend: (cb: (event: DeviceEvent) => void) => {
    ipcRenderer.on(EVENTS_PREPEND, (_e, event: DeviceEvent) => cb(event));
  },
});

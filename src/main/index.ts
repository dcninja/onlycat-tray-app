import { app, ipcMain, Notification } from 'electron';
import tokenStore from './TokenStore';
import gatewayClient from './GatewayClient';
import trayManager from './TrayManager';
import windowManager from './WindowManager';
import notificationManager from './NotificationManager';
import settingsStore from './SettingsStore';
import { checkForUpdates, openReleasePage } from './UpdateChecker';
import { classificationLabel, triggerSourceLabel } from '../shared/eventLabels';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import type { AuthSubmitTokenPayload, EventsLoadMorePayload } from '../shared/ipcChannels';
import type { Device, DeviceEvent } from '../shared/types';

// Set app name before ready so OS notifications show "OnlyCat" not "Electron"
app.setName('OnlyCat');

// Fix taskbar WM class on Linux
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'OnlyCat');
}

const GATEWAY_URL = 'https://gateway.onlycat.com';

let devices: Device[] = [];
let cachedEvents: DeviceEvent[] = [];
let eventsCached = false;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentVideoEvent: { deviceId: string; eventId: number } | null = null;
let updateInfo: { latestVersion: string; releaseUrl: string } | null = null;

// Fetch all event pages and cache them
async function fetchAllEvents(): Promise<void> {
  const allEvents: DeviceEvent[] = [];
  let beforeGlobalId: number | undefined;

  while (true) {
    const payload = beforeGlobalId
      ? { beforeGlobalId }
      : { subscribe: true };

    const page = await gatewayClient.request('getEvents', payload) as DeviceEvent[];
    if (!page?.length) break;

    const enriched = await Promise.all(page.map(async (e) => {
      const normalized = normalizeEvent(e, devices);
      const catName = await getCatName(normalized);
      return catName ? { ...normalized, catName } : normalized;
    }));

    allEvents.push(...enriched);
    beforeGlobalId = page[page.length - 1].globalId;

    if (page.length < 20) break;
  }

  cachedEvents = allEvents;
  eventsCached = true;
}

// Build normalized event with derived URLs and device name
function normalizeEvent(raw: DeviceEvent, deviceList: Device[]): DeviceEvent {
  const device = deviceList.find(d => d.deviceId === raw.deviceId);
  const deviceName = device?.name ?? device?.description ?? raw.deviceId;
  const createdAt = raw.timestamp ?? raw.createdAt;

  let videoUrl = raw.videoUrl;
  let thumbnailUrl = raw.thumbnailUrl;

  if (raw.accessToken && !videoUrl) {
    videoUrl = `https://onlycat.app/events/${raw.deviceId}/${raw.eventId}?t=${raw.accessToken}`;
  }
  if (raw.accessToken && !thumbnailUrl) {
    const frameIndex = raw.posterFrameIndex ?? 0;
    thumbnailUrl = `${GATEWAY_URL}/events/${raw.deviceId}/${raw.eventId}/${frameIndex}`;
  }

  const trigger = triggerSourceLabel(raw.eventTriggerSource);
  const classification = classificationLabel(raw.eventClassification);
  const type = classification ? `${trigger} · ${classification}` : trigger;

  return { ...raw, deviceName, createdAt, videoUrl, thumbnailUrl, type };
}

// Helper to get cat names from all rfid codes — cache first, API on miss
async function getCatName(event: DeviceEvent): Promise<string | undefined> {
  if (!event.rfidCodes?.length) return undefined;

  const names: string[] = [];
  for (const rfidCode of event.rfidCodes) {
    let name = settingsStore.getCatName(rfidCode);
    if (!name) {
      try {
        const profile = await gatewayClient.request('getRfidProfile', {
          rfidCode,
          deviceId: event.deviceId,
        }) as { label?: string };
        name = profile?.label ?? undefined;
        if (name) settingsStore.setCatName(rfidCode, name);
      } catch {
        // skip
      }
    }
    if (name && !names.includes(name)) names.push(name);
  }

  return names.length ? names.join(' & ') : undefined;
}

async function fetchAndSendEvent(deviceId: string, eventId: number): Promise<void> {
  await new Promise(r => setTimeout(r, 500));
  const videoWin = windowManager.getVideoWindow();
  if (!videoWin) return;

  try {
    const event = await gatewayClient.request('getEvent', { deviceId, eventId, subscribe: true }) as DeviceEvent;
    const normalized = normalizeEvent(event, devices);
    currentVideoEvent = { deviceId, eventId };

    if (normalized.videoUrl) {
      videoWin.loadURL(normalized.videoUrl);
    } else {
      videoWin.webContents.send(IPC_CHANNELS.VIDEO_EVENT_DATA, normalized);
    }
  } catch (err) {
    console.error('getEvent failed', err);
  }
}

// Prevent quit when all windows are closed — tray app stays alive
app.on('window-all-closed', () => {});

app.on('ready', async () => {
  trayManager.init({
    onActivityClick: () => {
      trayManager.setUnacknowledgedEvent(null);
      windowManager.openActivityWindow();
    },
    onSignOutClick: () => handleSignOut(),
    onUnacknowledgedClick: (event) => {
      trayManager.setUnacknowledgedEvent(null);
      windowManager.openVideoWindow(event.deviceId, event.eventId);
      fetchAndSendEvent(event.deviceId, event.eventId);
    },
    onToggleVideoOnly: () => {
      const newVal = !settingsStore.notifyOnVideoOnly;
      settingsStore.notifyOnVideoOnly = newVal;
      trayManager.setNotifyOnVideoOnly(newVal);
    },
    onCheckUpdate: async () => {
      const info = await checkForUpdates();
      if (info?.hasUpdate) {
        updateInfo = { latestVersion: info.latestVersion, releaseUrl: info.releaseUrl };
        trayManager.setUpdateAvailable(info.latestVersion);
        openReleasePage(info.releaseUrl);
      } else if (updateInfo) {
        openReleasePage(updateInfo.releaseUrl);
      } else {
        new Notification({ title: 'OnlyCat', body: 'You are running the latest version.' }).show();
      }
    },
    notifyOnVideoOnly: settingsStore.notifyOnVideoOnly,
    onTestNotification: async () => {
      try {
        const result = await gatewayClient.request('getEvents', {}) as DeviceEvent[];
        if (result?.length) {
          const event = normalizeEvent(result[0], devices);
          const catName = await getCatName(event);
          trayManager.setUnacknowledgedEvent(event);
          await notificationManager.notify(event, event.deviceName ?? event.deviceId, catName);
        }
      } catch (err) {
        console.error('test notification failed', err);
      }
    },
  });

  notificationManager.init({
    onEventClick: (event: DeviceEvent) => {
      trayManager.setUnacknowledgedEvent(null);
      windowManager.openVideoWindow(event.deviceId, event.eventId);
      fetchAndSendEvent(event.deviceId, event.eventId);
    },
  });

  // Check for updates in background
  checkForUpdates().then((info) => {
    if (info?.hasUpdate) {
      updateInfo = { latestVersion: info.latestVersion, releaseUrl: info.releaseUrl };
      trayManager.setUpdateAvailable(info.latestVersion);
    }
  });

  const storedToken = tokenStore.load();
  if (storedToken) {
    trayManager.setConnectionState('connecting');
    gatewayClient.connect(storedToken);
  } else {
    windowManager.openTokenDialog();
  }
});

// Auth
ipcMain.on(IPC_CHANNELS.AUTH_SUBMIT_TOKEN, (_event, payload: AuthSubmitTokenPayload) => {
  const { token } = payload;

  const onConnected = () => {
    cleanup();
    tokenStore.save(token);
    windowManager.closeTokenDialog();
    trayManager.setConnectionState('connected');
    gatewayClient.request('getDevices', { subscribe: true })
      .then(async (result) => {
        const list = result as Device[];
        const detailed = await Promise.all(
          list.map(d =>
            gatewayClient.request('getDevice', { deviceId: d.deviceId, subscribe: true })
              .then(r => r as Device)
              .catch(() => d)
          )
        );
        devices = detailed;
        trayManager.setDevices(devices);
      })
      .catch((err) => console.error('getDevices failed', err));
  };

  const onConnectError = (error: Error) => {
    cleanup();
    const win = windowManager.getTokenDialog();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.AUTH_CONNECT_ERROR, {
        message: error?.message ?? 'Authentication failed. Please check your token.',
      });
    }
  };

  const cleanup = () => {
    gatewayClient.off('connected', onConnected);
    gatewayClient.off('connect_error', onConnectError);
  };

  gatewayClient.once('connected', onConnected);
  gatewayClient.once('connect_error', onConnectError);
  gatewayClient.connect(token);
});

function handleSignOut(): void {
  tokenStore.clear();
  gatewayClient.disconnect();
  devices = [];
  cachedEvents = [];
  eventsCached = false;
  trayManager.setDevices([]);
  trayManager.setConnectionState('disconnected');
  trayManager.setUnacknowledgedEvent(null);
  windowManager.openTokenDialog();
}

// Device live updates
gatewayClient.on('userDeviceUpdate', (data: { type: string; body: Device }) => {
  if (data.type === 'create') {
    devices = [data.body, ...devices];
    trayManager.setDevices(devices);
  }
});

gatewayClient.on('deviceUpdate', (data: { type: string; deviceId: string; body: Partial<Device> }) => {
  if (data.type === 'update') {
    devices = devices.map((d) => d.deviceId === data.deviceId ? { ...d, ...data.body } : d);
    trayManager.setDevices(devices);
  }
});

// Connection state
gatewayClient.on('connected', () => {
  if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
  trayManager.setConnectionState('connected');
  if (tokenStore.load()) {
    gatewayClient.request('getDevices', { subscribe: true })
      .then(async (result) => {
        const list = result as Device[];
        const detailed = await Promise.all(
          list.map(d =>
            gatewayClient.request('getDevice', { deviceId: d.deviceId, subscribe: true })
              .then(r => r as Device)
              .catch(() => d)
          )
        );
        devices = detailed;
        trayManager.setDevices(devices);
        if (!eventsCached) fetchAllEvents().catch(console.error);
      })
      .catch((err) => console.error('getDevices (reconnect) failed', err));
  }
});

gatewayClient.on('disconnected', () => {
  trayManager.setConnectionState('disconnected');
  if (!disconnectTimer) {
    disconnectTimer = setTimeout(() => {
      disconnectTimer = null;
      notificationManager.notify(
        { globalId: -1, eventId: -1, deviceId: '', type: 'Connection Lost', createdAt: new Date().toISOString() },
        'OnlyCat'
      );
    }, 60_000);
  }
});

gatewayClient.on('reconnecting', () => trayManager.setConnectionState('reconnecting'));

// Activity window — events
ipcMain.on(IPC_CHANNELS.EVENTS_LOAD_MORE, async (_event, payload: EventsLoadMorePayload) => {
  const activityWin = windowManager.getActivityWindow();
  if (!activityWin) return;

  if (eventsCached) {
    activityWin.webContents.send(IPC_CHANNELS.EVENTS_LIST, cachedEvents);
    return;
  }

  try {
    const result = await gatewayClient.request('getEvents', { subscribe: true });
    const normalized = (result as DeviceEvent[]).map(e => normalizeEvent(e, devices));
    const enriched = await Promise.all(normalized.map(async (event) => {
      const catName = await getCatName(event);
      return catName ? { ...event, catName } : event;
    }));
    activityWin.webContents.send(IPC_CHANNELS.EVENTS_LIST, enriched);
    fetchAllEvents().catch(console.error);
  } catch (err) {
    console.error('getEvents failed', err);
  }
});

gatewayClient.on('userEventUpdate', async (data: { type: string; body: DeviceEvent }) => {
  if (data.type !== 'create') return;
  if (settingsStore.notifyOnVideoOnly && data.body.posterFrameIndex == null) return;

  const event = normalizeEvent(data.body, devices);
  const deviceName = event.deviceName ?? event.deviceId;
  const catName = await getCatName(event);
  const enriched = catName ? { ...event, catName } : event;

  cachedEvents = [enriched, ...cachedEvents];
  trayManager.setUnacknowledgedEvent(enriched);
  notificationManager.notify(enriched, deviceName, catName);

  const activityWin = windowManager.getActivityWindow();
  if (activityWin) activityWin.webContents.send(IPC_CHANNELS.EVENTS_PREPEND, enriched);
});

// Video window
ipcMain.on(IPC_CHANNELS.VIDEO_OPEN, (_event, payload: { deviceId: string; eventId: number }) => {
  windowManager.openVideoWindow(payload.deviceId, payload.eventId);
  fetchAndSendEvent(payload.deviceId, payload.eventId);
});

gatewayClient.on('eventUpdate', (data: { type: string; deviceId: string; eventId: number; body: Partial<DeviceEvent> }) => {
  if (data.type !== 'update' || !currentVideoEvent) return;
  if (data.deviceId !== currentVideoEvent.deviceId || data.eventId !== currentVideoEvent.eventId) return;

  const videoWin = windowManager.getVideoWindow();
  if (!videoWin) return;

  videoWin.webContents.send(IPC_CHANNELS.VIDEO_EVENT_UPDATE, {
    ...data.body, deviceId: data.deviceId, eventId: data.eventId,
  });
});

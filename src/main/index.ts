import { app, ipcMain, Notification, clipboard } from 'electron';
import tokenStore from './TokenStore';
import gatewayClient from './GatewayClient';
import trayManager from './TrayManager';
import windowManager from './WindowManager';
import notificationManager from './NotificationManager';
import settingsStore from './SettingsStore';
import { checkForUpdates, openReleasePage } from './UpdateChecker';
import { classificationLabel, triggerSourceLabel, formatSubevent } from '../shared/eventLabels';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import type { AuthSubmitTokenPayload, EventsLoadMorePayload } from '../shared/ipcChannels';
import type { Device, DeviceEvent, DeviceTransitPolicy } from '../shared/types';
import { saveEvents, loadAllEvents, getLatestGlobalId, getEventCount, setMeta, getMeta } from './EventDatabase';

// Set app name before ready so OS notifications show "OnlyCat" not "Electron"
app.setName('OnlyCat');

// Fix taskbar WM class on Linux
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'OnlyCat');
}

const GATEWAY_URL = 'https://gateway.onlycat.com';

let devices: Device[] = [];
let transitPolicies: Map<string, DeviceTransitPolicy[]> = new Map(); // deviceId -> policies
let cachedEvents: DeviceEvent[] = [];
let eventsCached = false;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentVideoEvent: { deviceId: string; eventId: number } | null = null;
let updateInfo: { latestVersion: string; releaseUrl: string } | null = null;

// Fetch events from API — only new ones if we have a DB, full history on first run
async function fetchAllEvents(): Promise<void> {
  const existingCount = await getEventCount();
  const latestGlobalId = await getLatestGlobalId();
  const isFirstRun = existingCount === 0;

  console.log(`fetchAllEvents: existingCount=${existingCount}, latestGlobalId=${latestGlobalId}, firstRun=${isFirstRun}`);

  const allNewEvents: DeviceEvent[] = [];
  let beforeGlobalId: number | undefined;
  let retries = 0;
  let pageCount = 0;

  while (true) {
    try {
      const payload = beforeGlobalId
        ? { beforeGlobalId }
        : { subscribe: true };

      const page = await gatewayClient.request('getEvents', payload) as DeviceEvent[];
      if (!page?.length) break;

      // On subsequent runs, filter out events we already have
      const newPage = isFirstRun ? page : page.filter(e => !latestGlobalId || e.globalId > latestGlobalId);

      const enriched = await Promise.all(newPage.map(async (e) => {
        const normalized = normalizeEvent(e, devices);
        const catName = await getCatName(normalized);
        let summary: string | undefined;
        let subevents: DeviceEvent['subevents'];
        if (normalized.accessToken) {
          try {
            const result = await gatewayClient.request('getEventSummary', {
              deviceId: normalized.deviceId,
              eventId: normalized.eventId,
              accessToken: normalized.accessToken,
              subscribe: true,
            }) as { subevents?: Array<{ startFrameIndex: number; endFrameIndex: number; direction: string; action: string; rfidCode: string | null }> } | null;
            if (result?.subevents?.length) {
              const parts = result.subevents.map(s => formatSubevent(s.direction, s.action));
              summary = parts[parts.length - 1];
              subevents = result.subevents;
            }
          } catch { /* skip */ }
        }
        return { ...normalized, ...(catName ? { catName } : {}), ...(summary ? { summary, subevents } : {}) };
      }));

      allNewEvents.push(...enriched);
      beforeGlobalId = page[page.length - 1].globalId;
      retries = 0;
      pageCount++;

      // On subsequent runs, stop when we reach events we already have
      if (!isFirstRun && latestGlobalId && page.some(e => e.globalId <= latestGlobalId)) {
        console.log(`fetchAllEvents: reached known events at page ${pageCount}, stopping`);
        break;
      }

      if (page.length < 20) break;

      // Throttle on first run to be polite to the API
      if (isFirstRun) {
        await new Promise(r => setTimeout(r, 250));
      }
    } catch (err) {
      retries++;
      if (retries >= 3) {
        console.error('fetchAllEvents: giving up after 3 retries', err);
        break;
      }
      await new Promise(r => setTimeout(r, 2000 * retries));
    }
  }

  if (allNewEvents.length > 0) {
    await saveEvents(allNewEvents);
    console.log(`fetchAllEvents: saved ${allNewEvents.length} new events`);
  }

  // Load full cache from DB
  cachedEvents = await loadAllEvents();
  eventsCached = true;
  await setMeta('lastRun', new Date().toISOString());
  console.log(`fetchAllEvents: total cached events = ${cachedEvents.length}`);
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

async function fetchTransitPolicies(): Promise<void> {
  for (const device of devices) {
    try {
      const policies = await gatewayClient.request('getDeviceTransitPolicies', {
        deviceId: device.deviceId,
      }) as DeviceTransitPolicy[];
      transitPolicies.set(device.deviceId, policies);
    } catch {
      // skip
    }
  }
  trayManager.setTransitPolicies(transitPolicies, devices);
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
    onCheckNotificationSettings: () => windowManager.openNotificationSettings(),
    onToggleVideoOnly: () => {
      const newVal = !settingsStore.notifyOnVideoOnly;
      settingsStore.notifyOnVideoOnly = newVal;
      trayManager.setNotifyOnVideoOnly(newVal);
    },
    onActivatePolicy: (deviceId: string, policyId: number) => {
      ipcMain.emit('policy:activate', null, { deviceId, policyId });
    },
    onCheckUpdate: async () => {      const info = await checkForUpdates();
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
        fetchTransitPolicies().catch(console.error);
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
        // Fetch transit policies for each device
        await fetchTransitPolicies();
        if (!eventsCached) {
          // Pre-load from DB immediately so UI is fast, then fetch new events from API
          loadAllEvents().then(stored => {
            if (stored.length > 0 && !eventsCached) {
              cachedEvents = stored;
              eventsCached = true;
            }
          }).catch(console.error);
          setTimeout(() => fetchAllEvents().catch(console.error), 1000);
        }
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
    activityWin.webContents.send(IPC_CHANNELS.KNOWN_RFIDS, settingsStore.getRfidCache());
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
  const ns = settingsStore.notificationSettings;
  if (ns.videoOnly && data.body.posterFrameIndex == null) return;

  const event = normalizeEvent(data.body, devices);
  const deviceName = event.deviceName ?? event.deviceId;
  const catName = await getCatName(event);

  // Fetch event summary for direction/action
  let enrichedEvent = catName ? { ...event, catName } : event;
  if (event.accessToken) {
    try {
      const result = await gatewayClient.request('getEventSummary', {
        deviceId: event.deviceId,
        eventId: event.eventId,
        accessToken: event.accessToken,
        subscribe: true,
      }) as { subevents?: Array<{ startFrameIndex: number; endFrameIndex: number; direction: string; action: string; rfidCode: string | null }> } | null;
      if (result?.subevents?.length) {
        const parts = result.subevents.map(s => formatSubevent(s.direction, s.action));
        enrichedEvent = { ...enrichedEvent, summary: parts[parts.length - 1], subevents: result.subevents };
      }
    } catch { /* skip */ }
  }

  const enriched = enrichedEvent;

  // Apply classification filter
  const cls = enriched.eventClassification ?? 0;
  if (!ns.classifications.includes(cls)) {
    cacheEvent(enriched);
    const activityWin = windowManager.getActivityWindow();
    if (activityWin) activityWin.webContents.send(IPC_CHANNELS.EVENTS_PREPEND, enriched);
    return;
  }

  // Apply summary filters
  const lastSub = enriched.subevents?.[enriched.subevents.length - 1];
  if (lastSub) {
    if (ns.directions.length < 2 && !ns.directions.includes(lastSub.direction)) {
      cacheEvent(enriched);
      const activityWin = windowManager.getActivityWindow();
      if (activityWin) activityWin.webContents.send(IPC_CHANNELS.EVENTS_PREPEND, enriched);
      return;
    }
    if (ns.actions.length < 3 && !ns.actions.includes(lastSub.action)) {
      cacheEvent(enriched);
      const activityWin = windowManager.getActivityWindow();
      if (activityWin) activityWin.webContents.send(IPC_CHANNELS.EVENTS_PREPEND, enriched);
      return;
    }
  } else if (!ns.showNoSummary) {
    cacheEvent(enriched);
    const activityWin = windowManager.getActivityWindow();
    if (activityWin) activityWin.webContents.send(IPC_CHANNELS.EVENTS_PREPEND, enriched);
    return;
  }

  cacheEvent(enriched);
  trayManager.setUnacknowledgedEvent(enriched);
  notificationManager.notify(enriched, deviceName, catName);

  const activityWin = windowManager.getActivityWindow();
  if (activityWin) activityWin.webContents.send(IPC_CHANNELS.EVENTS_PREPEND, enriched);
});

// Notification settings IPC
ipcMain.handle('notification-settings:get', () => settingsStore.notificationSettings);
ipcMain.handle('notification-settings:save', (_e, settings) => {
  settingsStore.notificationSettings = settings;
});
ipcMain.on('notification-settings:close', () => windowManager.closeNotificationSettings());

// Copy URL to clipboard
ipcMain.on('copy:url', (_event, payload: { url: string }) => {
  clipboard.writeText(payload.url);
});

// Activate transit policy
ipcMain.on('policy:activate', async (_event, payload: { deviceId: string; policyId: number }) => {
  try {
    await gatewayClient.request('activateDeviceTransitPolicy', {
      deviceId: payload.deviceId,
      deviceTransitPolicyId: payload.policyId,
    });
    // Refresh device to confirm
    const updated = await gatewayClient.request('getDevice', { deviceId: payload.deviceId, subscribe: true }) as Device;
    devices = devices.map(d => d.deviceId === payload.deviceId ? updated : d);
    trayManager.setDevices(devices);
    trayManager.setTransitPolicies(transitPolicies, devices);
  } catch (err) {
    console.error('activateDeviceTransitPolicy failed', err);
  }
});

// Helper to add event to cache and persist to DB
function cacheEvent(event: DeviceEvent): void {
  cachedEvents = [event, ...cachedEvents];
  saveEvents([event]).catch(console.error);
}

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

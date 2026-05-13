import { app, ipcMain, Notification, clipboard, dialog } from 'electron';
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
import { saveTelemetry, getTelemetry, getLatestTelemetry, pruneTelemetry } from './TelemetryDatabase';
import type { Device, DeviceEvent, DeviceTransitPolicy, RfidLastSeen } from '../shared/types';
import { saveEvents, loadAllEvents, getLatestGlobalId, getEventCount, setMeta, getMeta, toggleFavourite, loadFavourites, clearAllEvents } from './EventDatabase';

// Set app name before ready so OS notifications show "OnlyCat" not "Electron"
app.setName('OnlyCat');

// Fix taskbar WM class on Linux
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'OnlyCat');
}

const GATEWAY_URL = 'https://gateway.onlycat.com';

let devices: Device[] = [];
let transitPolicies: Map<string, DeviceTransitPolicy[]> = new Map(); // deviceId -> policies
let rfidLastSeenMap: Map<string, RfidLastSeen[]> = new Map(); // deviceId -> last seen entries
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
  // Backfill catName from local RFID cache for events loaded from DB
  const rfidCache = settingsStore.getRfidCache();
  for (let i = 0; i < cachedEvents.length; i++) {
    const e = cachedEvents[i];
    if (!e.catName && e.rfidCodes?.length) {
      const names = e.rfidCodes
        .map(code => rfidCache[code])
        .filter((n): n is string => !!n);
      if (names.length) {
        cachedEvents[i] = { ...e, catName: [...new Set(names)].join(' & ') };
      }
    }
  }
  eventsCached = true;
  await setMeta('lastRun', new Date().toISOString());
  console.log(`fetchAllEvents: total cached events = ${cachedEvents.length}`);
  if (cachedEvents.length > 0) trayManager.setLastEvent(cachedEvents[0]);
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

async function fetchRfidLastSeen(): Promise<void> {
  for (const device of devices) {
    try {
      const lastSeen = await gatewayClient.request('getLastSeenRfidCodesByDevice', {
        deviceId: device.deviceId,
      }) as RfidLastSeen[];
      rfidLastSeenMap.set(device.deviceId, lastSeen);

      // Pre-populate RFID → cat name cache from last seen data
      for (const entry of lastSeen) {
        if (!settingsStore.getCatName(entry.rfidCode)) {
          try {
            const profile = await gatewayClient.request('getRfidProfile', {
              rfidCode: entry.rfidCode,
              deviceId: device.deviceId,
            }) as { label?: string };
            if (profile?.label) {
              settingsStore.setCatName(entry.rfidCode, profile.label);
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      // skip
    }
  }
  trayManager.setRfidLastSeen(rfidLastSeenMap, settingsStore.getRfidCache(), () => cachedEvents, settingsStore.ignoredRfids);
  // Update activity window with new RFID cache if open
  const activityWin = windowManager.getActivityWindow();
  if (activityWin) {
    activityWin.webContents.send(IPC_CHANNELS.KNOWN_RFIDS, settingsStore.getRfidCache());
  }
}

// Telemetry polling
let telemetryInterval: ReturnType<typeof setInterval> | null = null;
const TELEMETRY_METRICS = ['wifi_rssi', 'vbat', 'vbus', 'tcpu', 'uptime', 'free_storage', 'vcc', 'ibat', 'tbat', 'free_heap'];

async function fetchTelemetry(): Promise<void> {
  for (const device of devices) {
    try {
      const result = await gatewayClient.request('getDeviceTelemetryMetrics', {
        deviceId: device.deviceId,
      }) as Array<{ time: string; measureName: string; value: number }>;

      if (Array.isArray(result)) {
        const points = result
          .filter(r => TELEMETRY_METRICS.includes(r.measureName))
          .map(r => ({
            timestamp: r.time,
            deviceId: device.deviceId,
            measureName: r.measureName,
            value: r.value,
          }));
        if (points.length > 0) {
          await saveTelemetry(points);
        }
      }
    } catch {
      // skip
    }
  }
  // Prune old data (keep 30 days)
  await pruneTelemetry(30);

  // Start hourly polling if not already running
  if (!telemetryInterval) {
    telemetryInterval = setInterval(() => {
      fetchTelemetry().catch(console.error);
    }, 60 * 60 * 1000); // every hour
  }
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
    autoStartEnabled: settingsStore.autoStart,
    onToggleAutoStart: () => {
      const newVal = !settingsStore.autoStart;
      settingsStore.autoStart = newVal;
      app.setLoginItemSettings({ openAtLogin: newVal });
      trayManager.setAutoStart(newVal);
    },
    onTelemetryClick: () => windowManager.openTelemetryWindow(),
    onTestNotification: () => {},
  });

  // Sync auto-start setting with OS
  app.setLoginItemSettings({ openAtLogin: settingsStore.autoStart });

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
        fetchRfidLastSeen().catch(console.error);
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
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  devices = [];
  cachedEvents = [];
  eventsCached = false;
  clearAllEvents().catch(console.error);
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
    // Re-subscribe to devices
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
        await fetchRfidLastSeen();
        // Fetch initial telemetry and start hourly polling
        fetchTelemetry().catch(console.error);
        // Load cached events from DB for fast UI
        if (!eventsCached) {
          loadAllEvents().then(stored => {
            if (stored.length > 0) {
              cachedEvents = stored;
              eventsCached = true;
              trayManager.setLastEvent(cachedEvents[0]);
            }
          }).catch(console.error);
        }
      })
      .catch((err) => console.error('getDevices (reconnect) failed', err));

    // Re-subscribe to events — ensures live updates continue after reconnect
    gatewayClient.request('getEvents', { subscribe: true })
      .then(() => console.log('Re-subscribed to events'))
      .catch((err) => console.error('getEvents re-subscribe failed', err));
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

  const isInitialLoad = !payload.beforeGlobalId;

  // On initial load, send cached events immediately for instant UI
  if (isInitialLoad && cachedEvents.length > 0) {
    // Sort by globalId descending to ensure newest events are first
    cachedEvents.sort((a, b) => b.globalId - a.globalId);
    activityWin.webContents.send(IPC_CHANNELS.EVENTS_LIST, cachedEvents);
    activityWin.webContents.send(IPC_CHANNELS.KNOWN_RFIDS, settingsStore.getRfidCache());
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const allFetched: DeviceEvent[] = [];
  // On initial load with cache, start from the newest cached event to only fetch new ones
  const newestCachedId = isInitialLoad && cachedEvents.length > 0
    ? Math.max(...cachedEvents.map(e => e.globalId))
    : undefined;
  let cursor: number | undefined = payload.beforeGlobalId;
  let summariesBackfilled = false;

  try {
    // Fetch pages until we have 3 days of data (initial) or one page (load more)
    while (true) {
      const requestPayload = cursor
        ? { beforeGlobalId: cursor }
        : { subscribe: true };

      const page = await gatewayClient.request('getEvents', requestPayload) as DeviceEvent[];
      if (!page?.length) break;

      const enriched = await Promise.all(page.map(async (e) => {
        // Check if we already have this event cached with summary data
        const cached = cachedEvents.find(c => c.globalId === e.globalId);
        if (cached?.summary) return cached;

        const normalized = normalizeEvent(e, devices);
        const catName = await getCatName(normalized);
        let summary: string | undefined;
        let subevents: DeviceEvent['subevents'];
        if (normalized.accessToken) {
          try {
            const summaryResult = await gatewayClient.request('getEventSummary', {
              deviceId: normalized.deviceId,
              eventId: normalized.eventId,
              accessToken: normalized.accessToken,
              subscribe: true,
            }) as { subevents?: Array<{ startFrameIndex: number; endFrameIndex: number; direction: string; action: string; rfidCode: string | null }> } | null;
            if (summaryResult?.subevents?.length) {
              const parts = summaryResult.subevents.map(s => formatSubevent(s.direction, s.action));
              summary = parts[parts.length - 1];
              subevents = summaryResult.subevents;
            }
          } catch { /* skip */ }
        }
        const enrichedEvent = { ...normalized, ...(catName ? { catName } : {}), ...(summary ? { summary, subevents } : {}) };

        return enrichedEvent;
      }));

      allFetched.push(...enriched);
      cursor = page[page.length - 1].globalId;

      // On initial load, keep fetching until we have 1 day of data
      if (isInitialLoad) {
        // If we have a cache and the page overlaps, backfill summaries but keep going
        // to fill any gaps in the cache
        if (newestCachedId && page.some(e => e.globalId <= newestCachedId)) {
          for (const fetched of allFetched) {
            if (!fetched.summary) continue;
            const idx = cachedEvents.findIndex(c => c.globalId === fetched.globalId);
            if (idx !== -1 && !cachedEvents[idx].summary) {
              cachedEvents[idx] = { ...cachedEvents[idx], summary: fetched.summary, subevents: fetched.subevents };
              summariesBackfilled = true;
            }
          }
        }
        const oldestTimestamp = enriched[enriched.length - 1]?.createdAt ?? enriched[enriched.length - 1]?.timestamp;
        if (oldestTimestamp && oldestTimestamp < oneDayAgo) break;
        if (page.length < 20) break;
        await new Promise(r => setTimeout(r, 200)); // throttle
      } else {
        break; // Load More just fetches one page
      }
    }

    // Filter out events we already have in cache
    // (handled below in the dedup section)

    // Cache to SQLite
    if (allFetched.length) saveEvents(allFetched).catch(console.error);

    // Add to in-memory cache (dedup by globalId), and update stale entries that now have summaries
    const existingIds = new Set(cachedEvents.map(e => e.globalId));
    const newEvents = allFetched.filter(e => !existingIds.has(e.globalId));
    // Update existing cached events that were missing summaries but now have them
    let summariesUpdated = false;
    for (const fetched of allFetched) {
      if (!fetched.summary) continue;
      const idx = cachedEvents.findIndex(c => c.globalId === fetched.globalId);
      if (idx !== -1 && !cachedEvents[idx].summary) {
        cachedEvents[idx] = { ...cachedEvents[idx], summary: fetched.summary, subevents: fetched.subevents };
        summariesUpdated = true;
      }
    }
    cachedEvents = [...cachedEvents, ...newEvents];
    eventsCached = true;

    if (payload.beforeGlobalId) {
      if (allFetched.length > 0) {
        activityWin.webContents.send(IPC_CHANNELS.EVENTS_LOAD_MORE_RESULT, allFetched);
      }
    } else if (isInitialLoad && cachedEvents.length > 0 && allFetched.length > 0) {
      // Had cache, fetched new events — prepend each new one
      for (const event of allFetched.reverse()) {
        activityWin.webContents.send(IPC_CHANNELS.EVENTS_PREPEND, event);
      }
    } else if (!isInitialLoad || cachedEvents.length === 0) {
      activityWin.webContents.send(IPC_CHANNELS.EVENTS_LIST, allFetched);
    }
    // If we had cache and no new events, do nothing — cached events already shown
    // But if summaries were updated on existing events, re-send the full list so the renderer picks them up
    // If summaries were updated on existing events during initial load, re-send the full list
    if ((summariesUpdated || summariesBackfilled) && isInitialLoad) {
      cachedEvents.sort((a, b) => b.globalId - a.globalId);
      activityWin.webContents.send(IPC_CHANNELS.EVENTS_LIST, cachedEvents);
      // Persist updated summaries to SQLite
      const updatedEvents = cachedEvents.filter(e => e.summary);
      if (updatedEvents.length) saveEvents(updatedEvents).catch(console.error);
    }
    activityWin.webContents.send(IPC_CHANNELS.KNOWN_RFIDS, settingsStore.getRfidCache());
  } catch (err) {
    console.error('getEvents failed', err);
  }
});

gatewayClient.on('userEventUpdate', async (data: { type: string; body: DeviceEvent }) => {
  try {
    if (data.type !== 'create') return;
    const ns = settingsStore.notificationSettings;

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
    const shouldNotify = ns.classifications.includes(cls) && !(ns.videoOnly && enriched.posterFrameIndex == null);

    let passedSummaryFilter = true;
    if (shouldNotify) {
      // Apply summary filters
      const lastSub = enriched.subevents?.[enriched.subevents.length - 1];
      if (lastSub) {
        if (ns.directions.length < 2 && !ns.directions.includes(lastSub.direction)) passedSummaryFilter = false;
        if (ns.actions.length < 3 && !ns.actions.includes(lastSub.action)) passedSummaryFilter = false;
      } else if (!ns.showNoSummary) {
        passedSummaryFilter = false;
      }
    }

    cacheEvent(enriched);
    trayManager.setLastEvent(enriched);

    if (shouldNotify && passedSummaryFilter) {
      trayManager.setUnacknowledgedEvent(enriched);
      notificationManager.notify(enriched, deviceName, catName);
    }

    const activityWin = windowManager.getActivityWindow();
    if (activityWin) {
      activityWin.webContents.send(IPC_CHANNELS.EVENTS_PREPEND, enriched);
      activityWin.webContents.send(IPC_CHANNELS.KNOWN_RFIDS, settingsStore.getRfidCache());
    }

    // Schedule summary re-fetches after the event has had time to finish processing
    if (enriched.accessToken) {
      const eid = enriched.deviceId;
      const evId = enriched.eventId;
      for (const delay of [15000, 30000, 60000]) {
        setTimeout(() => {
          refreshEventSummary(eid, evId);
        }, delay);
      }
    }

    // Update RFID last-seen in tray menu with this event's data
    const rfidCodes = enriched.rfidCodes ?? enriched.subevents?.map(s => s.rfidCode).filter((c): c is string => !!c) ?? [];
    if (rfidCodes.length > 0) {
      const deviceEntries = rfidLastSeenMap.get(enriched.deviceId) ?? [];
      for (const rfidCode of rfidCodes) {
        const lastSub = enriched.subevents?.filter(s => s.rfidCode === rfidCode).pop() ?? null;
        const existingIdx = deviceEntries.findIndex(e => e.rfidCode === rfidCode);
        const entry: RfidLastSeen = {
          deviceId: enriched.deviceId,
          rfidCode,
          eventId: enriched.eventId,
          timestamp: enriched.createdAt ?? enriched.timestamp ?? null,
          lastSubevent: lastSub,
        };
        if (existingIdx !== -1) {
          deviceEntries[existingIdx] = entry;
        } else {
          deviceEntries.push(entry);
        }
      }
      rfidLastSeenMap.set(enriched.deviceId, deviceEntries);
      trayManager.setRfidLastSeen(rfidLastSeenMap, settingsStore.getRfidCache(), () => cachedEvents, settingsStore.ignoredRfids);
    }
  } catch (err) {
    console.error('userEventUpdate handler error:', err);
  }
});

// Favourite toggle
ipcMain.handle('event:toggle-favourite', async (_e, globalId: number) => {
  const isFav = await toggleFavourite(globalId);
  // Update in-memory cache
  cachedEvents = cachedEvents.map(e => e.globalId === globalId ? { ...e, favourite: isFav } : e);
  return isFav;
});

// Token management IPC
ipcMain.handle('settings:get-token', () => tokenStore.load());
ipcMain.handle('settings:update-token', async (_e, token: string) => {
  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    const onConnected = () => {
      cleanup();
      tokenStore.save(token);
      // Clear old cache since it belongs to a different account
      cachedEvents = [];
      eventsCached = false;
      clearAllEvents().catch(console.error);
      trayManager.setConnectionState('connected');
      resolve({ success: true });
    };
    const onConnectError = (error: Error) => {
      cleanup();
      resolve({ success: false, error: error?.message ?? 'Authentication failed' });
    };
    const cleanup = () => {
      gatewayClient.off('connected', onConnected);
      gatewayClient.off('connect_error', onConnectError);
    };
    gatewayClient.once('connected', onConnected);
    gatewayClient.once('connect_error', onConnectError);
    gatewayClient.connect(token);
  });
});

// Notification settings IPC
ipcMain.handle('notification-settings:get', () => settingsStore.notificationSettings);
ipcMain.handle('notification-settings:save', (_e, settings) => {
  settingsStore.notificationSettings = settings;
});
ipcMain.on('notification-settings:close', () => windowManager.closeNotificationSettings());

// Auto-start IPC
ipcMain.handle('settings:get-auto-start', () => settingsStore.autoStart);
ipcMain.handle('settings:set-auto-start', (_e, enabled: boolean) => {
  settingsStore.autoStart = enabled;
  app.setLoginItemSettings({ openAtLogin: enabled });
  trayManager.setAutoStart(enabled);
});

// Ignored RFIDs IPC
ipcMain.handle('settings:get-known-rfids', () => {
  // Merge RFID name cache with any RFIDs from last-seen that don't have names
  const named = settingsStore.getRfidCache();
  const all: Record<string, string> = { ...named };
  for (const [, entries] of rfidLastSeenMap) {
    for (const entry of entries) {
      if (!all[entry.rfidCode]) {
        all[entry.rfidCode] = ''; // empty string = no name known
      }
    }
  }
  return all;
});
ipcMain.handle('settings:get-ignored-rfids', () => settingsStore.ignoredRfids);
ipcMain.handle('settings:set-ignored-rfids', (_e, rfids: string[]) => {
  settingsStore.ignoredRfids = rfids;
  // Rebuild tray menu to reflect the change
  trayManager.setRfidLastSeen(rfidLastSeenMap, settingsStore.getRfidCache(), () => cachedEvents, settingsStore.ignoredRfids);
});

// Test notification IPC
ipcMain.handle('settings:test-notification', async () => {
  try {
    const result = await gatewayClient.request('getEvents', {}) as DeviceEvent[];
    if (result?.length) {
      const event = normalizeEvent(result[0], devices);
      const catName = await getCatName(event);
      let enriched = catName ? { ...event, catName } : event;
      if (event.accessToken) {
        try {
          const summaryResult = await gatewayClient.request('getEventSummary', {
            deviceId: event.deviceId,
            eventId: event.eventId,
            accessToken: event.accessToken,
            subscribe: true,
          }) as { subevents?: Array<{ startFrameIndex: number; endFrameIndex: number; direction: string; action: string; rfidCode: string | null }> } | null;
          if (summaryResult?.subevents?.length) {
            const parts = summaryResult.subevents.map(s => formatSubevent(s.direction, s.action));
            enriched = { ...enriched, summary: parts[parts.length - 1], subevents: summaryResult.subevents };
          }
        } catch { /* skip */ }
      }
      await notificationManager.notify(enriched, enriched.deviceName ?? enriched.deviceId, catName);
    }
  } catch (err) {
    console.error('test notification failed', err);
  }
});

// Copy URL to clipboard
ipcMain.on('copy:url', (_event, payload: { url: string }) => {
  clipboard.writeText(payload.url);
});

// Telemetry IPC handlers
ipcMain.handle('telemetry:get', async (_event, measureName: string, range: string) => {
  if (devices.length === 0) return [];
  const since = (() => {
    const now = Date.now();
    switch (range) {
      case '24h': return new Date(now - 24 * 60 * 60 * 1000).toISOString();
      case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      default: return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    }
  })();
  return getTelemetry(devices[0].deviceId, measureName, since);
});

ipcMain.handle('telemetry:get-latest', async () => {
  if (devices.length === 0) return [];
  return getLatestTelemetry(devices[0].deviceId);
});

// Export events to CSV
ipcMain.handle('events:export', async (_event, events: DeviceEvent[]) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Events',
    defaultPath: `onlycat-events-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [
      { name: 'CSV', extensions: ['csv'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (canceled || !filePath) return false;

  const header = 'Date,Time,Device,Cat Name,Classification,Direction,Action,Summary,Event ID,Video URL';
  const rows = events.map(e => {
    const dt = e.createdAt ?? e.timestamp ?? '';
    let date = '';
    let time = '';
    if (dt) {
      try {
        const d = new Date(dt);
        date = d.toLocaleDateString('en-GB');
        time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      } catch { /* skip */ }
    }
    const lastSub = e.subevents?.[e.subevents.length - 1];
    const direction = lastSub?.direction ?? '';
    const action = lastSub?.action ?? '';
    const cls = classificationLabel(e.eventClassification);

    return [
      date,
      time,
      csvEscape(e.deviceName ?? e.deviceId),
      csvEscape(e.catName ?? ''),
      csvEscape(cls),
      direction,
      action,
      csvEscape(e.summary ?? ''),
      e.eventId,
      csvEscape(e.videoUrl ?? ''),
    ].join(',');
  });

  const csv = [header, ...rows].join('\n');
  const fs = require('fs');
  fs.writeFileSync(filePath, csv, 'utf8');
  return true;
});

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

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

// Track recent events for summary refresh — keyed by "deviceId/eventId"
const pendingSummaryRefresh: Map<string, ReturnType<typeof setTimeout>> = new Map();
const SUMMARY_SETTLE_DELAY = 10000; // wait 10s after last update before re-fetching summary

async function refreshEventSummary(deviceId: string, eventId: number): Promise<void> {
  const cached = cachedEvents.find(e => e.deviceId === deviceId && e.eventId === eventId);
  if (!cached?.accessToken) return;

  try {
    const result = await gatewayClient.request('getEventSummary', {
      deviceId,
      eventId,
      accessToken: cached.accessToken,
      subscribe: true,
    }) as { subevents?: Array<{ startFrameIndex: number; endFrameIndex: number; direction: string; action: string; rfidCode: string | null }> } | null;

    if (result?.subevents?.length) {
      const parts = result.subevents.map(s => formatSubevent(s.direction, s.action));
      const summary = parts[parts.length - 1];
      const subevents = result.subevents;

      const idx = cachedEvents.findIndex(e => e.deviceId === deviceId && e.eventId === eventId);
      if (idx !== -1) {
        // Skip if summary hasn't changed
        if (cachedEvents[idx].summary === summary) {
          return;
        }
        cachedEvents[idx] = { ...cachedEvents[idx], summary, subevents };
        saveEvents([cachedEvents[idx]]).catch(console.error);

        // Update RFID last-seen in tray with refreshed subevent data
        const rfidCodes = subevents.map(s => s.rfidCode).filter((c): c is string => !!c);
        if (rfidCodes.length > 0) {
          const deviceEntries = rfidLastSeenMap.get(deviceId) ?? [];
          for (const rfidCode of rfidCodes) {
            const lastSub = subevents.filter(s => s.rfidCode === rfidCode).pop() ?? null;
            const existingIdx = deviceEntries.findIndex(e => e.rfidCode === rfidCode);
            const entry: RfidLastSeen = {
              deviceId,
              rfidCode,
              eventId,
              timestamp: cached.createdAt ?? cached.timestamp ?? null,
              lastSubevent: lastSub,
            };
            if (existingIdx !== -1) {
              deviceEntries[existingIdx] = entry;
            } else {
              deviceEntries.push(entry);
            }
          }
          rfidLastSeenMap.set(deviceId, deviceEntries);
          trayManager.setRfidLastSeen(rfidLastSeenMap, settingsStore.getRfidCache(), () => cachedEvents, settingsStore.ignoredRfids);
        }

        const activityWin = windowManager.getActivityWindow();
        if (activityWin) {
          cachedEvents.sort((a, b) => b.globalId - a.globalId);
          activityWin.webContents.send(IPC_CHANNELS.EVENTS_LIST, cachedEvents);
        }
      }
    } else {
      // No subevents returned
    }
  } catch {
    // skip
  }
}

gatewayClient.on('eventUpdate', (data: { type: string; deviceId: string; eventId: number; body: Partial<DeviceEvent> }) => {
  if (data.type !== 'update') return;

  // Video window forwarding
  if (currentVideoEvent && data.deviceId === currentVideoEvent.deviceId && data.eventId === currentVideoEvent.eventId) {
    const videoWin = windowManager.getVideoWindow();
    if (videoWin) {
      videoWin.webContents.send(IPC_CHANNELS.VIDEO_EVENT_UPDATE, {
        ...data.body, deviceId: data.deviceId, eventId: data.eventId,
      });
    }
  }

  // Summary refresh — debounce: reset timer on each update, fetch once updates settle
  const key = `${data.deviceId}/${data.eventId}`;
  const existing = pendingSummaryRefresh.get(key);
  if (existing) clearTimeout(existing);

  pendingSummaryRefresh.set(key, setTimeout(() => {
    pendingSummaryRefresh.delete(key);
    refreshEventSummary(data.deviceId, data.eventId);
  }, SUMMARY_SETTLE_DELAY));
});

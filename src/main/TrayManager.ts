import { Tray, Menu, nativeImage, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import type { Device, DeviceEvent, ConnectionState, RfidLastSeen } from '../shared/types';
import { formatSubevent } from '../shared/eventLabels';

type OnActivityClick = () => void;
type OnSignOutClick = () => void;
type OnUnacknowledgedClick = (event: DeviceEvent) => void;
type OnTestNotification = () => void;
type OnToggleVideoOnly = () => void;
type OnCheckUpdate = () => void;
type OnActivatePolicy = (deviceId: string, policyId: number) => void;
type OnCheckNotificationSettings = () => void;

class TrayManager {
  private tray: Tray | null = null;
  private devices: Device[] = [];
  private connectionState: ConnectionState = 'disconnected';
  private unacknowledgedEvent: DeviceEvent | null = null;

  private onActivityClick: OnActivityClick = () => {};
  private onSignOutClick: OnSignOutClick = () => {};
  private onUnacknowledgedClick: OnUnacknowledgedClick = () => {};
  private onTestNotification: OnTestNotification = () => {};
  private onToggleVideoOnly: OnToggleVideoOnly = () => {};
  private onCheckUpdate: OnCheckUpdate = () => {};
  private onActivatePolicy: OnActivatePolicy = () => {};
  private onCheckNotificationSettings: OnCheckNotificationSettings = () => {};
  private onTelemetryClick: () => void = () => {};
  private notifyOnVideoOnly: boolean = true;
  private updateAvailableVersion: string | null = null;
  private transitPolicies: Map<string, import('../shared/types').DeviceTransitPolicy[]> = new Map();
  private lastEvent: DeviceEvent | null = null;
  private autoStartEnabled: boolean = false;
  private onToggleAutoStart: () => void = () => {};
  private rfidLastSeen: Map<string, RfidLastSeen[]> = new Map();
  private rfidNameCache: Record<string, string> = {};
  private getCachedEvents: () => DeviceEvent[] = () => [];
  private ignoredRfids: Set<string> = new Set();

  init(callbacks: {
    onActivityClick: OnActivityClick;
    onSignOutClick: OnSignOutClick;
    onUnacknowledgedClick: OnUnacknowledgedClick;
    onTestNotification: OnTestNotification;
    onToggleVideoOnly: OnToggleVideoOnly;
    onCheckUpdate: OnCheckUpdate;
    onActivatePolicy: OnActivatePolicy;
    onCheckNotificationSettings: OnCheckNotificationSettings;
    onToggleAutoStart: () => void;
    onTelemetryClick: () => void;
    notifyOnVideoOnly: boolean;
    autoStartEnabled: boolean;
  }): void {
    this.onActivityClick = callbacks.onActivityClick;
    this.onSignOutClick = callbacks.onSignOutClick;
    this.onUnacknowledgedClick = callbacks.onUnacknowledgedClick;
    this.onTestNotification = callbacks.onTestNotification;
    this.onToggleVideoOnly = callbacks.onToggleVideoOnly;
    this.onCheckUpdate = callbacks.onCheckUpdate;
    this.onActivatePolicy = callbacks.onActivatePolicy;
    this.onCheckNotificationSettings = callbacks.onCheckNotificationSettings;
    this.onToggleAutoStart = callbacks.onToggleAutoStart;
    this.onTelemetryClick = callbacks.onTelemetryClick;
    this.notifyOnVideoOnly = callbacks.notifyOnVideoOnly;
    this.autoStartEnabled = callbacks.autoStartEnabled;

    // Use the cat icon from assets
    const iconPath = path.join(__dirname, '../../../assets/icon-256.png');
    const icon = nativeImage.createFromPath(iconPath);
    this.tray = new Tray(icon);
    this.tray.setToolTip('OnlyCat');
    this.rebuild();
  }

  setTransitPolicies(policies: Map<string, import('../shared/types').DeviceTransitPolicy[]>, devices: Device[]): void {
    this.transitPolicies = policies;
    this.devices = devices;
    this.rebuild();
  }

  setUpdateAvailable(version: string): void {
    this.updateAvailableVersion = version;
    this.rebuild();
  }

  private missedCount: number = 0;

  setNotifyOnVideoOnly(value: boolean): void {
    this.notifyOnVideoOnly = value;
    this.rebuild();
  }

  setDevices(devices: Device[]): void {
    this.devices = devices;
    this.rebuild();
  }

  setConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    this.rebuild();
  }

  setUnacknowledgedEvent(event: DeviceEvent | null): void {
    if (event) {
      this.missedCount++;
    } else {
      this.missedCount = 0;
    }
    this.unacknowledgedEvent = event;
    this.rebuild();
  }

  setLastEvent(event: DeviceEvent): void {
    this.lastEvent = event;
    this.rebuild();
  }

  setAutoStart(enabled: boolean): void {
    this.autoStartEnabled = enabled;
    this.rebuild();
  }

  setRfidLastSeen(lastSeen: Map<string, RfidLastSeen[]>, rfidNames: Record<string, string>, getEvents: () => DeviceEvent[], ignored?: string[]): void {
    this.rfidLastSeen = lastSeen;
    this.rfidNameCache = rfidNames;
    this.getCachedEvents = getEvents;
    if (ignored) this.ignoredRfids = new Set(ignored);
    this.rebuild();
  }

  buildMenuTemplate(): MenuItemConstructorOptions[] {
    const template: MenuItemConstructorOptions[] = [];

    // Connection status header — only show when not connected
    if (this.connectionState !== 'connected') {
      const statusLabel = this.connectionState === 'reconnecting'
        ? '↻ Reconnecting...'
        : '○ Disconnected';
      template.push({ label: statusLabel, enabled: false });
      template.push({ type: 'separator' });
    }

    // Unacknowledged event banner
    if (this.unacknowledgedEvent) {
      const ev = this.unacknowledgedEvent;
      template.push({
        label: `▶ View missed event — ${ev.deviceName ?? ev.deviceId}`,
        click: () => this.onUnacknowledgedClick(ev),
      });
      template.push({ type: 'separator' });
    }

    // Device list
    if (this.devices.length === 0) {
      template.push({ label: 'No devices', enabled: false });
    } else {
      for (const device of this.devices) {
        const name = device.name ?? device.description ?? device.deviceId;
        const connected = device.connectivity?.connected ?? device.online;
        const status = connected ? '🟢' : '🔴';
        template.push({ label: `${status} ${name}`, enabled: false });

        if (device.connectivity?.timestamp) {
          const since = new Date(device.connectivity.timestamp).toLocaleString();
          const label = connected ? `   Online since ${since}` : `   Offline since ${since}`;
          template.push({ label, enabled: false });
        }

        // Show last-seen cats for this device (excluding ignored)
        const lastSeenEntries = (this.rfidLastSeen.get(device.deviceId) ?? [])
          .filter(entry => !this.ignoredRfids.has(entry.rfidCode));
        for (const entry of lastSeenEntries) {
          const catName = this.rfidNameCache[entry.rfidCode] ?? entry.rfidCode;
          // Try to get subevent detail from cached events
          let summary = '';
          if (entry.lastSubevent) {
            summary = formatSubevent(entry.lastSubevent.direction, entry.lastSubevent.action);
          } else {
            // Look up the event in our cache and find the subevent for this RFID
            const cachedEvent = this.getCachedEvents().find(
              e => e.deviceId === entry.deviceId && e.eventId === entry.eventId
            );
            if (cachedEvent?.subevents?.length) {
              // Find the last subevent matching this RFID code
              const matching = cachedEvent.subevents.filter(s => s.rfidCode === entry.rfidCode);
              const lastSub = matching.length > 0 ? matching[matching.length - 1] : cachedEvent.subevents[cachedEvent.subevents.length - 1];
              if (lastSub) {
                summary = formatSubevent(lastSub.direction, lastSub.action);
              }
            }
          }
          const ts = entry.timestamp ?? entry.eventTimestamp;
          const time = ts ? this.timeAgo(new Date(ts)) : '';
          const eventDeviceId = entry.deviceId;
          const eventId = entry.eventId;
          template.push({
            label: `   🐱 ${catName}${summary ? ' ' + summary : ''}${time ? ' — ' + time : ''}`,
            click: () => this.onUnacknowledgedClick({ globalId: 0, eventId: eventId, deviceId: eventDeviceId } as DeviceEvent),
          });
        }
      }
    }

    template.push({ type: 'separator' });
    template.push({ label: 'View Recent Activity', click: () => this.onActivityClick() });
    template.push({ label: 'Device Health', click: () => this.onTelemetryClick() });

    // Door Policy section
    if (this.transitPolicies.size > 0) {
      template.push({ type: 'separator' });
      template.push({ label: 'Door Policy', enabled: false });

      for (const device of this.devices) {
        const policies = this.transitPolicies.get(device.deviceId) ?? [];
        if (!policies.length) continue;

        const deviceName = device.name ?? device.description ?? device.deviceId;
        if (this.devices.length > 1) {
          template.push({ label: `  ${deviceName}`, enabled: false });
        }

        for (const policy of policies) {
          const isActive = device.deviceTransitPolicyId === policy.deviceTransitPolicyId;
          const label = policy.name ?? policy.description ?? `Policy ${policy.deviceTransitPolicyId}`;
          template.push({
            label: `  ${isActive ? '✓ ' : '    '}${label}`,
            click: isActive ? undefined : () => this.onActivatePolicy(device.deviceId, policy.deviceTransitPolicyId),
            enabled: !isActive,
          });
        }
      }
    }    template.push({ type: 'separator' });
    template.push({
      label: `⚙ Settings`,
      click: () => this.onCheckNotificationSettings(),
    });
    template.push({ type: 'separator' });
    if (this.updateAvailableVersion) {
      template.push({
        label: `🆕 Update available: v${this.updateAvailableVersion}`,
        click: () => this.onCheckUpdate(),
      });
    } else {
      template.push({ label: 'Check for Updates', click: () => this.onCheckUpdate() });
    }
    template.push({ type: 'separator' });
    template.push({ label: 'Sign Out', click: () => this.onSignOutClick() });
    template.push({ label: 'Quit', click: () => process.exit(0) });

    return template;
  }

  private rebuild(): void {
    if (!this.tray) return;
    const menu = Menu.buildFromTemplate(this.buildMenuTemplate());
    this.tray.setContextMenu(menu);
    this.tray.setToolTip(this.buildTooltip());
    this.updateIcon();
  }

  private updateIcon(): void {
    if (!this.tray) return;
    const iconPath = path.join(__dirname, '../../../assets/icon-256.png');

    if (this.missedCount <= 0) {
      this.tray.setImage(nativeImage.createFromPath(iconPath));
      return;
    }

    // Generate badged icon using SVG overlay via sharp
    // Use platform-appropriate icon size: Windows tray needs small icons
    const iconSize = process.platform === 'win32' ? 32 : 256;
    const badgeRatio = 0.375; // badge takes up 3/8 of icon
    const badgeSize = Math.round(iconSize * badgeRatio);
    const fontSize = Math.round(badgeSize * 0.6);

    try {
      const sharp = require('sharp');
      const count = this.missedCount > 99 ? '99+' : String(this.missedCount);
      const adjustedFontSize = count.length > 2 ? Math.round(fontSize * 0.7) : count.length > 1 ? Math.round(fontSize * 0.85) : fontSize;
      const badgeSvg = `
        <svg width="${badgeSize}" height="${badgeSize}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${badgeSize/2}" cy="${badgeSize/2}" r="${badgeSize/2}" fill="#ef5350"/>
          <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
            font-family="Arial, sans-serif" font-size="${adjustedFontSize}" font-weight="bold" fill="white">${count}</text>
        </svg>`;

      sharp(iconPath)
        .resize(iconSize, iconSize)
        .composite([{
          input: Buffer.from(badgeSvg),
          top: iconSize - badgeSize,
          left: iconSize - badgeSize,
        }])
        .png()
        .toBuffer()
        .then((buf: Buffer) => {
          if (this.tray) this.tray.setImage(nativeImage.createFromBuffer(buf, { scaleFactor: process.platform === 'win32' ? 1.0 : 2.0 }));
        })
        .catch(() => {
          // sharp compositing failed — fall back to plain icon
          if (this.tray) this.tray.setImage(nativeImage.createFromPath(iconPath));
        });
    } catch {
      // sharp not available — fall back to plain icon
      this.tray.setImage(nativeImage.createFromPath(iconPath));
    }
  }

  private buildTooltip(): string {
    const lines: string[] = ['OnlyCat'];

    if (this.lastEvent) {
      const name = this.lastEvent.catName ?? this.lastEvent.deviceName ?? this.lastEvent.deviceId;
      const summary = this.lastEvent.summary ?? '';
      const time = this.lastEvent.createdAt
        ? this.timeAgo(new Date(this.lastEvent.createdAt))
        : '';
      lines.push(`Last: ${name} ${summary}${time ? ` — ${time}` : ''}`);
    }

    if (this.devices.length > 0) {
      for (const d of this.devices) {
        const name = d.name ?? d.description ?? d.deviceId;
        const connected = d.connectivity?.connected ?? d.online;
        lines.push(`${connected ? '🟢' : '🔴'} ${name}`);
      }
    }

    return lines.join('\n');
  }

  private timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

export default new TrayManager();

import { Tray, Menu, nativeImage, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import type { Device, DeviceEvent, ConnectionState } from '../shared/types';

type OnActivityClick = () => void;
type OnSignOutClick = () => void;
type OnUnacknowledgedClick = (event: DeviceEvent) => void;
type OnTestNotification = () => void;
type OnToggleVideoOnly = () => void;
type OnCheckUpdate = () => void;

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
  private notifyOnVideoOnly: boolean = true;
  private updateAvailableVersion: string | null = null;

  init(callbacks: {
    onActivityClick: OnActivityClick;
    onSignOutClick: OnSignOutClick;
    onUnacknowledgedClick: OnUnacknowledgedClick;
    onTestNotification: OnTestNotification;
    onToggleVideoOnly: OnToggleVideoOnly;
    onCheckUpdate: OnCheckUpdate;
    notifyOnVideoOnly: boolean;
  }): void {
    this.onActivityClick = callbacks.onActivityClick;
    this.onSignOutClick = callbacks.onSignOutClick;
    this.onUnacknowledgedClick = callbacks.onUnacknowledgedClick;
    this.onTestNotification = callbacks.onTestNotification;
    this.onToggleVideoOnly = callbacks.onToggleVideoOnly;
    this.onCheckUpdate = callbacks.onCheckUpdate;
    this.notifyOnVideoOnly = callbacks.notifyOnVideoOnly;

    // Use the cat icon from assets
    const iconPath = path.join(__dirname, '../../../assets/icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    this.tray = new Tray(icon);
    this.tray.setToolTip('OnlyCat');
    this.rebuild();
  }

  setUpdateAvailable(version: string): void {
    this.updateAvailableVersion = version;
    this.rebuild();
  }

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
    this.unacknowledgedEvent = event;
    this.rebuild();
  }

  buildMenuTemplate(): MenuItemConstructorOptions[] {
    const template: MenuItemConstructorOptions[] = [];

    // Connection status header
    const statusLabel =
      this.connectionState === 'connected'
        ? '● Connected'
        : this.connectionState === 'reconnecting'
        ? '↻ Reconnecting...'
        : '○ Disconnected';

    template.push({ label: statusLabel, enabled: false });
    template.push({ type: 'separator' });

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
      }
    }

    template.push({ type: 'separator' });
    template.push({ label: 'View Recent Activity', click: () => this.onActivityClick() });
    template.push({ type: 'separator' });
    template.push({
      label: `${this.notifyOnVideoOnly ? '✓' : '○'} Notify only on Video Movement`,
      click: () => this.onToggleVideoOnly(),
    });
    template.push({ type: 'separator' });
    template.push({ label: '🔔 Test Notification', click: () => this.onTestNotification() });
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
  }

  private buildTooltip(): string {
    if (this.devices.length === 0) return 'OnlyCat';

    const lines = this.devices.map(d => {
      const name = d.name ?? d.description ?? d.deviceId;
      if (d.connectivity?.timestamp) {
        const since = new Date(d.connectivity.timestamp).toLocaleString();
        const state = d.connectivity.connected ? 'Online' : 'Offline';
        return `${name}: ${state} since ${since}`;
      }
      return `${name}: ${d.connectivity?.connected ? 'Online' : 'Offline'}`;
    });

    return lines.join('\n');
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

export default new TrayManager();

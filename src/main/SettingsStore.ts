import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface NotificationSettings {
  videoOnly: boolean;
  classifications: number[];   // e.g. [0, 1, 3]
  directions: string[];        // e.g. ['INWARD', 'OUTWARD']
  actions: string[];           // e.g. ['TRANSIT', 'PEEK']
  showNoSummary: boolean;
}

interface Settings {
  notifyOnVideoOnly: boolean;  // kept for backward compat
  notifications: NotificationSettings;
  rfidCache: Record<string, string>;
  autoStart: boolean;
}

const DEFAULTS: Settings = {
  notifyOnVideoOnly: true,
  notifications: {
    videoOnly: true,
    classifications: [0, 1, 3],
    directions: ['INWARD', 'OUTWARD'],
    actions: ['TRANSIT', 'PEEK', 'DENY'],
    showNoSummary: true,
  },
  rfidCache: {},
  autoStart: false,
};

class SettingsStore {
  private cache: Settings | null = null;

  private get settingsPath(): string {
    return path.join(app.getPath('userData'), 'settings.json');
  }

  private read(): Settings {
    if (this.cache) return this.cache;
    try {
      if (fs.existsSync(this.settingsPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
        // Merge notifications carefully — add any new default actions/directions not in saved settings
        const savedNotifications = parsed.notifications ?? {};
        const mergedNotifications: NotificationSettings = {
          ...DEFAULTS.notifications,
          ...savedNotifications,
          // Always include any new actions/directions from defaults that aren't in saved settings
          actions: savedNotifications.actions
            ? [...new Set([...savedNotifications.actions, ...DEFAULTS.notifications.actions])]
            : DEFAULTS.notifications.actions,
          directions: savedNotifications.directions
            ? [...new Set([...savedNotifications.directions, ...DEFAULTS.notifications.directions])]
            : DEFAULTS.notifications.directions,
          classifications: savedNotifications.classifications ?? DEFAULTS.notifications.classifications,
        };
        this.cache = {
          ...DEFAULTS,
          ...parsed,
          notifications: mergedNotifications,
        };
        return this.cache!;
      }
    } catch {}
    this.cache = { ...DEFAULTS, notifications: { ...DEFAULTS.notifications }, rfidCache: {} };
    return this.cache;
  }

  private write(settings: Settings): void {
    this.cache = settings;
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  get notifyOnVideoOnly(): boolean {
    return this.read().notifications.videoOnly;
  }

  set notifyOnVideoOnly(value: boolean) {
    const s = this.read();
    s.notifications.videoOnly = value;
    s.notifyOnVideoOnly = value;
    this.write(s);
  }

  get notificationSettings(): NotificationSettings {
    return this.read().notifications;
  }

  set notificationSettings(value: NotificationSettings) {
    const s = this.read();
    s.notifications = value;
    s.notifyOnVideoOnly = value.videoOnly;
    this.write(s);
  }

  getCatName(rfidCode: string): string | undefined {
    return this.read().rfidCache[rfidCode];
  }

  getRfidCache(): Record<string, string> {
    return this.read().rfidCache;
  }

  setCatName(rfidCode: string, name: string): void {
    const settings = this.read();
    settings.rfidCache[rfidCode] = name;
    this.write(settings);
  }

  get autoStart(): boolean {
    return this.read().autoStart;
  }

  set autoStart(value: boolean) {
    const s = this.read();
    s.autoStart = value;
    this.write(s);
  }
}

export default new SettingsStore();

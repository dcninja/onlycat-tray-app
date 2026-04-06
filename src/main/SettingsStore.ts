import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

interface Settings {
  notifyOnVideoOnly: boolean;
  rfidCache: Record<string, string>; // rfidCode -> cat name
}

const DEFAULTS: Settings = { notifyOnVideoOnly: true, rfidCache: {} };

class SettingsStore {
  private cache: Settings | null = null;

  private get settingsPath(): string {
    return path.join(app.getPath('userData'), 'settings.json');
  }

  private read(): Settings {
    if (this.cache) return this.cache;
    try {
      if (fs.existsSync(this.settingsPath)) {
        this.cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) };
        return this.cache!;
      }
    } catch {}
    this.cache = { ...DEFAULTS };
    return this.cache;
  }

  private write(settings: Settings): void {
    this.cache = settings;
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  get notifyOnVideoOnly(): boolean {
    return this.read().notifyOnVideoOnly;
  }

  set notifyOnVideoOnly(value: boolean) {
    this.write({ ...this.read(), notifyOnVideoOnly: value });
  }

  getCatName(rfidCode: string): string | undefined {
    return this.read().rfidCache[rfidCode];
  }

  setCatName(rfidCode: string, name: string): void {
    const settings = this.read();
    settings.rfidCache[rfidCode] = name;
    this.write(settings);
  }
}

export default new SettingsStore();

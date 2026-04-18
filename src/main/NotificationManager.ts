import { Notification } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import type { DeviceEvent } from '../shared/types';
import { classificationLabel } from '../shared/eventLabels';

type OnEventClick = (event: DeviceEvent) => void;

function classificationEmoji(classification?: number): string {
  switch (classification) {
    case 1: return '🟢';
    case 2: return '🔵';
    case 3: return '🔴';
    case 0: return '⚪';
    default: return '';
  }
}

async function downloadToTemp(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const tmpPath = path.join(os.tmpdir(), `onlycat-thumb-${Date.now()}.jpg`);
    const file = fs.createWriteStream(tmpPath);

    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(tmpPath);
      });
    }).on('error', () => {
      fs.unlink(tmpPath, () => {});
      resolve(undefined);
    });
  });
}

class NotificationManager {
  private onEventClick: OnEventClick = () => {};

  init(callbacks: { onEventClick: OnEventClick }): void {
    this.onEventClick = callbacks.onEventClick;
  }

  async notify(event: DeviceEvent, deviceName: string, catName?: string): Promise<void> {
    if (!Notification.isSupported()) {
      console.warn('NotificationManager: OS notifications not supported');
      return;
    }

    const time = event.createdAt
      ? new Date(event.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : '';

    const emoji = classificationEmoji(event.eventClassification);
    const clsLabel = classificationLabel(event.eventClassification);
    const title = emoji
      ? `OnlyCat — ${deviceName}  ${emoji} ${clsLabel}`
      : `OnlyCat — ${deviceName}`;
    const who = catName ? `${catName} was detected` : 'Motion detected';
    const timePart = time ? ` at ${time}` : '';
    const summaryPart = event.summary ? ` · ${event.summary}` : '';
    const body = `${who}${timePart}${summaryPart}`;

    // Download thumbnail for notification icon
    let iconPath: string | undefined;
    if (event.thumbnailUrl) {
      iconPath = await downloadToTemp(event.thumbnailUrl);
    }

    const notification = new Notification({
      title,
      body,
      silent: false,
      ...(iconPath ? { icon: iconPath } : {}),
    });

    notification.on('click', () => {
      this.onEventClick(event);
      // Clean up temp file after click
      if (iconPath) try { fs.unlinkSync(iconPath); } catch {}
    });

    notification.on('close', () => {
      if (iconPath) try { fs.unlinkSync(iconPath); } catch {}
    });

    notification.show();
  }
}

export default new NotificationManager();

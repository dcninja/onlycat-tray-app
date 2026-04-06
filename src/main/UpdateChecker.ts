import { net, shell } from 'electron';
import { app } from 'electron';

const GITHUB_OWNER = 'dcninja';
const GITHUB_REPO = 'onlycat-tray-app';
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseUrl: string;
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  return new Promise((resolve) => {
    const request = net.request({
      url: RELEASES_URL,
      headers: { 'User-Agent': 'onlycat-tray-app' },
    });

    let body = '';

    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try {
          const release = JSON.parse(body);
          const latestVersion = (release.tag_name as string).replace(/^v/, '');
          const currentVersion = app.getVersion();
          const hasUpdate = isNewer(latestVersion, currentVersion);
          resolve({
            hasUpdate,
            latestVersion,
            currentVersion,
            releaseUrl: release.html_url,
          });
        } catch {
          resolve(null);
        }
      });
      response.on('error', () => resolve(null));
    });

    request.on('error', () => resolve(null));
    request.end();
  });
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split('.').map(Number);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

export function openReleasePage(url: string): void {
  shell.openExternal(url);
}

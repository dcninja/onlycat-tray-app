import type { DeviceEvent } from '../../shared/types';
import type { VideoOpenPayload } from '../../shared/ipcChannels';

const videoPlayer = document.getElementById('video-player') as HTMLVideoElement;
const notAvailable = document.getElementById('not-available') as HTMLParagraphElement;
const eventLabel = document.getElementById('event-label') as HTMLSpanElement;

videoPlayer.addEventListener('error', () => {
  console.error('video error:', videoPlayer.error?.code, videoPlayer.error?.message);
});

let currentDeviceId: string | null = null;
let currentEventId: number | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_RETRIES = 6; // 6 retries × 5 seconds = 30 seconds max
let retryCount = 0;

function setVideoUrl(url: string): void {
  notAvailable.hidden = true;
  videoPlayer.hidden = false;
  if (videoPlayer.src !== url) {
    videoPlayer.src = url;
    videoPlayer.load();
    videoPlayer.play().catch(() => {});
  }
}

function showNotAvailable(): void {
  videoPlayer.hidden = true;
  notAvailable.hidden = false;
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  if (retryCount >= MAX_RETRIES) {
    notAvailable.textContent = 'Video is not available for this event.';
    showNotAvailable();
    return;
  }
  if (currentDeviceId !== null && currentEventId !== null) {
    retryCount++;
    retryTimer = setTimeout(() => {
      window.onlycat.requestRetry!(currentDeviceId!, currentEventId!);
    }, 5000);
  }
}

function handleEventData(event: DeviceEvent): void {
  currentDeviceId = event.deviceId;
  currentEventId = event.eventId;

  const name = event.deviceName ?? event.deviceId;
  const type = event.type ?? 'Event';
  eventLabel.textContent = `${name} — ${type}`;

  if (event.videoUrl) {
    setVideoUrl(event.videoUrl);
  } else {
    showNotAvailable();
    scheduleRetry();
  }
}

function handleEventUpdate(event: DeviceEvent): void {
  if (event.deviceId !== currentDeviceId || event.eventId !== currentEventId) return;

  if (event.videoUrl && event.videoUrl !== videoPlayer.src) {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    setVideoUrl(event.videoUrl);
  }
}

// Register IPC listeners
window.onlycat.onEventData!(handleEventData);
window.onlycat.onEventUpdate!(handleEventUpdate);

// Handle being re-used for a new event
window.onlycat.onVideoOpen!((_payload: VideoOpenPayload) => {
  eventLabel.textContent = 'Loading event...';
  videoPlayer.src = '';
  videoPlayer.hidden = false;
  notAvailable.textContent = 'Video not yet available — retrying...';
  notAvailable.hidden = true;
  retryCount = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
});

// Signal to main that we're ready to receive event data
window.onlycat.signalReady!();

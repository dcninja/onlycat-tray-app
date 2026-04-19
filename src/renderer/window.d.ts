import type { DeviceEvent } from '../shared/types';
import type { VideoOpenPayload } from '../shared/ipcChannels';

declare global {
  interface Window {
    onlycat: {
      // token-dialog
      submitToken?: (token: string) => void;
      onConnectError?: (cb: (message: string) => void) => void;
      // activity-window
      loadMore?: (beforeGlobalId?: number) => void;
      openVideo?: (deviceId: string, eventId: number) => void;
      copyUrl?: (url: string) => void;
      toggleFavourite?: (globalId: number) => Promise<boolean>;
      onEventsList?: (cb: (events: DeviceEvent[]) => void) => void;
      onEventsLoadMoreResult?: (cb: (events: DeviceEvent[]) => void) => void;
      onEventPrepend?: (cb: (event: DeviceEvent) => void) => void;
      onKnownRfids?: (cb: (cache: Record<string, string>) => void) => void;
      // video-window
      signalReady?: () => void;
      requestRetry?: (deviceId: string, eventId: number) => void;
      onVideoOpen?: (cb: (payload: VideoOpenPayload) => void) => void;
      onEventData?: (cb: (event: DeviceEvent) => void) => void;
      onEventUpdate?: (cb: (event: DeviceEvent) => void) => void;
      // notification-settings / general settings
      getSettings?: () => Promise<import('../main/SettingsStore').NotificationSettings>;
      saveSettings?: (s: import('../main/SettingsStore').NotificationSettings) => Promise<void>;
      getToken?: () => Promise<string | null>;
      updateToken?: (token: string) => Promise<{ success: boolean; error?: string }>;
      close?: () => void;
    };
  }
}

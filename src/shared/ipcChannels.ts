import type { DeviceEvent } from './types';

// IPC channel name constants
export const IPC_CHANNELS = {
  // renderer → main
  AUTH_SUBMIT_TOKEN: 'auth:submit-token',
  EVENTS_LOAD_MORE: 'events:load-more',
  VIDEO_OPEN: 'video:open',

  // main → renderer
  AUTH_CONNECT_ERROR: 'auth:connect-error',
  EVENTS_LIST: 'events:list',
  EVENTS_PREPEND: 'events:prepend',
  EVENTS_LOAD_MORE_RESULT: 'events:load-more-result',
  VIDEO_EVENT_DATA: 'video:event-data',
  VIDEO_EVENT_UPDATE: 'video:event-update',
} as const;

export type IpcChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// Payload types per channel
export interface AuthSubmitTokenPayload {
  token: string;
}

export interface AuthConnectErrorPayload {
  message: string;
}

export interface EventsLoadMorePayload {
  beforeGlobalId?: number;
}

export interface VideoOpenPayload {
  deviceId: string;
  eventId: number;
}

export type EventsListPayload = DeviceEvent[];
export type EventsPrependPayload = DeviceEvent;
export type EventsLoadMoreResultPayload = DeviceEvent[];
export type VideoEventDataPayload = DeviceEvent;
export type VideoEventUpdatePayload = DeviceEvent;

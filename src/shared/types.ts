export interface Device {
  deviceId: string;
  cursorId: string;
  description?: string;
  name?: string;
  online?: boolean;
  connectivity?: {
    connected: boolean;
    timestamp: number; // Unix ms
  };
}

export interface DeviceEvent {
  globalId: number;
  eventId: number;
  deviceId: string;
  // Real API fields
  timestamp?: string;       // ISO timestamp from API
  accessToken?: string;     // used to build video/thumbnail URLs
  frameCount?: number;
  posterFrameIndex?: number;
  eventClassification?: number;
  eventTriggerSource?: number;
  rfidCodes?: string[];
  deletedAt?: string | null;
  // Derived/display fields
  deviceName?: string;
  catName?: string;
  type?: string;
  createdAt?: string;       // alias for timestamp
  videoUrl?: string;
  thumbnailUrl?: string;
}

export interface LiveUpdate<T> {
  type: 'create' | 'update' | 'delete';
  body: T;
  deviceId?: string;
  eventId?: number;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

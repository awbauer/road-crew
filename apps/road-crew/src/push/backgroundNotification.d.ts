export declare const BACKGROUND_NOTIFICATION_TASK: string;

export interface BackgroundNotificationEvent {
  event: string;
  syncRequestId: string | null;
  ts: number;
}

export declare function readBackgroundNotificationEvents(): Promise<BackgroundNotificationEvent[]>;

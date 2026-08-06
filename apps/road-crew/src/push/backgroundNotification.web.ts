import type { BackgroundNotificationEvent } from "./backgroundNotification";

export const BACKGROUND_NOTIFICATION_TASK = "rc-background-notification";

/** The browser has no background notification task, so there is nothing to read. */
export async function readBackgroundNotificationEvents(): Promise<BackgroundNotificationEvent[]> {
  return [];
}

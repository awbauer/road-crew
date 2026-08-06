import type { ArchivedNotification } from "@road-crew/core";

export const MAX_UPDATE_HISTORY_ITEMS = 2;

/** Keep ordinary notices untouched while bounding local update confirmations. */
export function retainRecentUpdateNotifications(
  archive: Record<string, ArchivedNotification>,
): Record<string, ArchivedNotification> {
  const updates = Object.values(archive)
    .filter((notification) => notification.type === "app-update")
    .sort((a, b) => (Number(b.createdMs) || 0) - (Number(a.createdMs) || 0));
  const retainedIds = new Set(updates.slice(0, MAX_UPDATE_HISTORY_ITEMS).map((notification) => notification.id));
  return Object.fromEntries(
    Object.entries(archive).filter(([id, notification]) => (
      notification.type !== "app-update" || retainedIds.has(id)
    )),
  );
}

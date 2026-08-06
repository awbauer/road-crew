export function nowIso(now: number = Date.now()): string {
  return new Date(now).toISOString();
}

/** Short, human-readable time label for chat rows (e.g. "2:05 PM"). */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

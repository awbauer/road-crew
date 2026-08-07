const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_MESSAGE_PATTERNS = [
  "network request failed",
  "failed to fetch",
  "load failed",
  "timed out",
  "timeout",
  "networkerror",
  "network error",
  "the internet connection appears to be offline",
];

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export function isLikelyTransientError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status != null) return TRANSIENT_STATUS_CODES.has(status);
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;

  const message = errorMessage(error).toLowerCase();
  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

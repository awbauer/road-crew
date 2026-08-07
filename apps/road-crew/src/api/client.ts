import { CONFIG } from "@/config";
import { DEVICE_ID_HEADER, getDeviceId } from "@/device/deviceId";
import { errorMessage } from "@/lib/errors";
import { addBreadcrumb } from "@/monitoring";
import { accessFetch } from "@/api/accessFetch";
import { Platform } from "react-native";

export const UNAVAILABLE_ERROR = "Command messaging is unavailable in this deployment.";
export const API_DISABLED_ERROR = "API calls are disabled in this build.";

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

/** Builds an absolute URL against the configured API base. */
export function apiUrl(path: string, query?: Record<string, string | number | null | undefined>): string {
  const base = CONFIG.apiBaseUrl;
  const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

function isWorkerApiPath(path: string): boolean {
  try {
    return new URL(path, "https://road-crew.invalid").pathname.startsWith("/api/");
  } catch {
    return path.startsWith("/api/");
  }
}

/**
 * fetch wrapper with an abort timeout and JSON error handling. Mirrors the
 * PWA's `fetchWithTimeout` so both clients behave the same on slow networks.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if ((Platform.OS === "web" || !CONFIG.vanInstallEnabled) && isWorkerApiPath(path)) {
    throw new ApiError(API_DISABLED_ERROR, 0, { features: { vanInstall: false } });
  }
  const { timeoutMs = CONFIG.requestTimeoutMs, headers, ...rest } = options;
  const method = String(rest.method || "GET").toUpperCase();
  const startedAt = Date.now();
  const deviceId = await getDeviceId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await accessFetch(apiUrl(path), {
      ...rest,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(rest.body ? { "content-type": "application/json" } : {}),
        ...headers,
        [DEVICE_ID_HEADER]: deviceId,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      addBreadcrumb("api request failed", {
        path,
        method,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      const message =
        (payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : null) || `Request failed (${response.status}).`;
      throw new ApiError(message, response.status, payload);
    }
    return payload as T;
  } catch (error) {
    addBreadcrumb("api request threw", {
      path,
      method,
      durationMs: Date.now() - startedAt,
      error: errorMessage(error),
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** True if a thrown error indicates messaging is disabled server-side. */
export function isUnavailableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    const payload = error.payload as { error?: string; features?: { messaging?: boolean; vanInstall?: boolean } } | undefined;
    return error.message === UNAVAILABLE_ERROR
      || error.message === API_DISABLED_ERROR
      || payload?.features?.messaging === false
      || payload?.features?.vanInstall === false;
  }
  return error instanceof Error && error.message === UNAVAILABLE_ERROR;
}

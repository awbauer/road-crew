import * as Sentry from "@sentry/react-native";
import * as Updates from "expo-updates";
import { APP_CONFIG, APP_VERSION } from "@road-crew/config";
import { redactSensitiveFields } from "@road-crew/core";
import { getDeviceId } from "@/device/deviceId";

/** Native crash/error monitoring via Sentry. Metro picks this file on native. */
export interface CaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

let initialized = false;
const QUEUE_LIMIT = 24;
type MetricAttributes = Record<string, string | number | boolean>;
type QueuedMetric = {
  type: "count" | "gauge" | "distribution";
  name: string;
  value: number;
  attributes?: MetricAttributes;
};
type QueuedEvent =
  | { kind: "exception"; error: Error; context?: CaptureContext }
  | { kind: "message"; message: string; level: "info" | "warning" | "error" };
const queuedEvents: QueuedEvent[] = [];
const queuedMetrics: QueuedMetric[] = [];
type LogLevel = "info" | "warn" | "error";
type LogAttributes = Record<string, string | number | boolean>;
type QueuedLog = { level: LogLevel; message: string; attributes?: LogAttributes };
const queuedLogs: QueuedLog[] = [];

function emitMetric(metric: QueuedMetric): void {
  try {
    const options = metric.attributes ? { attributes: metric.attributes } : undefined;
    if (metric.type === "count") Sentry.metrics.count(metric.name, metric.value, options);
    else if (metric.type === "gauge") Sentry.metrics.gauge(metric.name, metric.value, options);
    else Sentry.metrics.distribution(metric.name, metric.value, options);
  } catch (error) {
    console.warn("Sentry metric failed", error);
  }
}

function flushQueuedMetrics(): void {
  while (queuedMetrics.length) {
    const metric = queuedMetrics.shift();
    if (metric) emitMetric(metric);
  }
}

function queueMetric(metric: QueuedMetric): void {
  queuedMetrics.push(metric);
  if (queuedMetrics.length > QUEUE_LIMIT) queuedMetrics.shift();
}

function emitLog(log: QueuedLog): void {
  try {
    if (log.level === "error") Sentry.logger.error(log.message, log.attributes);
    else if (log.level === "warn") Sentry.logger.warn(log.message, log.attributes);
    else Sentry.logger.info(log.message, log.attributes);
  } catch (error) {
    console.warn("Sentry log failed", error);
  }
}

function flushQueuedLogs(): void {
  while (queuedLogs.length) {
    const log = queuedLogs.shift();
    if (log) emitLog(log);
  }
}

function queueLog(log: QueuedLog): void {
  queuedLogs.push(log);
  if (queuedLogs.length > QUEUE_LIMIT) queuedLogs.shift();
}

function queueEvent(entry: QueuedEvent): void {
  queuedEvents.push(entry);
  if (queuedEvents.length > QUEUE_LIMIT) queuedEvents.shift();
}

function flushQueuedEvents(): void {
  while (queuedEvents.length) {
    const entry = queuedEvents.shift();
    if (!entry) continue;
    if (entry.kind === "message") {
      Sentry.captureMessage(entry.message, entry.level);
      continue;
    }
    captureException(entry.error, entry.context);
  }
}

function captureException(error: Error, context?: CaptureContext): void {
  Sentry.withScope((scope) => {
    if (context?.tags) for (const [key, value] of Object.entries(context.tags)) scope.setTag(key, value);
    if (context?.extra) scope.setExtras(redactSensitiveFields(context.extra) as Record<string, unknown>);
    Sentry.captureException(error);
  });
}

export function initMonitoring(): void {
  if (initialized) return;
  const dsn = APP_CONFIG.sentry.productionDsn;
  if (!dsn) return;

  try {
    Sentry.init({
      dsn,
      environment: "native-development",
      release: APP_CONFIG.sentryRelease,
      tracesSampleRate: APP_CONFIG.sentry.tracesSampleRate,
      enableMetrics: true,
      enableLogs: true,
      integrations: [Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] })],
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.extra) event.extra = redactSensitiveFields(event.extra) as typeof event.extra;
        if (event.contexts) event.contexts = redactSensitiveFields(event.contexts) as typeof event.contexts;
        if (event.tags) event.tags = redactSensitiveFields(event.tags) as typeof event.tags;
        return event;
      },
    });
    Sentry.setTag("app_version", APP_VERSION.release);
    Sentry.setTag("app_build", APP_VERSION.build);
    Sentry.setTag("native_build", "ios-mapbox");
    // Correlate crashes to the active OTA update. `channel` also reads back the
    // channel embedded at build time (via app.config.js), confirming OTA routing.
    Sentry.setTag("update_id", Updates.updateId ?? "embedded");
    Sentry.setTag("update_channel", Updates.channel ?? "none");
    Sentry.setTag("runtime_version", Updates.runtimeVersion ?? "unknown");
    Sentry.setTag("is_embedded_launch", String(Updates.isEmbeddedLaunch));
    getDeviceId()
      .then((deviceId) => {
        Sentry.setTag("device_id", deviceId);
        Sentry.setUser({ id: deviceId });
        Sentry.setContext("device", { id: deviceId });
      })
      .catch(() => {});
    initialized = true;
    flushQueuedEvents();
    flushQueuedMetrics();
    flushQueuedLogs();
    logInfo("Road Crew monitoring initialized", { platform: "native", environment: "native-development" });
    metricCount("road_crew.app_initialized", 1, { platform: "native", environment: "native-development" });
  } catch (error) {
    console.warn("Sentry native init failed", error);
  }
}

export function captureError(error: unknown, context?: CaptureContext): void {
  console.error(error, context ?? "");
  const normalized = error instanceof Error ? error : new Error(String(error));
  if (!initialized) {
    queueEvent({ kind: "exception", error: normalized, context });
    return;
  }
  captureException(normalized, context);
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info"): void {
  if (!initialized) {
    queueEvent({ kind: "message", message, level });
    return;
  }
  Sentry.captureMessage(message, level);
}

export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.addBreadcrumb({
    category: "app",
    message,
    level: "info",
    data: data ? (redactSensitiveFields(data) as Record<string, unknown>) : undefined,
  });
}

export function setMonitoringContext(tags: Record<string, string | number | boolean | null | undefined>): void {
  if (!initialized) return;
  for (const [key, value] of Object.entries(tags)) {
    if (value != null) Sentry.setTag(key, String(value));
  }
}

export function metricCount(name: string, value = 1, attributes?: MetricAttributes): void {
  const metric = { type: "count" as const, name, value, attributes };
  if (!initialized) return queueMetric(metric);
  emitMetric(metric);
}

export function metricGauge(name: string, value: number, attributes?: MetricAttributes): void {
  const metric = { type: "gauge" as const, name, value, attributes };
  if (!initialized) return queueMetric(metric);
  emitMetric(metric);
}

export function metricDistribution(name: string, value: number, attributes?: MetricAttributes): void {
  const metric = { type: "distribution" as const, name, value, attributes };
  if (!initialized) return queueMetric(metric);
  emitMetric(metric);
}

export function logInfo(message: string, attributes?: LogAttributes): void {
  const log = { level: "info" as const, message, attributes };
  if (!initialized) return queueLog(log);
  emitLog(log);
}

export function logWarning(message: string, attributes?: LogAttributes): void {
  const log = { level: "warn" as const, message, attributes };
  if (!initialized) return queueLog(log);
  emitLog(log);
}

export function logError(message: string, attributes?: LogAttributes): void {
  const log = { level: "error" as const, message, attributes };
  if (!initialized) return queueLog(log);
  emitLog(log);
}

// Initialize before the first native screen mounts so startup and native
// module failures have a chance to reach Sentry.
initMonitoring();

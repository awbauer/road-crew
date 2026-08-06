import * as Sentry from "@sentry/browser";
import { sentryConfigForHostname, APP_CONFIG, APP_VERSION } from "@road-crew/config";
import { redactSensitiveFields } from "@road-crew/core";
import { getDeviceId } from "@/device/deviceId";

/**
 * Web error monitoring, logging, and metrics via Sentry (@sentry/browser), mirroring the
 * legacy app/js/monitoring.js: same DSN/environment (from the hostname), GPS
 * field redaction, and error reporting. Issues come from explicit captureError,
 * the ErrorBoundary, and Sentry's default global handlers (unhandled errors +
 * promise rejections); console output is kept as breadcrumbs and forwarded as
 * Sentry Logs, while metrics are emitted through the same initialized client.
 * Only enabled on production hostnames with a DSN configured.
 *
 * initMonitoring() runs from a root-level useEffect, which fires AFTER child
 * components' own mount effects — so an error/breadcrumb can legitimately
 * happen before Sentry is initialized. Mirroring legacy's queueEvent /
 * flushQueuedEvents, those are queued (bounded) and replayed once init
 * completes, instead of being silently dropped.
 */
let initialized = false;
const QUEUE_LIMIT = 24;
type QueuedEvent =
  | { kind: "exception"; error: Error; context?: CaptureContext }
  | { kind: "message"; message: string; level: "info" | "warning" | "error" };
const queuedEvents: QueuedEvent[] = [];
type MetricAttributes = Record<string, string | number | boolean>;
type QueuedMetric = {
  type: "count" | "gauge" | "distribution";
  name: string;
  value: number;
  attributes?: MetricAttributes;
};
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
    } else {
      Sentry.withScope((scope) => {
        if (entry.context?.tags) for (const [k, v] of Object.entries(entry.context.tags)) scope.setTag(k, v);
        if (entry.context?.extra) scope.setExtras(redactSensitiveFields(entry.context.extra) as Record<string, unknown>);
        Sentry.captureException(entry.error);
      });
    }
  }
}

export function initMonitoring(): void {
  if (initialized || typeof window === "undefined") return;
  const config = sentryConfigForHostname(window.location.hostname);
  if (!config.enabled) return; // disabled on localhost / previews without a DSN
  try {
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: APP_CONFIG.sentryRelease,
      sampleRate: 1.0,
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
    getDeviceId()
      .then((deviceId) => {
        Sentry.setTag("device_id", deviceId);
        Sentry.setUser({ id: deviceId });
        Sentry.setContext("device", { id: deviceId });
      })
      .catch(() => {
        // Monitoring must never block app startup.
      });
    initialized = true;
    flushQueuedEvents();
    flushQueuedMetrics();
    flushQueuedLogs();
    logInfo("Road Crew monitoring initialized", { platform: "web", environment: config.environment });
    metricCount("road_crew.app_initialized", 1, { platform: "web", environment: config.environment });
  } catch (e) {
    console.warn("Sentry init failed", e);
  }
}

export interface CaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export function captureError(error: unknown, context?: CaptureContext): void {
  console.error(error, context ?? "");
  const normalized = error instanceof Error ? error : new Error(String(error));
  if (!initialized) {
    queueEvent({ kind: "exception", error: normalized, context });
    return;
  }
  Sentry.withScope((scope) => {
    if (context?.tags) for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, v);
    if (context?.extra) scope.setExtras(redactSensitiveFields(context.extra) as Record<string, unknown>);
    Sentry.captureException(normalized);
  });
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info"): void {
  if (!initialized) {
    console.log(`[${level}] ${message}`);
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

/** Attach persistent context tags (route id/name, providers, online, …). */
export function setMonitoringContext(tags: Record<string, string | number | boolean | null | undefined>): void {
  if (!initialized) return;
  for (const [k, v] of Object.entries(tags)) {
    if (v != null) Sentry.setTag(k, String(v));
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

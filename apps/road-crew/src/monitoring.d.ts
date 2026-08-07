// Type surface for the platform-split monitoring module
// (monitoring.web.ts / monitoring.native.ts). Metro resolves the platform
// file; TypeScript resolves this for `@/monitoring` imports.
export interface CaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export type MetricAttributes = Record<string, string | number | boolean>;
export type LogAttributes = Record<string, string | number | boolean>;

export declare function initMonitoring(): void;
export declare function captureError(error: unknown, context?: CaptureContext): void;
export declare function captureMessage(message: string, level?: "info" | "warning" | "error"): void;
export declare function addBreadcrumb(message: string, data?: Record<string, unknown>): void;
export declare function setMonitoringContext(
  tags: Record<string, string | number | boolean | null | undefined>,
): void;
export declare function metricCount(name: string, value?: number, attributes?: MetricAttributes): void;
export declare function metricGauge(name: string, value: number, attributes?: MetricAttributes): void;
export declare function metricDistribution(name: string, value: number, attributes?: MetricAttributes): void;
export declare function logInfo(message: string, attributes?: LogAttributes): void;
export declare function logWarning(message: string, attributes?: LogAttributes): void;
export declare function logError(message: string, attributes?: LogAttributes): void;

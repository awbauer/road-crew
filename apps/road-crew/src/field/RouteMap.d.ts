// Type surface for the platform-split RouteMap (RouteMap.web.tsx /
// RouteMap.native.tsx). Metro resolves the platform file; TypeScript resolves
// this declaration for `@/field/RouteMap` imports.
import type * as React from "react";
import type { RouteMapProps } from "./RouteMap.types";

declare const RouteMap: React.ComponentType<RouteMapProps>;
export type { RouteMapProps } from "./RouteMap.types";
export default RouteMap;

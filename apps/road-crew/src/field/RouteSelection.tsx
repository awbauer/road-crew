import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useSession } from "@/auth/SessionProvider";
import { captureError } from "@/monitoring";

/**
 * Shared "which route is active" state for the field tabs, backed by the
 * persisted session route so Sequences and Map stay in sync with the driver's
 * saved route selection.
 */
interface RouteSelectionContextValue {
  routeId: string | null;
  ready: boolean;
  setRouteId: (id: string | null) => Promise<void>;
}

const RouteSelectionContext = createContext<RouteSelectionContextValue | null>(null);

export function RouteSelectionProvider({ children }: { children: ReactNode }) {
  const { routeId, ready, selectRoute } = useSession();
  const setRouteId = useCallback(async (id: string | null) => {
    try {
      await selectRoute(id);
    } catch (error) {
      captureError(error, { tags: { source: "field_route_select" }, extra: { routeId: id } });
    }
  }, [selectRoute]);
  const value = useMemo<RouteSelectionContextValue>(
    () => ({ routeId, ready, setRouteId }),
    [routeId, ready, setRouteId],
  );

  return (
    <RouteSelectionContext.Provider value={value}>
      {children}
    </RouteSelectionContext.Provider>
  );
}

export function useSelectedRoute(): RouteSelectionContextValue {
  const value = useContext(RouteSelectionContext);
  if (!value) throw new Error("useSelectedRoute must be used within a RouteSelectionProvider.");
  return value;
}

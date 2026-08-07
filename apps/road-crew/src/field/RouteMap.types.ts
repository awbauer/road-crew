import type { Route, VanLocation } from "@road-crew/contracts";
import type { MapType, NavProvider } from "./Settings.tsx";

export interface RouteMapProps {
  routes: Route[] | undefined;
  activeId?: string;
  nextSeqNum?: number | null;
  initialSequenceNumber?: number | null;
  onInitialSequenceOpened?: () => void;
  cumberlandFarmsVisible?: boolean;
  onCumberlandFarmsVisibleChange?: (visible: boolean) => void;
  mapType?: MapType;
  navProvider?: NavProvider;
  /** Live fleet positions to overlay, excluding this device when selfVanId is set. */
  vans?: VanLocation[];
  selfVanId?: string | null;
  /**
   * Keep the map centred on the user. Driven by the Follow control in the
   * screen header, not by anything inside the map.
   *
   * Centring only — the user's zoom is never changed, so pinching to zoom while
   * following sticks instead of being re-fitted on the next fix.
   */
  follow?: boolean;
  /** Fired when the map itself drops follow, e.g. the user pans away. */
  onFollowChange?: (follow: boolean) => void;
}

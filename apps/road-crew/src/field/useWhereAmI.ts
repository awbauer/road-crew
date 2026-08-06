import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRouteById } from "@road-crew/data";
import {
  ADDRESS_REUSE_METERS,
  buildWhereAmIView,
  haversine,
  resolveLocalWhereAmI,
  type AsyncFieldStatus,
  type ResolvedAddress,
  type WhereAmIView,
} from "@road-crew/core";
import { captureError } from "@/monitoring";
import { readCachedAddress, writeCachedAddress } from "./addressCache.ts";
import { REVERSE_GEOCODE_SUPPORTED, reverseGeocode } from "./reverseGeocode";
import { useRoutes } from "./useRoutes.ts";
import { useSelectedRoute } from "./RouteSelection.tsx";
import { useSharedGeolocation } from "./Geolocation.tsx";
import type { Fix } from "./geolocation-types.ts";

// How often the modal re-reads the clock so "Last updated" counts up.
const TICK_MS = 1_000;
// The address is looked up when the modal opens, then re-checked on this
// cadence so a van driving with the modal open doesn't keep showing the address
// of a place it has left. Deliberately not per fix: a lookup takes longer than
// a fix interval, and restarting it on every fix would never let one finish.
const ADDRESS_CHECK_MS = 2_000;
// Backoff after a failed lookup, so a van parked outside the reuse radius with
// no signal doesn't retry every couple of seconds.
const ADDRESS_RETRY_MS = 30_000;

interface AnchoredAddress {
  address: ResolvedAddress;
  lat: number;
  lng: number;
}

export interface WhereAmIState {
  /** Null only while there is no usable fix at all. */
  view: WhereAmIView | null;
  gpsError: string | null;
  /** Asks the platform for a fresher fix (used when the current one is stale). */
  refresh: () => void;
}

/**
 * Drives the "Where am I?" modal: local enrichment on every fix, and — on
 * native only — a reverse-geocode on open, merged in when it lands. The web
 * build has no geocoder, so it stays on the baked route data throughout.
 *
 * `active` is the modal's visibility. Everything here is inert while closed, so
 * a modal nobody opened costs no geocoding requests and no per-second renders.
 */
export function useWhereAmI(active: boolean): WhereAmIState {
  const { fix, error: gpsError, requestFix } = useSharedGeolocation();
  const { data } = useRoutes();
  const { routeId } = useSelectedRoute();
  const route = data && routeId ? (getRouteById(data, routeId) ?? null) : null;

  const [nowMs, setNowMs] = useState(() => Date.now());
  // The address plus the coordinate it was resolved for, so it can be dropped
  // once the van drives away rather than sitting under a new town.
  const [anchored, setAnchored] = useState<AnchoredAddress | null>(null);
  const [addressStatus, setAddressStatus] = useState<AsyncFieldStatus>("notRequested");

  const fixRef = useRef<Fix | null>(fix);
  fixRef.current = fix;
  const anchoredRef = useRef<AnchoredAddress | null>(anchored);
  anchoredRef.current = anchored;

  useEffect(() => {
    if (!active) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  // A stale fix makes every derived field stale with it, so opening the modal
  // nudges the platform for a fresh one rather than presenting old data.
  useEffect(() => {
    if (!active) return;
    requestFix().catch(() => {
      /* the modal still shows the last known fix */
    });
  }, [active, requestFix]);

  useEffect(() => {
    // Web never asks: no request, no cache write, and `addressStatus` stays
    // "notRequested" so the panel omits the address row rather than showing it
    // as unavailable.
    if (!active || !REVERSE_GEOCODE_SUPPORTED) return;
    let cancelled = false;
    let running = false;
    let retryAfterMs = 0;
    const controller = new AbortController();

    const resolveAddress = async () => {
      if (cancelled || running) return;
      const current = fixRef.current;
      if (!current) return;
      const { lat, lng } = current;
      const anchor = anchoredRef.current;
      // Still within 100 yards of where the current address was resolved:
      // reuse it rather than spending another Mapbox request.
      if (anchor && haversine(lat, lng, anchor.lat, anchor.lng) <= ADDRESS_REUSE_METERS) return;
      if (Date.now() < retryAfterMs) return;

      running = true;
      // Only show "Locating address…" when there is nothing to show yet;
      // a moved-on van keeps its previous address until the new one lands.
      if (!anchor) setAddressStatus("loading");
      try {
        const cached = await readCachedAddress(lat, lng);
        if (cancelled) return;
        if (cached) {
          setAnchored({ address: cached, lat, lng });
          setAddressStatus("available");
          return;
        }
        const resolved = await reverseGeocode(lat, lng, { signal: controller.signal });
        if (cancelled) return;
        if (!resolved) {
          // Anchor nothing on a miss, so the next move retries — but not for
          // another `ADDRESS_RETRY_MS`.
          retryAfterMs = Date.now() + ADDRESS_RETRY_MS;
          setAnchored(null);
          setAddressStatus("unavailable");
          return;
        }
        setAnchored({ address: resolved, lat, lng });
        setAddressStatus("available");
        await writeCachedAddress(lat, lng, resolved);
      } catch (error) {
        if (cancelled) return;
        retryAfterMs = Date.now() + ADDRESS_RETRY_MS;
        setAddressStatus("failed");
        captureError(error, { tags: { source: "where_am_i_reverse_geocode" } });
      } finally {
        running = false;
      }
    };

    resolveAddress();
    const timer = setInterval(resolveAddress, ADDRESS_CHECK_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [active]);

  const addressApplies = Boolean(
    anchored && fix && haversine(fix.lat, fix.lng, anchored.lat, anchored.lng) <= ADDRESS_REUSE_METERS,
  );

  const view = useMemo<WhereAmIView | null>(() => {
    if (!fix) return null;
    const local = resolveLocalWhereAmI(fix, route ? { sequences: route.sequences, path: route.path } : null, { nowMs });
    return buildWhereAmIView(
      local,
      addressApplies && anchored ? anchored.address : null,
      addressApplies ? "available" : addressStatus,
    );
  }, [fix, route, nowMs, anchored, addressApplies, addressStatus]);

  const refresh = useCallback(() => {
    requestFix().catch(() => {
      /* best effort */
    });
  }, [requestFix]);

  return { view, gpsError, refresh };
}

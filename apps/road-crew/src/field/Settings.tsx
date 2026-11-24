import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { captureError, captureMessage } from "@/monitoring";
import { DEFAULT_CUMBERLAND_FARMS_VISIBLE } from "@/field/mapModel";

export type NavProvider = "apple" | "google" | "waze";
export type MapType = "mapbox" | "arcgis";

export interface Settings {
  navProvider: NavProvider;
  mapType: MapType;
  cumberlandFarmsVisible: boolean;
  driverMode: boolean;
}

const DEFAULTS: Settings = {
  navProvider: "apple",
  mapType: "mapbox",
  cumberlandFarmsVisible: DEFAULT_CUMBERLAND_FARMS_VISIBLE,
  driverMode: false,
};

const STORAGE_KEY = "rc-settings";

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function persist(settings: Settings): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch((error) => {
    captureError(error, { tags: { source: "settings_save" } });
  });
}

/**
 * Persisted app settings shared across the field tabs.
 *
 * A change made before the stored settings have loaded used to be lost one way
 * or the other: the late load overwrote it on screen, or its save (built on the
 * defaults) overwrote every other stored setting. Changes made before the load
 * are now held and applied on top of what was stored.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const loadedRef = useRef(false);
  const pendingRef = useRef<Partial<Settings>>({});

  useEffect(() => {
    let alive = true;
    const finish = (stored: Partial<Settings>) => {
      if (!alive) return;
      loadedRef.current = true;
      const pending = pendingRef.current;
      pendingRef.current = {};
      const next = { ...DEFAULTS, ...stored, ...pending };
      setSettings(next);
      if (Object.keys(pending).length) persist(next);
    };
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return finish({});
        try {
          finish(JSON.parse(raw) as Partial<Settings>);
        } catch (error) {
          captureMessage("Persisted field settings were invalid JSON; defaults were restored.", "warning");
          captureError(error, { tags: { source: "settings_parse" } });
          finish({});
        }
      })
      .catch((error) => {
        captureError(error, { tags: { source: "settings_load" } });
        finish({});
      });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    if (!loadedRef.current) pendingRef.current = { ...pendingRef.current, ...patch };
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (loadedRef.current) persist(next);
      return next;
    });
  }, []);

  const value = useMemo<SettingsContextValue>(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used within a SettingsProvider.");
  return value;
}

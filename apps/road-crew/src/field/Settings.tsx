import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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

/** Persisted app settings shared across the field tabs. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (alive && raw) {
          try {
            setSettings({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) });
          } catch (error) {
            captureMessage("Persisted field settings were invalid JSON; defaults were restored.", "warning");
            captureError(error, { tags: { source: "settings_parse" } });
          }
        }
      })
      .catch((error) => {
        captureError(error, { tags: { source: "settings_load" } });
      });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((error) => {
        captureError(error, { tags: { source: "settings_save" } });
      });
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

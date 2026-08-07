import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  clearSession,
  loadSession,
  setReportingVan,
  setLocationTrackingPolicy as persistLocationTrackingPolicy,
  setRemoteTrackingEnabled as persistRemoteTrackingEnabled,
  setVanInstall,
  setVanInstallSkipped,
  setSessionRoute,
  setSessionVan,
  subscribeToSession,
  type Session,
} from "@/auth/session";
import { syncBackgroundLocationReporting } from "@/field/backgroundLocation";
import { syncBackgroundHeartbeatRegistration } from "@/sync/backgroundHeartbeat";
import { captureError, metricCount } from "@/monitoring";
import { initializeCloudflareAccessCredentials } from "@/auth/cloudflareAccess";

interface SessionContextValue extends Session {
  ready: boolean;
  signIn: (vanId: string) => Promise<void>;
  /** Marks this native install as a van-install app. */
  enableVanInstall: () => Promise<void>;
  /** Lets the user switch this device between standard and van-install mode. */
  setVanInstallMode: (enabled: boolean) => Promise<void>;
  /** Applies the tracking flag Command delivers via heartbeat. */
  setRemoteTrackingEnabled: (enabled: boolean) => Promise<void>;
  /** Applies the Worker-wide tracking policy and its resulting device state. */
  setLocationTrackingPolicy: (allowed: boolean, trackingEnabled: boolean) => Promise<void>;
  /** Suppresses the van-install picker until Reset App clears the skip marker. */
  skipVanInstall: () => Promise<void>;
  /** Van picked through the van-install flow: sets the van AND enables reporting. */
  installVan: (vanId: string) => Promise<void>;
  signOut: () => Promise<void>;
  selectRoute: (routeId: string | null) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>({
    vanId: null,
    routeId: null,
    vanInstall: false,
    vanInstallConfigured: false,
    vanInstallSkipped: false,
    reportingVan: false,
    remoteTrackingEnabled: true,
    locationTrackingAllowed: true,
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([loadSession(), initializeCloudflareAccessCredentials()]).then(([loaded]) => {
      if (active) {
        setSession(loaded);
        setReady(true);
      }
    });
    // The background location task and the silent-push sync write the session
    // directly, without going through this provider. Re-read on every write so
    // an applied tracking change is what the Tracked switch shows, and so the
    // foreground heartbeat's ref cannot keep re-asserting a superseded value.
    const unsubscribe = subscribeToSession(() => {
      void loadSession().then((loaded) => {
        if (active) setSession(loaded);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    void syncBackgroundHeartbeatRegistration(
      session.vanInstall && session.reportingVan && Boolean(session.vanId),
    ).catch((error) => {
      captureError(error, { tags: { source: "background_heartbeat_registration" } });
    });
    void syncBackgroundLocationReporting({
      reportingVan: session.reportingVan,
      vanId: session.vanId,
      trackingEnabled: session.locationTrackingAllowed && session.remoteTrackingEnabled,
    }).catch((error) => {
      captureError(error, { tags: { source: "background_location_sync" } });
    });
  }, [
    ready,
    session.vanInstall,
    session.reportingVan,
    session.vanId,
    session.remoteTrackingEnabled,
    session.locationTrackingAllowed,
  ]);

  const signIn = useCallback(async (vanId: string) => {
    try {
      await setSessionVan(vanId);
      setSession((prev) => ({ ...prev, vanId }));
      metricCount("road_crew.session_action", 1, { action: "sign_in", outcome: "success" });
    } catch (error) {
      metricCount("road_crew.session_action", 1, { action: "sign_in", outcome: "error" });
      throw error;
    }
  }, []);

  const enableVanInstall = useCallback(async () => {
    try {
      await Promise.all([
        setVanInstall(true),
        setVanInstallSkipped(false),
      ]);
      setSession((prev) => ({
        ...prev,
        vanInstall: true,
        vanInstallConfigured: true,
        vanInstallSkipped: false,
      }));
      metricCount("road_crew.session_action", 1, { action: "enable_van_install", outcome: "success" });
    } catch (error) {
      metricCount("road_crew.session_action", 1, { action: "enable_van_install", outcome: "error" });
      throw error;
    }
  }, []);

  const setVanInstallMode = useCallback(async (enabled: boolean) => {
    const shouldReport = Boolean(enabled && session.vanId);
    try {
      await Promise.all([
        setVanInstall(enabled),
        setVanInstallSkipped(false),
        setReportingVan(shouldReport),
      ]);
      setSession((prev) => ({
        ...prev,
        vanInstall: enabled,
        vanInstallConfigured: true,
        vanInstallSkipped: false,
        reportingVan: shouldReport,
      }));
      metricCount("road_crew.session_action", 1, { action: "set_van_install_mode", enabled: String(enabled), outcome: "success" });
    } catch (error) {
      metricCount("road_crew.session_action", 1, { action: "set_van_install_mode", enabled: String(enabled), outcome: "error" });
      throw error;
    }
  }, [session.vanId]);

  const setRemoteTrackingEnabled = useCallback(async (enabled: boolean) => {
    const applied = session.locationTrackingAllowed && enabled;
    await persistRemoteTrackingEnabled(applied);
    setSession((prev) => ({ ...prev, remoteTrackingEnabled: applied }));
  }, [session.locationTrackingAllowed]);

  const setLocationTrackingPolicy = useCallback(async (
    allowed: boolean,
    trackingEnabled: boolean,
  ) => {
    const appliedTrackingEnabled = allowed && trackingEnabled;
    await persistLocationTrackingPolicy(allowed, appliedTrackingEnabled);
    setSession((prev) => ({
      ...prev,
      locationTrackingAllowed: allowed,
      remoteTrackingEnabled: appliedTrackingEnabled,
    }));
  }, []);

  const skipVanInstall = useCallback(async () => {
    try {
      await setVanInstallSkipped(true);
      setSession((prev) => ({ ...prev, vanInstallSkipped: true }));
      metricCount("road_crew.session_action", 1, { action: "skip_van_install", outcome: "success" });
    } catch (error) {
      metricCount("road_crew.session_action", 1, { action: "skip_van_install", outcome: "error" });
      throw error;
    }
  }, []);

  const installVan = useCallback(async (vanId: string) => {
    try {
      await Promise.all([
        setSessionVan(vanId),
        setVanInstall(true),
        setVanInstallSkipped(false),
        setReportingVan(true),
      ]);
      setSession((prev) => ({
        ...prev,
        vanId,
        vanInstall: true,
        vanInstallConfigured: true,
        vanInstallSkipped: false,
        reportingVan: true,
      }));
      metricCount("road_crew.session_action", 1, { action: "install_van", outcome: "success" });
    } catch (error) {
      metricCount("road_crew.session_action", 1, { action: "install_van", outcome: "error" });
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await clearSession();
      setSession((prev) => ({
        ...prev,
        vanId: null,
        routeId: null,
        vanInstallSkipped: false,
        reportingVan: false,
      }));
      metricCount("road_crew.session_action", 1, { action: "sign_out", outcome: "success" });
    } catch (error) {
      metricCount("road_crew.session_action", 1, { action: "sign_out", outcome: "error" });
      throw error;
    }
  }, []);

  const selectRoute = useCallback(async (routeId: string | null) => {
    try {
      await setSessionRoute(routeId);
      setSession((prev) => ({ ...prev, routeId }));
      metricCount("road_crew.session_action", 1, { action: "select_route", outcome: "success", hasRoute: String(Boolean(routeId)) });
    } catch (error) {
      metricCount("road_crew.session_action", 1, { action: "select_route", outcome: "error", hasRoute: String(Boolean(routeId)) });
      throw error;
    }
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...session,
      ready,
      signIn,
      enableVanInstall,
      setVanInstallMode,
      setRemoteTrackingEnabled,
      setLocationTrackingPolicy,
      skipVanInstall,
      installVan,
      signOut,
      selectRoute,
    }),
    [
      session,
      ready,
      signIn,
      enableVanInstall,
      setVanInstallMode,
      setRemoteTrackingEnabled,
      setLocationTrackingPolicy,
      skipVanInstall,
      installVan,
      signOut,
      selectRoute,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider.");
  return ctx;
}
